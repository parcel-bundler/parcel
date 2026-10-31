//! Dynamic plugin loading and Parcel plugin trait adapters.

use std::{
  borrow::Cow,
  ffi::c_void,
  path::{Path, PathBuf},
  ptr,
  sync::Arc,
};

use libloading::{Library, Symbol};
use parcel_core::{
  Asset as CoreAsset, AssetRequest, AssetType, BufferContent, Content, ContentWithSourceMap,
  Dependency as CoreDependency, DependencyResolution, Diagnostic as CoreDiagnostic, DiagnosticList,
  FileContent, LogLevel as CoreLogLevel, LogMessage, Optimizer, ParcelOptions, PathId, Reporter,
  ReporterEvent, Resolver, SourceLocation, SourceUrl, Transformer,
};

use crate::{
  Asset, AssetIndex, Buffer, Bundle, BundleGraph, Dependency, DiagnosticOptions, DiagnosticsRef,
  OptionsContext, ParcelPluginDeinitFn, ParcelPluginInitFn, ParcelPluginNameFn,
  ParcelPluginOptimizeFn, ParcelPluginReportFn, ParcelPluginResolveFn, ParcelPluginTransformFn,
  diagnostics::DiagnosticsView, parcel_free_buffer, plugin_path, read_cdiagnostic, trusted_str,
  trusted_utf8,
};

/// Result of a plugin's `parcel_plugin_init()`.
///
/// A plugin that cannot use the `ParcelApi` table it was
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

impl_raw_enum!(InitStatus {
  PARCEL_INIT_OK,
  PARCEL_INIT_ERROR,
  PARCEL_INIT_INCOMPATIBLE,
});

// ResolveResult.resolution_type field
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum ResolutionType {
  PARCEL_RESOLUTION_NONE = 0,
  PARCEL_RESOLUTION_FILE_PATH = 1,
  PARCEL_RESOLUTION_EXTERNAL = 2,
  PARCEL_RESOLUTION_EXCLUDED = 3,
}

pub type ResolutionTypeFFI = u8;

impl_raw_enum!(ResolutionType {
  PARCEL_RESOLUTION_NONE,
  PARCEL_RESOLUTION_FILE_PATH,
  PARCEL_RESOLUTION_EXTERNAL,
  PARCEL_RESOLUTION_EXCLUDED,
});

/// Result filled by a resolver plugin's `parcel_plugin_resolve()`, or by Parcel in
/// `parcel_asset_resolve()`.
///
/// Whoever allocates it zero-initializes it and sets `size`: Parcel before calling
/// `parcel_plugin_resolve()`, so a resolver only writes fields that fit within
/// `size` (`PARCEL_HAS_FIELD()` checks), and the plugin before calling
/// `parcel_asset_resolve()`, as `ResolveResult result = {.size = sizeof(ResolveResult)};`.
///
/// When type == PARCEL_RESOLUTION_FILE_PATH, fill `file_path` (and optionally `pipeline`) via `parcel_buffer_alloc()`.
#[repr(C)]
pub struct ResolveResult {
  /// `sizeof(ResolveResult)` as whoever allocated it was built. Always the first member.
  pub size: usize,
  /// `PARCEL_RESOLUTION_*`
  pub resolution_type: ResolutionTypeFFI,
  pub file_path: Buffer,
  pub pipeline: Buffer,
}

impl_extensible!(
  ResolveResult,
  min_size = std::mem::offset_of!(ResolveResult, pipeline) + size_of::<Buffer>()
);

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

pub type LogLevelFFI = u8;

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
/// Check `size` with `PARCEL_HAS_FIELD()` before reading a field this header
/// declares but an older Parcel may not have written. Unlike `ParcelApi`, whose
/// `size` a plugin verifies once at startup, this struct is filled in per call
/// and carries its own.
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
  pub diagnostics: DiagnosticsRef,
  /// `PARCEL_EVENT_BUILD_SUCCESS` only; 0 otherwise.
  pub bundle_graph: BundleGraph,
  /// `PARCEL_EVENT_BUILD_SUCCESS` only. How long the build took.
  pub build_time_ms: u64,
  /// `PARCEL_EVENT_BUILD_SUCCESS` only. The assets transformed by this build:
  /// on a full build, every asset. NULL when `changed_asset_count` is 0.
  pub changed_assets: *const AssetIndex,
  pub changed_asset_count: usize,
}

