//! Dynamic plugin loading and Parcel plugin trait adapters.

use std::{ffi::c_void, mem::ManuallyDrop, path::Path, ptr, sync::Arc};

use libloading::{Library, Symbol};
use parcel_core::{
  Asset as CoreAsset, AssetRequest, AssetType, BufferContent, Content, ContentWithSourceMap,
  Dependency as CoreDependency, DependencyResolution, Diagnostic as CoreDiagnostic, DiagnosticList,
  FileContent, LogLevel as CoreLogLevel, LogMessage, Optimizer, ParcelOptions, PathId, Reporter,
  ReporterEvent, Resolver, SourceLocation, SourceUrl, Transformer,
};

use crate::{
  Asset, AssetIndex, Buffer, Bundle, BundleGraph, Dependency, Diagnostic, DiagnosticSeverity,
  Diagnostics, Options, diagnostics::DiagnosticsView, parcel_free_buffer, read_cdiagnostic,
};

/// Result of a plugin's `parcel_plugin_init()`.
///
/// A plugin that cannot use the [`ParcelApi`](crate::ParcelApi) table it was
/// handed returns `PARCEL_INIT_INCOMPATIBLE` without writing a diagnostic — it
/// has no way to allocate one, since allocating goes through the very table it
/// just rejected. Parcel writes that diagnostic instead.
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum InitStatus {
  /// The plugin initialized. Its state, if any, is in the `state` out param.
  PARCEL_INIT_OK = 0,
  /// The plugin failed and wrote a diagnostic describing why.
  PARCEL_INIT_ERROR = 1,
  /// The plugin cannot run against this build of Parcel. No diagnostic was
  /// written; Parcel reports the mismatch.
  PARCEL_INIT_INCOMPATIBLE = 2,
}

// ResolveResult.resolution_type field
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum ResolutionType {
  PARCEL_RESOLUTION_NONE = 0,
  PARCEL_RESOLUTION_FILE_PATH = 1,
  PARCEL_RESOLUTION_EXTERNAL = 2,
  PARCEL_RESOLUTION_EXCLUDED = 3,
}

/// Result filled by a resolver plugin's `parcel_plugin_resolve()`.
/// The struct is zero-initialised by the host before the call.
///
/// When type == PARCEL_RESOLUTION_FILE_PATH, fill `file_path` (and optionally `pipeline`) via `parcel_buffer_alloc()`.
#[repr(C)]
pub struct ResolveResult {
  /// `PARCEL_RESOLUTION_*`
  pub resolution_type: ResolutionType,
  pub file_path: Buffer,
  pub pipeline: Buffer,
}

// ── Reporter events ───────────────────────────────────────────────────────────

/// The kind of event passed to `parcel_plugin_report()`.
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum ReportEventType {
  PARCEL_EVENT_BUILD_START = 0,
  PARCEL_EVENT_BUILD_SUCCESS = 1,
  PARCEL_EVENT_BUILD_FAILURE = 2,
  PARCEL_EVENT_LOG = 3,
}

/// The level of a log event, and of a message passed to `parcel_options_log()`.
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq, Default)]
pub enum LogLevel {
  PARCEL_LOG_NONE = 0,
  PARCEL_LOG_ERROR = 1,
  PARCEL_LOG_WARN = 2,
  #[default]
  PARCEL_LOG_INFO = 3,
  PARCEL_LOG_VERBOSE = 4,
}

impl_enum_conversion! {
  CoreLogLevel => LogLevel {
    CoreLogLevel::None => LogLevel::PARCEL_LOG_NONE,
    CoreLogLevel::Error => LogLevel::PARCEL_LOG_ERROR,
    CoreLogLevel::Warn => LogLevel::PARCEL_LOG_WARN,
    CoreLogLevel::Info => LogLevel::PARCEL_LOG_INFO,
    CoreLogLevel::Verbose => LogLevel::PARCEL_LOG_VERBOSE,
  }
}

