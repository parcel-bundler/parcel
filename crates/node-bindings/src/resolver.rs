use dashmap::DashMap;
use gxhash::GxBuildHasher;
use napi::{
  bindgen_prelude::{Either3, FromNapiValue},
  threadsafe_function::{
    ErrorStrategy::{self, T},
    ThreadsafeFunction, ThreadsafeFunctionCallMode,
  },
  Env, JsBoolean, JsBuffer, JsFunction, JsObject, JsString, JsUnknown, NapiRaw, NapiValue, Ref,
  Result,
};
use napi_derive::napi;
use serde::{de::DeserializeOwned, Serialize};
#[cfg(not(target_arch = "wasm32"))]
use std::sync::atomic::Ordering;
use std::{
  borrow::Cow,
  collections::HashMap,
  ffi::OsString,
  path::{Path, PathBuf},
  sync::Arc,
};

#[cfg(not(target_arch = "wasm32"))]
use parcel_resolver::OsFileSystem;
use parcel_resolver::{
  ExportsCondition, Extensions, Fields, FileCreateInvalidation, FileSystem, Flags,
  IncludeNodeModules, Invalidations, ModuleType, Resolution, ResolverError, SpecifierType,
};

type NapiSideEffectsVariants = Either3<bool, Vec<String>, HashMap<String, bool>>;

#[napi(object)]
pub struct JsFileSystemOptions {
  pub canonicalize: JsFunction,
  pub read: JsFunction,
  pub is_file: JsFunction,
  pub is_dir: JsFunction,
  pub include_node_modules: Option<NapiSideEffectsVariants>,
}

#[napi(object, js_name = "FileSystem")]
pub struct JsResolverOptions {
  pub fs: Option<JsObject>,
  pub include_node_modules: Option<NapiSideEffectsVariants>,
  pub conditions: Option<u16>,
  pub module_dir_resolver: Option<JsFunction>,
  pub mode: u8,
  pub entries: Option<u8>,
  pub extensions: Option<Vec<String>>,
  pub package_exports: bool,
  pub typescript: Option<bool>,
}

pub struct FunctionRef {
  env: Env,
  reference: Ref<()>,
}

// We don't currently call functions from multiple threads, but we'll need to change this when we do.
unsafe impl Send for FunctionRef {}
unsafe impl Sync for FunctionRef {}

impl FunctionRef {
  pub fn new(env: Env, f: JsFunction) -> napi::Result<Self> {
    Ok(Self {
      env,
      reference: env.create_reference(f)?,
    })
  }

  fn get(&self) -> napi::Result<JsFunction> {
    self.env.get_reference_value(&self.reference)
  }
}

impl Drop for FunctionRef {
  fn drop(&mut self) {
    drop(self.reference.unref(self.env))
  }
}

