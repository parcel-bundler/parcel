use napi::{
  bindgen_prelude::Undefined, Env, JsBoolean, JsBuffer, JsFunction, JsString, JsUnknown, Ref,
  Result,
};
use napi_derive::napi;
use std::{borrow::Cow, collections::HashMap, path::Path};

use parcel_resolver::{
  ExportsCondition, Fields, FileCreateInvalidation, FileSystem, IncludeNodeModules, Invalidations,
  OsFileSystem, Resolution, SpecifierType,
};

#[napi(object)]
pub struct JsFileSystemOptions {
  pub canonicalize: JsFunction,
  pub read: JsFunction,
  pub is_file: JsFunction,
  pub is_dir: JsFunction,
  pub include_node_modules:
    Option<napi::Either<bool, napi::Either<Vec<String>, HashMap<String, bool>>>>,
}

#[napi(object, js_name = "FileSystem")]
pub struct JsResolverOptions {
  pub fs: Option<JsFileSystemOptions>,
  pub include_node_modules:
    Option<napi::Either<bool, napi::Either<Vec<String>, HashMap<String, bool>>>>,
  pub is_browser: bool,
  pub conditions: u16,
}

struct JsFileSystem {
  env: Env,
  canonicalize: Ref<()>,
  read: Ref<()>,
  is_file: Ref<()>,
  is_dir: Ref<()>,
}

impl Drop for JsFileSystem {
  fn drop(&mut self) {
    drop(self.canonicalize.unref(self.env));
    drop(self.read.unref(self.env));
    drop(self.is_file.unref(self.env));
    drop(self.is_dir.unref(self.env));
  }
}

impl FileSystem for JsFileSystem {
  fn canonicalize<P: AsRef<Path>>(&self, path: P) -> std::io::Result<std::path::PathBuf> {
    let canonicalize = || -> napi::Result<_> {
      let path = path.as_ref().to_string_lossy();
      let path = self.env.create_string(path.as_ref())?;
      let canonicalize: JsFunction = self.env.get_reference_value(&self.canonicalize)?;
      let res: JsString = canonicalize.call(None, &[path])?.try_into()?;
      let utf8 = res.into_utf8()?;
      Ok(utf8.into_owned()?.into())
    };

    canonicalize().map_err(|_| std::io::Error::new(std::io::ErrorKind::NotFound, "Test"))
  }

  fn read_to_string<P: AsRef<Path>>(&self, path: P) -> std::io::Result<String> {
    let read = || -> napi::Result<_> {
      let path = path.as_ref().to_string_lossy();
      let path = self.env.create_string(path.as_ref())?;
      let read: JsFunction = self.env.get_reference_value(&self.read)?;
      let res: JsBuffer = read.call(None, &[path])?.try_into()?;
      let value = res.into_value()?;
      Ok(unsafe { String::from_utf8_unchecked(value.to_vec()) })
    };

    read().map_err(|_| std::io::Error::new(std::io::ErrorKind::NotFound, "Test"))
  }

  fn is_file<P: AsRef<Path>>(&self, path: P) -> bool {
    let is_file = || -> napi::Result<_> {
      let path = path.as_ref().to_string_lossy();
      let p = self.env.create_string(path.as_ref())?;
      let is_file: JsFunction = self.env.get_reference_value(&self.is_file)?;
      let res: JsBoolean = is_file.call(None, &[p])?.try_into()?;
      res.get_value()
    };

    match is_file() {
      Ok(res) => res,
      Err(_) => false,
    }
  }

  fn is_dir<P: AsRef<Path>>(&self, path: P) -> bool {
    let is_dir = || -> napi::Result<_> {
      let path = path.as_ref().to_string_lossy();
      let path = self.env.create_string(path.as_ref())?;
      let is_dir: JsFunction = self.env.get_reference_value(&self.is_dir)?;
      let res: JsBoolean = is_dir.call(None, &[path])?.try_into()?;
      res.get_value()
    };

    match is_dir() {
      Ok(res) => res,
      Err(_) => false,
    }
  }
}

enum EitherFs<A, B> {
  A(A),
  B(B),
}