/// An event passed to a reporter plugin's `parcel_plugin_report()`.
///
/// Which fields are filled in depends on `event_type`; the rest are zeroed.
/// Every handle and pointer here is valid only for the duration of the call.
///
/// Check `size` before reading a field this header declares but an older Parcel
/// may not have written. Unlike `ParcelApi`, whose `size` a plugin verifies once
/// at startup, this struct is filled in per call and carries its own.
#[repr(C)]
pub struct ReportEvent {
  /// `sizeof(struct ReportEvent)` as the host was built.
  pub size: usize,
  pub event_type: ReportEventType,
  /// `PARCEL_EVENT_LOG` only.
  pub level: LogLevel,
  /// `PARCEL_EVENT_LOG` only, and NULL when the event carries diagnostics
  /// instead of a message. Not NUL-terminated; use `message_len`.
  pub message: *const u8,
  pub message_len: usize,
  /// `PARCEL_EVENT_BUILD_FAILURE` and `PARCEL_EVENT_LOG`. 0 when the event
  /// carries no diagnostics.
  pub diagnostics: Diagnostics,
  /// `PARCEL_EVENT_BUILD_SUCCESS` only; 0 otherwise.
  pub bundle_graph: BundleGraph,
  /// `PARCEL_EVENT_BUILD_SUCCESS` only. How long the build took.
  pub build_time_ms: u64,
  /// `PARCEL_EVENT_BUILD_SUCCESS` only. The assets re-transformed by this
  /// build; empty after a full build, which transformed all of them.
  pub changed_assets: *const AssetIndex,
  pub changed_asset_count: usize,
}

/// Result filled by an optimizer plugin's `parcel_plugin_optimize()`.
/// The struct is zero-initialised by the host before the call. Fill `contents`
/// and optionally `source_map` using `parcel_buffer_write()` or
/// `parcel_buffer_write_utf8()`.
#[repr(C)]
#[derive(Default)]
pub struct OptimizeResult {
  pub contents: Buffer,
  /// Leave empty to remove the source map from the optimized output.
  pub source_map: Buffer,
}

// ── CPlugin ───────────────────────────────────────────────────────────────────

pub struct CPlugin {
  // ManuallyDrop prevents dlclose() from being called on drop. Go shared
  // libraries cannot be unloaded: their runtime starts background goroutines
  // that block dlclose() indefinitely. The OS reclaims all resources on
  // process exit without needing an explicit unload.
  lib: ManuallyDrop<Library>,
  state: *mut c_void,
}

unsafe impl Send for CPlugin {}
unsafe impl Sync for CPlugin {}

impl CPlugin {
  pub fn new(path: PathId, config: Option<&serde_json::Value>) -> Result<CPlugin, DiagnosticList> {
    let lib = path
      .with_path(|path| unsafe { Library::new(path) })
      .map_err(|e| DiagnosticList(vec![CoreDiagnostic::from_message(e.to_string())]))?;
    let state = Self::call_init(&lib, path, config)?;
    Ok(CPlugin {
      lib: ManuallyDrop::new(lib),
      state,
    })
  }

  fn call_init(
    lib: &Library,
    path: PathId,
    config: Option<&serde_json::Value>,
  ) -> Result<*mut c_void, DiagnosticList> {
    type InitFn = extern "C" fn(
      *const crate::ParcelApi,
      *const u8,
      usize,
      *mut *mut c_void,
      *mut Diagnostic,
    ) -> InitStatus;
    let sym: Result<Symbol<InitFn>, _> = unsafe { lib.get(b"parcel_plugin_init") };
    let Ok(init_fn) = sym else {
      return Err(
        CoreDiagnostic::from_message("Plugin did not have a parcel_plugin_init function".into())
          .into(),
      );
    };

    let config_bytes = config
      .and_then(|v| serde_json::to_vec(v).ok())
      .unwrap_or_default();

    let mut state = ptr::null_mut();
    let mut diagnostic = Diagnostic::default();
    let status = init_fn(
      &crate::PARCEL_API,
      config_bytes.as_ptr(),
      config_bytes.len(),
      &mut state,
      &mut diagnostic,
    );

    match status {
      // A plugin may legitimately have no state, so `state` says nothing about
      // whether initialization succeeded. Only the status does.
      InitStatus::PARCEL_INIT_OK => Ok(state),

      // The plugin rejected our function table, which is also the only way it
      // could have allocated a diagnostic. Describe the mismatch here instead.
      InitStatus::PARCEL_INIT_INCOMPATIBLE => Err(
        CoreDiagnostic::from_message(format!(
          "{} was built for a different version of Parcel's plugin ABI. Rebuild it \
           against the SDK matching this version of Parcel, which implements plugin \
           ABI {}.",
          path.to_path_buf().display(),
          crate::PARCEL_ABI_VERSION,
        ))
        .into(),
      ),

      InitStatus::PARCEL_INIT_ERROR => {
        let diag = read_cdiagnostic(&mut diagnostic, None).unwrap_or_else(|| {
          CoreDiagnostic::from_message(format!(
            "{} failed to initialize, without reporting why.",
            path.to_path_buf().display()
          ))
        });
        Err(DiagnosticList(vec![diag]))
      }
    }
  }
}