#[derive(serde::Deserialize)]
#[serde(transparent)]
struct Buffer(#[serde(with = "serde_bytes")] Vec<u8>);

pub struct JsFileSystem {
  canonicalize: Box<dyn Fn(PathBuf) -> napi::Result<PathBuf> + Send + Sync>,
  read: Box<dyn Fn(PathBuf) -> napi::Result<Buffer> + Send + Sync>,
  read_string: Box<dyn Fn(PathBuf) -> napi::Result<String> + Send + Sync>,
  is_file: Box<dyn Fn(PathBuf) -> napi::Result<bool> + Send + Sync>,
  is_dir: Box<dyn Fn(PathBuf) -> napi::Result<bool> + Send + Sync>,
}

impl JsFileSystem {
  pub fn new(env: &Env, js_file_system: &JsObject) -> napi::Result<Self> {
    Ok(Self {
      canonicalize: Box::new(create_js_thread_safe_method(
        &env,
        &js_file_system,
        "canonicalize",
      )?),
      read: Box::new(create_js_thread_safe_method(&env, &js_file_system, "read")?),
      read_string: Box::new(create_js_thread_safe_method(
        &env,
        &js_file_system,
        "readString",
      )?),
      is_file: Box::new(create_js_thread_safe_method(
        &env,
        &js_file_system,
        "isFile",
      )?),
      is_dir: Box::new(create_js_thread_safe_method(
        &env,
        &js_file_system,
        "isDir",
      )?),
    })
  }
}

impl FileSystem for JsFileSystem {
  fn canonicalize(
    &self,
    path: &Path,
    _cache: &DashMap<PathBuf, Option<PathBuf>, GxBuildHasher>,
  ) -> std::io::Result<std::path::PathBuf> {
    (*self.canonicalize)(path.to_path_buf())
      .map_err(|err| std::io::Error::new(std::io::ErrorKind::NotFound, err.to_string()))
  }

  fn read(&self, path: &Path) -> std::io::Result<Vec<u8>> {
    (*self.read)(path.to_path_buf())
      .map(|b| b.0)
      .map_err(|err| std::io::Error::new(std::io::ErrorKind::NotFound, err.to_string()))
  }

  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    (*self.read_string)(path.to_path_buf())
      .map_err(|err| std::io::Error::new(std::io::ErrorKind::NotFound, err.to_string()))
  }

  fn is_file(&self, path: &Path) -> bool {
    (*self.is_file)(path.to_path_buf()).unwrap_or_default()
  }

  fn is_dir(&self, path: &Path) -> bool {
    (*self.is_dir)(path.to_path_buf()).unwrap_or_default()
  }
}

fn create_js_thread_safe_method<
  Params: Send + Serialize + 'static + std::fmt::Debug,
  Response: Send + DeserializeOwned + 'static,
>(
  env: &Env,
  js_file_system: &JsObject,
  method_name: &str,
) -> napi::Result<impl Fn(Params) -> napi::Result<Response>> {
  let jsfn: JsFunction = js_file_system.get_property(env.create_string(method_name)?)?;
  let js_fn_ref = FunctionRef::new(
    *env,
    js_file_system.get_property(env.create_string(method_name)?)?,
  )?;

  let threadsafe_function: ThreadsafeFunction<Params, ErrorStrategy::Fatal> = jsfn
    .create_threadsafe_function(
      0,
      |ctx: napi::threadsafe_function::ThreadSafeCallContext<Params>| {
        Ok(vec![ctx.env.to_js_value(&ctx.value)?])
      },
    )?;

  let tid = std::thread::current().id();

  let result = move |params| {
    let env = js_fn_ref.env;
    if std::thread::current().id() == tid {
      let jsfn = js_fn_ref.get()?;
      let result = jsfn.call(None, &[env.to_js_value(&params)?])?;
      return env.from_js_value(result);
    }

    let (tx, rx) = crossbeam_channel::bounded(1);
    threadsafe_function.call_with_return_value(
      params,
      ThreadsafeFunctionCallMode::Blocking,
      move |result: JsUnknown| {
        let result = if result.is_error()? {
          Err(napi::Error::from(result))
        } else {
          env.from_js_value(result)
        };
        let _ = tx.send(result);
        Ok(())
      },
    );
    rx.recv().unwrap()
  };

  Ok(result)
}

#[cfg(not(target_arch = "wasm32"))]

enum EitherFs<A, B> {
  A(A),
  B(B),
}

#[cfg(not(target_arch = "wasm32"))]
impl<A: FileSystem, B: FileSystem> FileSystem for EitherFs<A, B> {
  fn canonicalize(
    &self,
    path: &Path,
    cache: &DashMap<PathBuf, Option<PathBuf>, GxBuildHasher>,
  ) -> std::io::Result<std::path::PathBuf> {
    match self {
      EitherFs::A(a) => a.canonicalize(path, cache),
      EitherFs::B(b) => b.canonicalize(path, cache),
    }
  }