/// Result filled by an optimizer plugin's `parcel_plugin_optimize()`.
/// The struct is zero-initialised by the host before the call, apart from `size`.
/// Fill `contents` and optionally `source_map` using `parcel_buffer_write()` or
/// `parcel_buffer_write_utf8()`, and only write fields that fit within `size`
/// (`PARCEL_HAS_FIELD()` checks).
#[repr(C)]
pub struct OptimizeResult {
  /// `sizeof(OptimizeResult)` as Parcel was built. Always the first member.
  pub size: usize,
  pub contents: Buffer,
  /// Leave empty to remove the source map from the optimized output.
  pub source_map: Buffer,
}

impl_extensible!(
  OptimizeResult,
  min_size = std::mem::offset_of!(OptimizeResult, source_map) + size_of::<Buffer>()
);

// ── CPlugin ───────────────────────────────────────────────────────────────────

/// What a .parcelrc entry configures a plugin as, which decides the entry point
/// Parcel calls.
/// cbindgen:ignore
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginKind {
  Transformer,
  Resolver,
  Namer,
  Optimizer,
  Reporter,
}

impl PluginKind {
  /// The kind's name, as a .parcelrc key spells it in the singular.
  pub fn name(self) -> &'static str {
    match self {
      PluginKind::Transformer => "transformer",
      PluginKind::Resolver => "resolver",
      PluginKind::Namer => "namer",
      PluginKind::Optimizer => "optimizer",
      PluginKind::Reporter => "reporter",
    }
  }

  fn symbol(self) -> &'static str {
    match self {
      PluginKind::Transformer => "parcel_plugin_transform",
      PluginKind::Resolver => "parcel_plugin_resolve",
      PluginKind::Namer => "parcel_plugin_name",
      PluginKind::Optimizer => "parcel_plugin_optimize",
      PluginKind::Reporter => "parcel_plugin_report",
    }
  }
}

/// The entry points a library exports, looked up once when it is loaded.
/// cbindgen:ignore
struct EntryPoints {
  transform: Option<ParcelPluginTransformFn>,
  resolve: Option<ParcelPluginResolveFn>,
  name: Option<ParcelPluginNameFn>,
  optimize: Option<ParcelPluginOptimizeFn>,
  report: Option<ParcelPluginReportFn>,
  deinit: Option<ParcelPluginDeinitFn>,
}

impl EntryPoints {
  fn find(lib: &Library) -> Self {
    /// The function `symbol` names, copied out of its `Symbol`. It stays valid
    /// because the library is never unloaded.
    fn get<T: Copy>(lib: &Library, symbol: &str) -> Option<T> {
      unsafe { lib.get::<T>(symbol.as_bytes()) }.ok().map(|f| *f)
    }
    EntryPoints {
      transform: get(lib, "parcel_plugin_transform"),
      resolve: get(lib, "parcel_plugin_resolve"),
      name: get(lib, "parcel_plugin_name"),
      optimize: get(lib, "parcel_plugin_optimize"),
      report: get(lib, "parcel_plugin_report"),
      deinit: get(lib, "parcel_plugin_deinit"),
    }
  }

  fn exports(&self, kind: PluginKind) -> bool {
    match kind {
      PluginKind::Transformer => self.transform.is_some(),
      PluginKind::Resolver => self.resolve.is_some(),
      PluginKind::Namer => self.name.is_some(),
      PluginKind::Optimizer => self.optimize.is_some(),
      PluginKind::Reporter => self.report.is_some(),
    }
  }
}