impl Drop for CPlugin {
  fn drop(&mut self) {
    if self.state.is_null() {
      return;
    }
    type DeinitFn = extern "C" fn(*mut c_void);
    let sym: Result<Symbol<DeinitFn>, _> = unsafe { self.lib.get(b"parcel_plugin_deinit") };
    if let Ok(deinit_fn) = sym {
      deinit_fn(self.state);
    }
  }
}

impl Transformer for CPlugin {
  fn transform(
    &self,
    mut asset: CoreAsset,
    options: &ParcelOptions,
    _fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<CoreAsset, DiagnosticList> {
    type TransformFn = extern "C" fn(Asset, Options, *mut c_void, *mut Diagnostic);
    let transform: Symbol<TransformFn> = unsafe {
      self.lib.get(b"parcel_plugin_transform").map_err(|_| {
        CoreDiagnostic::from_message("Failed to find parcel_plugin_transform symbol".into())
      })?
    };

    let mut diagnostic = Diagnostic::default();
    transform(
      &mut asset as *mut CoreAsset as Asset,
      options as *const ParcelOptions as Options,
      self.state,
      &mut diagnostic,
    );

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, Some(&options.project_root)) {
      return Err(DiagnosticList(vec![diag]));
    }
    Ok(asset)
  }
}

impl Resolver for CPlugin {
  fn resolve(
    &self,
    dep: &CoreDependency,
    specifier: &str,
    pipeline: Option<&str>,
    options: &ParcelOptions,
    _fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<DependencyResolution, DiagnosticList> {
    type ResolveFn = extern "C" fn(
      Dependency,
      *const u8,
      usize, // specifier
      *const u8,
      usize, // pipeline (null ptr = no pipeline)
      Options,
      *mut ResolveResult,
      *mut c_void,
      *mut Diagnostic,
    );
    let resolve: Symbol<ResolveFn> = unsafe {
      self.lib.get(b"parcel_plugin_resolve").map_err(|_| {
        CoreDiagnostic::from_message("Failed to find parcel_plugin_resolve symbol".into())
      })?
    };

    let mut result = ResolveResult {
      resolution_type: ResolutionType::PARCEL_RESOLUTION_NONE,
      file_path: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
        is_utf8: false,
      },
      pipeline: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
        is_utf8: false,
      },
    };
    let mut diagnostic = Diagnostic {
      message: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
        is_utf8: false,
      },
      file_path: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
        is_utf8: false,
      },
      line: 0,
      column: 0,
      hint: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
        is_utf8: false,
      },
      severity: DiagnosticSeverity::PARCEL_SEVERITY_ERROR,
    };

    let pipeline_bytes = pipeline.map(|p| p.as_bytes());

    resolve(
      dep as *const CoreDependency as Dependency,
      specifier.as_ptr(),
      specifier.len(),
      pipeline_bytes.map_or(ptr::null(), |b| b.as_ptr()),
      pipeline_bytes.map_or(0, |b| b.len()),
      options as *const ParcelOptions as Options,
      &mut result,
      self.state,
      &mut diagnostic,
    );

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, Some(&options.project_root)) {
      return Err(DiagnosticList(vec![diag]));
    }

    match result.resolution_type {
      ResolutionType::PARCEL_RESOLUTION_FILE_PATH => {
        if result.file_path.data.is_null() {
          return Ok(DependencyResolution::None);
        }
        let file_path = {
          let file_path_str = unsafe {
            std::ffi::OsStr::from_encoded_bytes_unchecked(std::slice::from_raw_parts(
              result.file_path.data,
              result.file_path.len,
            ))
          };
          let path = Path::new(file_path_str).to_path_buf();
          parcel_free_buffer(&mut result.file_path);
          path
        };

        let result_pipeline = if result.pipeline.data.is_null() {
          None
        } else {
          let s = unsafe {
            let slice = std::slice::from_raw_parts(result.pipeline.data, result.pipeline.len);
            if result.pipeline.is_utf8 {
              std::str::from_utf8_unchecked(slice)
            } else {
              std::str::from_utf8(slice)?
            }
          };
          let atom = Some(hstr::Atom::from(s));
          parcel_free_buffer(&mut result.pipeline);
          atom
        };

        let url = SourceUrl::from_path(&PathId::new(&file_path));
        let ty =
          AssetType::from_extension(file_path.extension().and_then(|e| e.to_str()).unwrap_or(""));

        Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
          loc: SourceLocation {
            url,
            ..Default::default()
          },
          ty,
          pipeline: result_pipeline,
          target: dep.target.clone(),
          content: Arc::new(FileContent::new(
            PathId::new(&file_path),
            options.input_fs.clone(),
          )),
          side_effects: true,
          unique_key: None,
        })))
      }
      ResolutionType::PARCEL_RESOLUTION_EXTERNAL => Ok(DependencyResolution::External),
      ResolutionType::PARCEL_RESOLUTION_EXCLUDED => Ok(DependencyResolution::Excluded),
      ResolutionType::PARCEL_RESOLUTION_NONE => Ok(DependencyResolution::None),
    }
  }
}