  fn read(&self, path: &Path) -> std::io::Result<Vec<u8>> {
    match self {
      EitherFs::A(a) => a.read(path),
      EitherFs::B(b) => b.read(path),
    }
  }

  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    match self {
      EitherFs::A(a) => a.read_to_string(path),
      EitherFs::B(b) => b.read_to_string(path),
    }
  }

  fn is_file(&self, path: &Path) -> bool {
    match self {
      EitherFs::A(a) => a.is_file(path),
      EitherFs::B(b) => b.is_file(path),
    }
  }

  fn is_dir(&self, path: &Path) -> bool {
    match self {
      EitherFs::A(a) => a.is_dir(path),
      EitherFs::B(b) => b.is_dir(path),
    }
  }
}

#[napi(object)]
pub struct ResolveOptions {
  pub filename: String,
  pub specifier_type: String,
  pub parent: String,
  pub package_conditions: Option<Vec<String>>,
}

#[napi(object)]
pub struct FilePathCreateInvalidation {
  pub file_path: String,
}

#[napi(object)]
pub struct FileNameCreateInvalidation {
  pub file_name: String,
  pub above_file_path: String,
}

#[napi(object)]
pub struct GlobCreateInvalidation {
  pub glob: String,
}

#[napi(object)]
pub struct ResolveResult {
  pub resolution: JsUnknown,
  pub invalidate_on_file_change: Vec<String>,
  pub invalidate_on_file_create:
    Vec<Either3<FilePathCreateInvalidation, FileNameCreateInvalidation, GlobCreateInvalidation>>,
  pub query: Option<String>,
  pub side_effects: bool,
  pub error: JsUnknown,
  pub module_type: u8,
}

#[napi(object)]
pub struct JsInvalidations {
  pub invalidate_on_file_change: Vec<String>,
  pub invalidate_on_file_create:
    Vec<Either3<FilePathCreateInvalidation, FileNameCreateInvalidation, GlobCreateInvalidation>>,
  pub invalidate_on_startup: bool,
}

#[napi]
pub struct Resolver {
  mode: u8,
  #[cfg(not(target_arch = "wasm32"))]
  resolver: parcel_resolver::Resolver<'static, EitherFs<JsFileSystem, OsFileSystem>>,
  #[cfg(target_arch = "wasm32")]
  resolver: parcel_resolver::Resolver<'static, JsFileSystem>,
  #[cfg(not(target_arch = "wasm32"))]
  invalidations_cache: parcel_dev_dep_resolver::Cache,
}

#[napi]
impl Resolver {
  #[napi(constructor)]
  pub fn new(project_root: String, options: JsResolverOptions, env: Env) -> Result<Self> {
    #[cfg(not(target_arch = "wasm32"))]
    let fs = if let Some(fs) = &options.fs {
      EitherFs::A(JsFileSystem::new(&env, fs)?)
    } else {
      EitherFs::B(OsFileSystem)
    };
    #[cfg(target_arch = "wasm32")]
    let fs = {
      let fsjs = options.fs.unwrap();
      JsFileSystem {
        canonicalize: FunctionRef::new(env, fsjs.canonicalize)?,
        read: FunctionRef::new(env, fsjs.read)?,
        is_file: FunctionRef::new(env, fsjs.is_file)?,
        is_dir: FunctionRef::new(env, fsjs.is_dir)?,
      }
    };

    let mut resolver = match options.mode {
      1 => parcel_resolver::Resolver::parcel(
        Cow::Owned(project_root.into()),
        parcel_resolver::CacheCow::Owned(parcel_resolver::Cache::new(fs)),
      ),
      2 => parcel_resolver::Resolver::node(
        Cow::Owned(project_root.into()),
        parcel_resolver::CacheCow::Owned(parcel_resolver::Cache::new(fs)),
      ),
      _ => return Err(napi::Error::new(napi::Status::InvalidArg, "Invalid mode")),
    };

    if let Some(include_node_modules) = options.include_node_modules {
      resolver.include_node_modules = Cow::Owned(match include_node_modules {
        Either3::A(b) => IncludeNodeModules::Bool(b),
        Either3::B(v) => IncludeNodeModules::Array(v),
        Either3::C(v) => IncludeNodeModules::Map(v.into_iter().collect()),
      });
    }

    if let Some(conditions) = options.conditions {
      resolver.conditions = ExportsCondition::from_bits_truncate(conditions);
    }

    if let Some(entries) = options.entries {
      resolver.entries = Fields::from_bits_truncate(entries);
    }

    if let Some(extensions) = options.extensions {
      resolver.extensions = Extensions::Owned(extensions);
    }

    resolver.flags.set(Flags::EXPORTS, options.package_exports);

    if matches!(options.typescript, Some(true)) {
      resolver.flags |= Flags::TYPESCRIPT;
    }

    if let Some(module_dir_resolver) = options.module_dir_resolver {
      let module_dir_resolver = FunctionRef::new(env, module_dir_resolver)?;
      resolver.module_dir_resolver = Some(Arc::new(move |module: &str, from: &Path| {
        let call = |module: &str| -> napi::Result<PathBuf> {
          let env = module_dir_resolver.env;
          let s = env.create_string(module)?;
          let f = env.create_string(from.to_string_lossy().as_ref())?;
          let res: JsString = module_dir_resolver.get()?.call(None, &[s, f])?.try_into()?;
          let utf8 = res.into_utf8()?;
          Ok(utf8.into_owned()?.into())
        };

        let r = call(module);
        r.map_err(|_| ResolverError::ModuleNotFound {
          module: module.to_owned(),
        })
      }));
    }

    Ok(Self {
      mode: options.mode,
      resolver,
      #[cfg(not(target_arch = "wasm32"))]
      invalidations_cache: Default::default(),
    })
  }