impl<A: FileSystem, B: FileSystem> FileSystem for EitherFs<A, B> {
  fn canonicalize<P: AsRef<Path>>(&self, path: P) -> std::io::Result<std::path::PathBuf> {
    match self {
      EitherFs::A(a) => a.canonicalize(path),
      EitherFs::B(b) => b.canonicalize(path),
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
pub struct ResolveResult {
  pub resolution: JsUnknown,
  pub invalidate_on_file_change: Vec<String>,
  pub invalidate_on_file_create:
    Vec<napi::Either<FilePathCreateInvalidation, FileNameCreateInvalidation>>,
  pub query: Option<String>,
  pub side_effects: bool,
  pub error: JsUnknown,
}

#[napi]
pub struct Resolver {
  resolver: parcel_resolver::Resolver<'static, EitherFs<JsFileSystem, OsFileSystem>>,
}

#[napi]
impl Resolver {
  #[napi(constructor)]
  pub fn new(project_root: String, options: JsResolverOptions, env: Env) -> Result<Self> {
    let fs = if let Some(fs) = options.fs {
      EitherFs::A(JsFileSystem {
        env,
        canonicalize: env.create_reference(fs.canonicalize)?,
        read: env.create_reference(fs.read)?,
        is_file: env.create_reference(fs.is_file)?,
        is_dir: env.create_reference(fs.is_dir)?,
      })
    } else {
      EitherFs::B(OsFileSystem)
    };

    let mut resolver = parcel_resolver::Resolver::parcel(
      Cow::Owned(project_root.into()),
      parcel_resolver::CacheCow::Owned(parcel_resolver::Cache::new(fs)),
    );

    if let Some(include_node_modules) = options.include_node_modules {
      resolver.include_node_modules = Cow::Owned(match include_node_modules {
        napi::Either::A(b) => IncludeNodeModules::Bool(b),
        napi::Either::B(napi::Either::A(v)) => IncludeNodeModules::Array(v),
        napi::Either::B(napi::Either::B(v)) => IncludeNodeModules::Map(v),
      });
    }

    if !options.is_browser {
      resolver.entries.remove(Fields::BROWSER);
    }

    resolver.conditions = ExportsCondition::from_bits_truncate(options.conditions);
    Ok(Self { resolver })
  }

  #[napi]
  pub fn resolve(&self, options: ResolveOptions, env: Env) -> Result<ResolveResult> {
    let res = self.resolver.resolve(
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
    );

    let (invalidate_on_file_change, invalidate_on_file_create) =
      convert_invalidations(res.invalidations);
    match res.result {
      Ok((res, query)) => {
        let side_effects = if let Resolution::Path(p) = &res {
          self.resolver.resolve_side_effects(&p).unwrap()
        } else {
          true
        };
        Ok(ResolveResult {
          resolution: env.to_js_value(&res)?,
          invalidate_on_file_change,
          invalidate_on_file_create,
          side_effects,
          query: query.map(|q| q.to_owned()),
          error: env.get_undefined()?.into_unknown(),
        })
      }
      Err(err) => {
        println!("{:?}", err);
        // Err(napi::Error::new(
        //   napi::Status::GenericFailure,
        //   format!(
        //     "Failed to resolve {} from {}",
        //     options.filename, options.parent
        //   ),
        // ))
        Ok(ResolveResult {
          resolution: env.get_undefined()?.into_unknown(),
          invalidate_on_file_change,
          invalidate_on_file_create,
          side_effects: true,
          query: None,
          error: env.to_js_value(&err)?,
        })
      }
    }
  }
}

fn convert_invalidations(
  invalidations: Invalidations,
) -> (
  Vec<String>,
  Vec<napi::Either<FilePathCreateInvalidation, FileNameCreateInvalidation>>,
) {
  let invalidate_on_file_change = invalidations
    .invalidate_on_file_change
    .into_inner()
    .unwrap()
    .into_iter()
    .map(|p| p.to_string_lossy().into_owned())
    .collect();
  let invalidate_on_file_create = invalidations
    .invalidate_on_file_create
    .into_inner()
    .unwrap()
    .into_iter()
    .map(|i| match i {
      FileCreateInvalidation::Path(p) => napi::Either::A(FilePathCreateInvalidation {
        file_path: p.to_string_lossy().into_owned(),
      }),
      FileCreateInvalidation::FileName { file_name, above } => {
        napi::Either::B(FileNameCreateInvalidation {
          file_name,
          above_file_path: above.to_string_lossy().into_owned(),
        })
      }
    })
    .collect();
  (invalidate_on_file_change, invalidate_on_file_create)
}