impl parcel_core::Namer for CPlugin {
  fn name(
    &self,
    bundle_graph: &parcel_core::BundleGraph,
    bundle: &parcel_core::Bundle,
    options: &ParcelOptions,
  ) -> Result<Option<PathId>, DiagnosticList> {
    type NameFn =
      extern "C" fn(BundleGraph, Bundle, Options, *mut Buffer, *mut c_void, *mut Diagnostic);
    let name_fn: Symbol<NameFn> = unsafe {
      self.lib.get(b"parcel_plugin_name").map_err(|_| {
        CoreDiagnostic::from_message("Failed to find parcel_plugin_name symbol".into())
      })?
    };

    let mut name = Buffer::default();
    let mut diagnostic = Diagnostic::default();
    name_fn(
      bundle_graph as *const parcel_core::BundleGraph as BundleGraph,
      bundle as *const parcel_core::Bundle as Bundle,
      options as *const ParcelOptions as Options,
      &mut name,
      self.state,
      &mut diagnostic,
    );

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, Some(&options.project_root)) {
      parcel_free_buffer(&mut name);
      return Err(DiagnosticList(vec![diag]));
    }

    if name.data.is_null() {
      return Ok(None);
    }

    let relative_name = unsafe {
      let slice = std::slice::from_raw_parts(name.data, name.len);
      if name.is_utf8 {
        std::str::from_utf8_unchecked(slice)
      } else {
        std::str::from_utf8(slice)?
      }
    };

    let res = if relative_name.is_empty() {
      Ok(None)
    } else {
      Ok(Some(bundle.target.dist_dir.join(Path::new(&relative_name))))
    };

    parcel_free_buffer(&mut name);
    res
  }
}

impl Reporter for CPlugin {
  fn report(&self, event: &ReporterEvent, options: &ParcelOptions) -> Result<(), DiagnosticList> {
    type ReportFn = extern "C" fn(*const ReportEvent, Options, *mut c_void, *mut Diagnostic);
    let report: Symbol<ReportFn> = unsafe {
      self.lib.get(b"parcel_plugin_report").map_err(|_| {
        CoreDiagnostic::from_message("Failed to find parcel_plugin_report symbol".into())
      })?
    };

    // Both of these are borrowed by `c_event` below, so they have to outlive it.
    let diagnostics = match event {
      ReporterEvent::BuildFailure { diagnostics } => Some(DiagnosticsView {
        diagnostics: &diagnostics.0,
      }),
      ReporterEvent::Log(log) => match log.message {
        LogMessage::Diagnostics(diagnostics) => Some(DiagnosticsView { diagnostics }),
        LogMessage::Text(_) => None,
      },
      _ => None,
    };
    // Materialized rather than cast: `parcel_core::AssetIndex` is a newtype
    // whose layout is not guaranteed to match the `uint32_t` the ABI uses.
    let changed_assets: Vec<AssetIndex> = match event {
      ReporterEvent::BuildSuccess(success) => {
        success.changed_assets.iter().map(|index| index.0).collect()
      }
      _ => Vec::new(),
    };

    let mut c_event = ReportEvent {
      size: size_of::<ReportEvent>(),
      event_type: ReportEventType::PARCEL_EVENT_BUILD_START,
      level: LogLevel::default(),
      message: ptr::null(),
      message_len: 0,
      diagnostics: diagnostics
        .as_ref()
        .map_or(0, |view| view as *const DiagnosticsView as Diagnostics),
      bundle_graph: 0,
      build_time_ms: 0,
      changed_assets: changed_assets.as_ptr(),
      changed_asset_count: changed_assets.len(),
    };

    match event {
      ReporterEvent::BuildStart => {}
      ReporterEvent::BuildSuccess(success) => {
        c_event.event_type = ReportEventType::PARCEL_EVENT_BUILD_SUCCESS;
        c_event.bundle_graph =
          success.bundle_graph as *const parcel_core::BundleGraph as BundleGraph;
        c_event.build_time_ms = success.build_time.as_millis() as u64;
      }
      ReporterEvent::BuildFailure { .. } => {
        c_event.event_type = ReportEventType::PARCEL_EVENT_BUILD_FAILURE;
      }
      ReporterEvent::Log(log) => {
        c_event.event_type = ReportEventType::PARCEL_EVENT_LOG;
        c_event.level = LogLevel::from(log.level);
        if let LogMessage::Text(text) = log.message {
          c_event.message = text.as_ptr();
          c_event.message_len = text.len();
        }
      }
      // An event this build of the ABI has no representation for. Reporting
      // nothing is better than reporting it as the wrong kind of event.
      _ => return Ok(()),
    }

    let mut diagnostic = Diagnostic::default();
    report(
      &c_event,
      options as *const ParcelOptions as Options,
      self.state,
      &mut diagnostic,
    );

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, Some(&options.project_root)) {
      return Err(DiagnosticList(vec![diag]));
    }
    Ok(())
  }
}