  fn resolve_internal(
    &self,
    options: ResolveOptions,
  ) -> napi::Result<(parcel_resolver::ResolveResult, bool, u8)> {
    let mut res = self.resolver.resolve_with_options(
      &options.filename,
      Path::new(&options.parent),
      match options.specifier_type.as_ref() {
        "esm" => SpecifierType::Esm,
        "commonjs" => SpecifierType::Cjs,
        "url" => SpecifierType::Url,
        _ => {
          return Err(napi::Error::new(
            napi::Status::InvalidArg,
            format!("Invalid specifier type: {}", options.specifier_type),
          ))
        }
      },
      if let Some(conditions) = options.package_conditions {
        get_resolve_options(conditions)
      } else {
        Default::default()
      },
    );

    let side_effects = if let Ok((Resolution::Path(p), _)) = &res.result {
      match self.resolver.resolve_side_effects(p, &res.invalidations) {
        Ok(side_effects) => side_effects,
        Err(err) => {
          res.result = Err(err);
          true
        }
      }
    } else {
      true
    };

    let mut module_type = 0;

    if self.mode == 2 {
      if let Ok((Resolution::Path(p), _)) = &res.result {
        module_type = match self.resolver.resolve_module_type(p, &res.invalidations) {
          Ok(t) => match t {
            ModuleType::CommonJs | ModuleType::Json => 1,
            ModuleType::Module => 2,
          },
          Err(err) => {
            res.result = Err(err);
            0
          }
        }
      }
    }

    Ok((res, side_effects, module_type))
  }

  fn resolve_result_to_js(
    &self,
    env: Env,
    res: parcel_resolver::ResolveResult,
    side_effects: bool,
    module_type: u8,
  ) -> napi::Result<ResolveResult> {
    let (invalidate_on_file_change, invalidate_on_file_create) =
      convert_invalidations(res.invalidations);

    match res.result {
      Ok((res, query)) => Ok(ResolveResult {
        resolution: env.to_js_value(&res)?,
        invalidate_on_file_change,
        invalidate_on_file_create,
        side_effects,
        query,
        error: env.get_undefined()?.into_unknown(),
        module_type,
      }),
      Err(err) => Ok(ResolveResult {
        resolution: env.get_undefined()?.into_unknown(),
        invalidate_on_file_change,
        invalidate_on_file_create,
        side_effects: true,
        query: None,
        error: env.to_js_value(&err)?,
        module_type: 0,
      }),
    }
  }