pub struct CPlugin {
  /// Points into the library, which is never unloaded (see `new`).
  entry_points: EntryPoints,
  state: *mut c_void,
  /// The plugin's name in .parcelrc, which its diagnostics are attributed to.
  origin: String,
}

unsafe impl Send for CPlugin {}
unsafe impl Sync for CPlugin {}

impl CPlugin {
  /// Loads the library at `path` as the plugin .parcelrc names `origin`,
  /// configured as a `kind` plugin, and initializes it with `config`.
  ///
  /// Fails when the library doesn't export the entry point for `kind`, rather
  /// than at the first call. That is checked after initializing it, so a library
  /// that isn't a Parcel plugin at all, or was built for another ABI, gets the
  /// diagnostic that says so instead.
  pub fn new(
    path: PathId,
    origin: &str,
    kind: PluginKind,
    config: Option<&serde_json::Value>,
  ) -> Result<CPlugin, DiagnosticList> {
    let with_origin = |mut diagnostics: DiagnosticList| {
      for diagnostic in &mut diagnostics.0 {
        diagnostic.origin.get_or_insert_with(|| origin.to_owned());
      }
      diagnostics
    };
    // Never unloaded, even when loading fails below, so dlclose() is never
    // called. Go shared libraries cannot be unloaded: their runtime starts
    // background goroutines that block dlclose() indefinitely. The OS reclaims
    // everything on process exit. That is also what keeps the function pointers
    // in `entry_points` valid.
    let lib: &'static Library = Box::leak(Box::new(Self::open(path).map_err(with_origin)?));
    let entry_points = EntryPoints::find(lib);
    let state = Self::call_init(lib, path, config).map_err(with_origin)?;
    if !entry_points.exports(kind) {
      if let Some(deinit) = entry_points.deinit
        && !state.is_null()
      {
        deinit(state);
      }
      return Err(with_origin(
        CoreDiagnostic {
          hints: vec![format!(
            "Check that {origin} is a {} plugin, or configure it as the kind of plugin it is.",
            kind.name()
          )],
          ..CoreDiagnostic::from_message(format!(
            "{origin} is configured as a {} but {} does not export {}()",
            kind.name(),
            path.to_path_buf().display(),
            kind.symbol()
          ))
        }
        .into(),
      ));
    }
    Ok(CPlugin {
      entry_points,
      state,
      origin: origin.to_owned(),
    })
  }

  /// A diagnostic for a call to an entry point the library doesn't export,
  /// which `new` rules out for the kind it was configured as.
  fn missing(&self, symbol: &str) -> DiagnosticList {
    CoreDiagnostic {
      origin: Some(self.origin.clone()),
      ..CoreDiagnostic::from_message(format!("{} does not export {symbol}()", self.origin))
    }
    .into()
  }

  /// Reads the diagnostics the plugin failed a call with, if any. Its own are
  /// attributed to it; those it passed on from Parcel keep their origin.
  fn read_diagnostic(
    &self,
    diagnostic: &mut DiagnosticOptions,
    context: &OptionsContext,
  ) -> Option<DiagnosticList> {
    let mut diagnostics = read_cdiagnostic(diagnostic, Some(context));
    if diagnostics.is_empty() {
      return None;
    }
    for diagnostic in &mut diagnostics {
      diagnostic.origin.get_or_insert_with(|| self.origin.clone());
    }
    Some(DiagnosticList(diagnostics))
  }

  fn open(path: PathId) -> Result<Library, DiagnosticList> {
    path
      .with_path(|path| unsafe { Library::new(path) })
      .map_err(|e| {
        incompatible_library(format!(
          "Could not load {}: {}",
          path.to_path_buf().display(),
          e
        ))
      })
  }