impl Optimizer for CPlugin {
  fn optimize(
    &self,
    bundle_graph: &parcel_core::BundleGraph,
    bundle: &parcel_core::Bundle,
    contents: Arc<dyn Content>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    type OptimizeFn = extern "C" fn(
      BundleGraph,
      Bundle,
      *const u8,
      usize, // contents
      *const u8,
      usize, // source map (null ptr = no source map)
      Options,
      *mut OptimizeResult,
      *mut c_void,
      *mut Diagnostic,
    );
    let optimize: Symbol<OptimizeFn> = unsafe {
      self.lib.get(b"parcel_plugin_optimize").map_err(|_| {
        CoreDiagnostic::from_message("Failed to find parcel_plugin_optimize symbol".into())
      })?
    };

    let source_map = contents
      .downcast_ref::<ContentWithSourceMap>()
      .map(|contents| contents.source_map().to_vec());
    let contents = contents.read()?;
    let mut result = OptimizeResult::default();
    let mut diagnostic = Diagnostic::default();

    optimize(
      bundle_graph as *const parcel_core::BundleGraph as BundleGraph,
      bundle as *const parcel_core::Bundle as Bundle,
      contents.as_ptr(),
      contents.len(),
      source_map.as_ref().map_or(ptr::null(), |map| map.as_ptr()),
      source_map.as_ref().map_or(0, Vec::len),
      options as *const ParcelOptions as Options,
      &mut result,
      self.state,
      &mut diagnostic,
    );

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, Some(&options.project_root)) {
      parcel_free_buffer(&mut result.contents);
      parcel_free_buffer(&mut result.source_map);
      return Err(DiagnosticList(vec![diag]));
    }

    let optimized_source_map = if result.source_map.data.is_null() {
      None
    } else {
      let source_map = unsafe {
        std::slice::from_raw_parts(result.source_map.data, result.source_map.len).to_vec()
      };
      parcel_free_buffer(&mut result.source_map);
      Some(source_map)
    };

    if result.contents.data.is_null() {
      if let Some(source_map) = optimized_source_map {
        Ok(Arc::new(ContentWithSourceMap::new(Vec::new(), source_map)))
      } else {
        Ok(Arc::new(BufferContent::new(Vec::new())))
      }
    } else {
      let contents =
        unsafe { std::slice::from_raw_parts(result.contents.data, result.contents.len).to_vec() };
      parcel_free_buffer(&mut result.contents);

      if result.contents.is_utf8 {
        let string = unsafe { String::from_utf8_unchecked(contents) };
        if let Some(source_map) = optimized_source_map {
          Ok(Arc::new(ContentWithSourceMap::new_string(
            string, source_map,
          )))
        } else {
          Ok(Arc::new(BufferContent::new_string(string)))
        }
      } else {
        if let Some(source_map) = optimized_source_map {
          Ok(Arc::new(ContentWithSourceMap::new(contents, source_map)))
        } else {
          Ok(Arc::new(BufferContent::new(contents)))
        }
      }
    }
  }
}