  #[napi]
  pub fn resolve(&self, options: ResolveOptions, env: Env) -> Result<ResolveResult> {
    let (res, side_effects, module_type) = self.resolve_internal(options)?;
    self.resolve_result_to_js(env, res, side_effects, module_type)
  }

  #[cfg(target_arch = "wasm32")]
  #[napi]
  pub fn resolve_async(&'static self) -> Result<JsObject> {
    panic!("resolveAsync() is not supported in Wasm builds")
  }

  #[cfg(not(target_arch = "wasm32"))]
  #[napi]
  pub fn resolve_async(&'static self, options: ResolveOptions, env: Env) -> Result<JsObject> {
    let (deferred, promise) = env.create_deferred()?;
    let resolver = &self.resolver;

    if matches!(resolver.cache.fs, EitherFs::A(..)) || resolver.module_dir_resolver.is_some() {
      return Err(napi::Error::new(
        napi::Status::GenericFailure,
        "resolveAsync does not support custom fs or module_dir_resolver",
      ));
    }

    rayon::spawn(move || {
      let (res, side_effects, module_type) = match self.resolve_internal(options) {
        Ok(r) => r,
        Err(e) => return deferred.reject(e),
      };

      deferred.resolve(move |env| self.resolve_result_to_js(env, res, side_effects, module_type));
    });

    Ok(promise)
  }

  #[cfg(target_arch = "wasm32")]
  #[napi]
  pub fn get_invalidations(&self, _path: String) -> napi::Result<JsInvalidations> {
    panic!("getInvalidations() is not supported in Wasm builds")
  }

  #[cfg(not(target_arch = "wasm32"))]
  #[napi]
  pub fn get_invalidations(&self, path: String) -> napi::Result<JsInvalidations> {
    let path = Path::new(&path);
    match parcel_dev_dep_resolver::build_esm_graph(
      path,
      &self.resolver.project_root,
      &self.resolver.cache,
      &self.invalidations_cache,
    ) {
      Ok(invalidations) => {
        let invalidate_on_startup = invalidations.invalidate_on_startup.load(Ordering::Relaxed);
        let (invalidate_on_file_change, invalidate_on_file_create) =
          convert_invalidations(invalidations);
        Ok(JsInvalidations {
          invalidate_on_file_change,
          invalidate_on_file_create,
          invalidate_on_startup,
        })
      }
      Err(_) => Err(napi::Error::new(
        napi::Status::GenericFailure,
        "Failed to resolve invalidations",
      )),
    }
  }
}

fn convert_invalidations(
  invalidations: Invalidations,
) -> (
  Vec<String>,
  Vec<Either3<FilePathCreateInvalidation, FileNameCreateInvalidation, GlobCreateInvalidation>>,
) {
  let invalidate_on_file_change = invalidations
    .invalidate_on_file_change
    .into_iter()
    .map(|p| p.to_string_lossy().into_owned())
    .collect();
  let invalidate_on_file_create = invalidations
    .invalidate_on_file_create
    .into_iter()
    .map(|i| match i {
      FileCreateInvalidation::Path(p) => Either3::A(FilePathCreateInvalidation {
        file_path: p.to_string_lossy().into_owned(),
      }),
      FileCreateInvalidation::FileName { file_name, above } => {
        Either3::B(FileNameCreateInvalidation {
          file_name,
          above_file_path: above.to_string_lossy().into_owned(),
        })
      }
      FileCreateInvalidation::Glob(glob) => Either3::C(GlobCreateInvalidation { glob }),
    })
    .collect();
  (invalidate_on_file_change, invalidate_on_file_create)
}

fn get_resolve_options(mut custom_conditions: Vec<String>) -> parcel_resolver::ResolveOptions {
  let mut conditions = ExportsCondition::empty();
  custom_conditions.retain(|condition| {
    if let Ok(cond) = ExportsCondition::try_from(condition.as_ref()) {
      conditions |= cond;
      false
    } else {
      true
    }
  });

  parcel_resolver::ResolveOptions {
    conditions,
    custom_conditions,
  }
}