  fn call_init(
    lib: &Library,
    path: PathId,
    config: Option<&serde_json::Value>,
  ) -> Result<*mut c_void, DiagnosticList> {
    // Returns a raw byte rather than `InitStatus`: a library built before the
    // status existed returns its state pointer here, and reading an arbitrary
    // byte as the enum would be undefined behavior.
    let sym: Result<Symbol<ParcelPluginInitFn>, _> = unsafe { lib.get(b"parcel_plugin_init") };
    let Ok(init_fn) = sym else {
      return Err(incompatible_library(format!(
        "{} does not export a parcel_plugin_init function, so it is not a Parcel plugin.",
        path.to_path_buf().display()
      )));
    };

    let config_bytes = config
      .and_then(|v| serde_json::to_vec(v).ok())
      .unwrap_or_default();

    let mut state = ptr::null_mut();
    let mut diagnostic = DiagnosticOptions::default();
    let status = init_fn(
      &crate::PARCEL_API,
      config_bytes.as_ptr(),
      config_bytes.len(),
      &mut state,
      &mut diagnostic,
    );

    match InitStatus::try_from(status) {
      // A plugin may legitimately have no state, so `state` says nothing about
      // whether initialization succeeded. Only the status does.
      Ok(InitStatus::PARCEL_INIT_OK) => Ok(state),

      // Every SDK writes a diagnostic along with this status, so a missing one
      // also suggests a library built against something else.
      Ok(InitStatus::PARCEL_INIT_ERROR) => Err({
        let diagnostics = read_cdiagnostic(&mut diagnostic, None);
        if diagnostics.is_empty() {
          incompatible_library(format!(
            "{} failed to initialize, without reporting why.",
            path.to_path_buf().display()
          ))
        } else {
          DiagnosticList(diagnostics)
        }
      }),

      // The plugin rejected our function table, which is also the only way it
      // could have allocated a diagnostic. Describe the mismatch here instead.
      // Any status no SDK returns gets the same treatment, since it most likely
      // came from a library built against an older ABI. The SDKs also refuse a
      // second Parcel's table in one process, which they cannot tell us apart.
      _ => Err(incompatible_library(format!(
        "{} was built for a different version of Parcel's plugin ABI, or is already in use by \
         another Parcel in this process.",
        path.to_path_buf().display(),
      ))),
    }
  }
}

/// A diagnostic for a library that cannot be used as a plugin by this build of
/// Parcel, most often because it is stale: built against an older SDK.
fn incompatible_library(message: String) -> DiagnosticList {
  CoreDiagnostic {
    hints: vec![format!(
      "Rebuild the plugin against the SDK matching this version of Parcel, which \
       implements plugin ABI {}.",
      crate::PARCEL_ABI_VERSION
    )],
    ..CoreDiagnostic::from_message(message)
  }
  .into()
}

impl Drop for CPlugin {
  fn drop(&mut self) {
    if self.state.is_null() {
      return;
    }
    if let Some(deinit) = self.entry_points.deinit {
      deinit(self.state);
    }
  }
}

