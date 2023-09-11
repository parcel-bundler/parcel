use dashmap::DashMap;
use napi::{Env, JsBoolean, JsBuffer, JsFunction, JsObject, JsString, JsUnknown, Ref, Result};
use napi_derive::napi;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::atomic::Ordering;
use std::{
  borrow::Cow,
  collections::HashMap,
  path::{Path, PathBuf},
  sync::Arc,
};

#[cfg(not(target_arch = "wasm32"))]
use parcel_resolver::OsFileSystem;
use parcel_resolver::{
  ExportsCondition, Extensions, Fields, FileCreateInvalidation, FileSystem, Flags,
  IncludeNodeModules, Invalidations, ModuleType, Resolution, ResolverError, SpecifierType,
};

type NapiSideEffectsVariants = napi::Either<bool, napi::Either<Vec<String>, HashMap<String, bool>>>;

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
  pub fs: Option<JsFileSystemOptions>,
  pub include_node_modules: Option<NapiSideEffectsVariants>,
  pub conditions: Option<u16>,
  pub module_dir_resolver: Option<JsFunction>,
  pub mode: u8,
  pub entries: Option<u8>,
  pub extensions: Option<Vec<String>>,
  pub package_exports: bool,
}

struct FunctionRef {
  env: Env,
  reference: Ref<()>,
}

// We don't currently call functions from multiple threads, but we'll need to change this when we do.
unsafe impl Send for FunctionRef {}
unsafe impl Sync for FunctionRef {}

impl FunctionRef {
  fn new(env: Env, f: JsFunction) -> napi::Result<Self> {
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

struct JsFileSystem {
  canonicalize: FunctionRef,
  read: FunctionRef,
  is_file: FunctionRef,
  is_dir: FunctionRef,
}

impl FileSystem for JsFileSystem {
  fn canonicalize<P: AsRef<Path>>(
    &self,
    path: P,
    _cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> std::io::Result<std::path::PathBuf> {
    let canonicalize = || -> napi::Result<_> {
      let path = path.as_ref().to_string_lossy();
      let path = self.canonicalize.env.create_string(path.as_ref())?;
      let res: JsString = self.canonicalize.get()?.call(None, &[path])?.try_into()?;
      let utf8 = res.into_utf8()?;
      Ok(utf8.into_owned()?.into())
    };

    canonicalize().map_err(|err| std::io::Error::new(std::io::ErrorKind::NotFound, err.to_string()))
  }

  fn read_to_string<P: AsRef<Path>>(&self, path: P) -> std::io::Result<String> {
    let read = || -> napi::Result<_> {
      let path = path.as_ref().to_string_lossy();
      let path = self.read.env.create_string(path.as_ref())?;
      let res: JsBuffer = self.read.get()?.call(None, &[path])?.try_into()?;
      let value = res.into_value()?;
      Ok(unsafe { String::from_utf8_unchecked(value.to_vec()) })
    };

    read().map_err(|err| std::io::Error::new(std::io::ErrorKind::NotFound, err.to_string()))
  }

  fn is_file<P: AsRef<Path>>(&self, path: P) -> bool {
    let is_file = || -> napi::Result<_> {
      let path = path.as_ref().to_string_lossy();
      let p = self.is_file.env.create_string(path.as_ref())?;
      let res: JsBoolean = self.is_file.get()?.call(None, &[p])?.try_into()?;
      res.get_value()
    };

    is_file().unwrap_or(false)
  }

  fn is_dir<P: AsRef<Path>>(&self, path: P) -> bool {
    let is_dir = || -> napi::Result<_> {
      let path = path.as_ref().to_string_lossy();
      let path = self.is_dir.env.create_string(path.as_ref())?;
      let res: JsBoolean = self.is_dir.get()?.call(None, &[path])?.try_into()?;
      res.get_value()
    };

    is_dir().unwrap_or(false)
  }
}

#[cfg(not(target_arch = "wasm32"))]

enum EitherFs<A, B> {
  A(A),
  B(B),
}

#[cfg(not(target_arch = "wasm32"))]
impl<A: FileSystem, B: FileSystem> FileSystem for EitherFs<A, B> {
  fn canonicalize<P: AsRef<Path>>(
    &self,
    path: P,
    cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> std::io::Result<std::path::PathBuf> {
    match self {
      EitherFs::A(a) => a.canonicalize(path, cache),
      EitherFs::B(b) => b.canonicalize(path, cache),
    }
  }

  fn read_to_string<P: AsRef<Path>>(&self, path: P) -> std::io::Result<String> {
    match self {
      EitherFs::A(a) => a.read_to_string(path),
      EitherFs::B(b) => b.read_to_string(path),
    }
  }

  fn is_file<P: AsRef<Path>>(&self, path: P) -> bool {
    match self {
      EitherFs::A(a) => a.is_file(path),
      EitherFs::B(b) => b.is_file(path),
    }
  }

  fn is_dir<P: AsRef<Path>>(&self, path: P) -> bool {
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
  pub invalidate_on_file_create: Vec<
    napi::Either<
      FilePathCreateInvalidation,
      napi::Either<FileNameCreateInvalidation, GlobCreateInvalidation>,
    >,
  >,
  pub query: Option<String>,
  pub side_effects: bool,
  pub error: JsUnknown,
  pub module_type: u8,
}

#[napi(object)]
pub struct JsInvalidations {
  pub invalidate_on_file_change: Vec<String>,
  pub invalidate_on_file_create: Vec<
    napi::Either<
      FilePathCreateInvalidation,
      napi::Either<FileNameCreateInvalidation, GlobCreateInvalidation>,
    >,
  >,
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
    let fs = if let Some(fs) = options.fs {
      EitherFs::A(JsFileSystem {
        canonicalize: FunctionRef::new(env, fs.canonicalize)?,
        read: FunctionRef::new(env, fs.read)?,
        is_file: FunctionRef::new(env, fs.is_file)?,
        is_dir: FunctionRef::new(env, fs.is_dir)?,
      })
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
        napi::Either::A(b) => IncludeNodeModules::Bool(b),
        napi::Either::B(napi::Either::A(v)) => IncludeNodeModules::Array(v),
        napi::Either::B(napi::Either::B(v)) => IncludeNodeModules::Map(v),
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
        module_type = match self.resolver.resolve_module_type(&p, &res.invalidations) {
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
  Vec<
    napi::Either<
      FilePathCreateInvalidation,
      napi::Either<FileNameCreateInvalidation, GlobCreateInvalidation>,
    >,
  >,
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
      FileCreateInvalidation::Path(p) => napi::Either::A(FilePathCreateInvalidation {
        file_path: p.to_string_lossy().into_owned(),
      }),
      FileCreateInvalidation::FileName { file_name, above } => {
        napi::Either::B(napi::Either::A(FileNameCreateInvalidation {
          file_name,
          above_file_path: above.to_string_lossy().into_owned(),
        }))
      }
      FileCreateInvalidation::Glob(glob) => {
        napi::Either::B(napi::Either::B(GlobCreateInvalidation { glob }))
      }
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
