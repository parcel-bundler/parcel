//! Dynamic plugin loading and Parcel plugin trait adapters.

use std::{ffi::c_void, mem::ManuallyDrop, path::Path, ptr, sync::Arc};

use libloading::{Library, Symbol};
use parcel_core::{
  Asset as CoreAsset, AssetRequest, AssetType, BufferContent, Content, ContentWithSourceMap,
  Dependency as CoreDependency, DependencyResolution, Diagnostic as CoreDiagnostic, DiagnosticList,
  FileContent, Optimizer, ParcelOptions, PathId, Resolver, SourceLocation, SourceUrl, Transformer,
};

use crate::{
  Asset, Buffer, Bundle, BundleGraph, Dependency, Diagnostic, DiagnosticSeverity, Options,
  parcel_free_buffer, read_cdiagnostic,
};

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
    let state = Self::call_init(&lib, config)?;
    Ok(CPlugin {
      lib: ManuallyDrop::new(lib),
      state,
    })
  }

  fn call_init(
    lib: &Library,
    config: Option<&serde_json::Value>,
  ) -> Result<*mut c_void, DiagnosticList> {
    type InitFn = extern "C" fn(*const u8, usize, *mut Diagnostic) -> *mut c_void;
    let sym: Result<Symbol<InitFn>, _> = unsafe { lib.get(b"parcel_plugin_init") };
    let Ok(init_fn) = sym else {
      return Ok(ptr::null_mut());
    };

    let config_bytes = config
      .and_then(|v| serde_json::to_vec(v).ok())
      .unwrap_or_default();

    let mut diagnostic = Diagnostic::default();
    let state = init_fn(config_bytes.as_ptr(), config_bytes.len(), &mut diagnostic);

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, None) {
      return Err(DiagnosticList(vec![diag]));
    }
    Ok(state)
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
      self
        .lib
        .get(b"parcel_plugin_transform")
        .expect("Failed to find parcel_plugin_transform symbol")
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
      self
        .lib
        .get(b"parcel_plugin_resolve")
        .expect("Failed to find parcel_plugin_resolve symbol")
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
      self
        .lib
        .get(b"parcel_plugin_name")
        .expect("Failed to find parcel_plugin_name symbol")
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
      self
        .lib
        .get(b"parcel_plugin_optimize")
        .expect("Failed to find parcel_plugin_optimize symbol")
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