impl Transformer for CPlugin {
  fn transform(
    &self,
    mut asset: CoreAsset,
    ctx: &parcel_core::PluginContext,
  ) -> Result<CoreAsset, DiagnosticList> {
    let transform =
      (self.entry_points.transform).ok_or_else(|| self.missing("parcel_plugin_transform"))?;

    let context = OptionsContext::with_plugin(ctx);
    let mut diagnostic = DiagnosticOptions::default();
    transform(
      &mut asset as *mut CoreAsset as Asset,
      context.handle(),
      self.state,
      &mut diagnostic,
    );

    if let Some(diagnostics) = self.read_diagnostic(&mut diagnostic, &context) {
      return Err(diagnostics);
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
    ctx: &parcel_core::PluginContext,
  ) -> Result<DependencyResolution, DiagnosticList> {
    let options = ctx.options;
    let resolve =
      (self.entry_points.resolve).ok_or_else(|| self.missing("parcel_plugin_resolve"))?;

    let mut result = ResolveResult::default();
    let mut diagnostic = DiagnosticOptions::default();

    let pipeline_bytes = pipeline.map(|p| p.as_bytes());
    let context = OptionsContext::with_plugin(ctx);

    resolve(
      dep as *const CoreDependency as Dependency,
      specifier.as_ptr(),
      specifier.len(),
      pipeline_bytes.map_or(ptr::null(), |b| b.as_ptr()),
      pipeline_bytes.map_or(0, |b| b.len()),
      context.handle(),
      &mut result,
      self.state,
      &mut diagnostic,
    );

    if let Some(diagnostics) = self.read_diagnostic(&mut diagnostic, &context) {
      return Err(diagnostics);
    }

    let resolution_type = ResolutionType::try_from(result.resolution_type);
    if resolution_type != Ok(ResolutionType::PARCEL_RESOLUTION_FILE_PATH) {
      // A resolver may have filled these in regardless.
      parcel_free_buffer(&mut result.file_path);
      parcel_free_buffer(&mut result.pipeline);
    }

    match resolution_type {
      Ok(ResolutionType::PARCEL_RESOLUTION_FILE_PATH) => {
        if result.file_path.data.is_null() {
          parcel_free_buffer(&mut result.pipeline);
          return Ok(DependencyResolution::None);
        }
        let file_path = match take_resolved_path(&mut result.file_path, specifier, &self.origin)
        {
          Ok(path) => path,
          Err(diagnostics) => {
            parcel_free_buffer(&mut result.pipeline);
            return Err(diagnostics);
          }
        };

        let result_pipeline = if result.pipeline.data.is_null() {
          None
        } else {
          let s = unsafe {
            let slice = std::slice::from_raw_parts(result.pipeline.data, result.pipeline.len);
            if result.pipeline.is_utf8 {
              Ok(trusted_str(slice, "A resolver's pipeline"))
            } else {
              std::str::from_utf8(slice)
            }
          };
          let atom = s.map(hstr::Atom::from);
          parcel_free_buffer(&mut result.pipeline);
          Some(atom?)
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
      Ok(ResolutionType::PARCEL_RESOLUTION_EXTERNAL) => Ok(DependencyResolution::External),
      Ok(ResolutionType::PARCEL_RESOLUTION_EXCLUDED) => Ok(DependencyResolution::Excluded),
      Ok(ResolutionType::PARCEL_RESOLUTION_NONE) => Ok(DependencyResolution::None),
      // Guessing what a resolution this build has never heard of meant would
      // build the wrong thing.
      Err(resolution_type) => Err(
        CoreDiagnostic {
          origin: Some(self.origin.clone()),
          ..CoreDiagnostic::from_message(format!(
            "Resolved {specifier:?} with resolution type {resolution_type}, which this version of Parcel does not support."
          ))
        }
        .into(),
      ),
    }
  }
}

/// Takes the path a resolver returned in `buffer`, freeing it. Resolvers must
/// return absolute paths, in a form this platform can represent.
pub(crate) fn take_resolved_path(
  buffer: &mut Buffer,
  specifier: &str,
  origin: &str,
) -> Result<PathBuf, DiagnosticList> {
  let path = if buffer.data.is_null() {
    Some(PathBuf::new())
  } else {
    let bytes = unsafe { std::slice::from_raw_parts(buffer.data, buffer.len) };
    unsafe { plugin_path(bytes, buffer.is_utf8) }.map(Path::to_path_buf)
  };
  parcel_free_buffer(buffer);
  *buffer = Buffer::default();

  let message = match path {
    Some(path) if path.is_absolute() => return Ok(path),
    Some(path) => format!(
      "Resolved {specifier:?} to the relative path {:?}. Resolvers must return absolute paths.",
      path.display()
    ),
    None => format!("Resolved {specifier:?} to a path that is not valid UTF-8."),
  };
  Err(
    CoreDiagnostic {
      origin: Some(origin.to_owned()),
      ..CoreDiagnostic::from_message(message)
    }
    .into(),
  )
}

impl parcel_core::Namer for CPlugin {
  fn name(
    &self,
    bundle_graph: &parcel_core::BundleGraph,
    bundle: &parcel_core::Bundle,
    options: &ParcelOptions,
  ) -> Result<Option<PathId>, DiagnosticList> {
    let name_fn = (self.entry_points.name).ok_or_else(|| self.missing("parcel_plugin_name"))?;

    let context = OptionsContext::new(options);
    let mut name = Buffer::default();
    let mut diagnostic = DiagnosticOptions::default();
    name_fn(
      bundle_graph as *const parcel_core::BundleGraph as BundleGraph,
      bundle as *const parcel_core::Bundle as Bundle,
      context.handle(),
      &mut name,
      self.state,
      &mut diagnostic,
    );

    if let Some(diagnostics) = self.read_diagnostic(&mut diagnostic, &context) {
      parcel_free_buffer(&mut name);
      return Err(diagnostics);
    }

    if name.data.is_null() {
      return Ok(None);
    }

    let relative_name = unsafe {
      let slice = std::slice::from_raw_parts(name.data, name.len);
      if name.is_utf8 {
        Ok(trusted_str(slice, "A namer's result"))
      } else {
        std::str::from_utf8(slice)
      }
    };

    let res = match relative_name {
      Ok("") => Ok(None),
      Ok(relative_name) => Ok(Some(bundle.target.dist_dir.join(Path::new(relative_name)))),
      Err(err) => Err(err.into()),
    };

    parcel_free_buffer(&mut name);
    res
  }
}

impl Reporter for CPlugin {
  fn report(&self, event: &ReporterEvent, options: &ParcelOptions) -> Result<(), DiagnosticList> {
    let report = (self.entry_points.report).ok_or_else(|| self.missing("parcel_plugin_report"))?;

    // Both of these are borrowed by `c_event` below, so they have to outlive it.
    let diagnostics = match event {
      ReporterEvent::BuildFailure { diagnostics } => Some(DiagnosticsView {
        diagnostics: Cow::Borrowed(&diagnostics.0),
      }),
      ReporterEvent::Log(log) => match log.message {
        LogMessage::Diagnostics(diagnostics) => Some(DiagnosticsView {
          diagnostics: Cow::Borrowed(diagnostics),
        }),
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
        .map_or(0, |view| view as *const DiagnosticsView as DiagnosticsRef),
      bundle_graph: 0,
      build_time_ms: 0,
      // NULL rather than the dangling pointer of an empty Vec, which C may not
      // treat as a valid address.
      changed_assets: if changed_assets.is_empty() {
        ptr::null()
      } else {
        changed_assets.as_ptr()
      },
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

    let context = OptionsContext::new(options);
    let mut diagnostic = DiagnosticOptions::default();
    report(&c_event, context.handle(), self.state, &mut diagnostic);

    if let Some(diagnostics) = self.read_diagnostic(&mut diagnostic, &context) {
      return Err(diagnostics);
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
    let optimize =
      (self.entry_points.optimize).ok_or_else(|| self.missing("parcel_plugin_optimize"))?;

    let source_map = contents
      .downcast_ref::<ContentWithSourceMap>()
      .map(|contents| contents.source_map().to_vec());
    let contents = contents.read()?;
    let mut result = OptimizeResult::default();
    let mut diagnostic = DiagnosticOptions::default();
    let context = OptionsContext::new(options);

    optimize(
      bundle_graph as *const parcel_core::BundleGraph as BundleGraph,
      bundle as *const parcel_core::Bundle as Bundle,
      contents.as_ptr(),
      contents.len(),
      source_map.as_ref().map_or(ptr::null(), |map| map.as_ptr()),
      source_map.as_ref().map_or(0, Vec::len),
      context.handle(),
      &mut result,
      self.state,
      &mut diagnostic,
    );

    if let Some(diagnostics) = self.read_diagnostic(&mut diagnostic, &context) {
      parcel_free_buffer(&mut result.contents);
      parcel_free_buffer(&mut result.source_map);
      return Err(diagnostics);
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
        let string = unsafe { trusted_utf8(contents, "An optimizer's result") };
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
