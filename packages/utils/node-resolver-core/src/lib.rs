use napi::{
  bindgen_prelude::{Reference, SharedReference, Undefined},
  Env, JsBoolean, JsBuffer, JsFunction, JsString, Ref, Result,
};
use napi_derive::napi;
use std::{borrow::Cow, io::ErrorKind, path::Path};

use parcel_resolver::{
  FileCreateInvalidation, FileSystem, Invalidations, OsFileSystem, Resolution, SpecifierType,
};

#[napi(object, js_name = "FileSystem")]
struct JsFileSystem {
  pub canonicalize: JsFunction,
  pub read: JsFunction,
  pub is_file: JsFunction,
  pub is_dir: JsFunction,
}

struct JsFileSystemWrapper {
  env: Env,
  canonicalize: Ref<()>,
  read: Ref<()>,
  is_file: Ref<()>,
  is_dir: Ref<()>,
}

impl Drop for JsFileSystemWrapper {
  fn drop(&mut self) {
    drop(self.canonicalize.unref(self.env));
    drop(self.read.unref(self.env));
    drop(self.is_file.unref(self.env));
    drop(self.is_dir.unref(self.env));
  }
}

impl FileSystem for JsFileSystemWrapper {
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
      Err(e) => false,
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

#[napi]
struct Cache {
  cache: parcel_resolver::Cache,
}

#[napi]
impl Cache {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      cache: parcel_resolver::Cache::default(),
    }
  }
}

#[napi(object)]
struct ResolveOptions {
  pub filename: String,
  pub specifier_type: String,
  pub parent: String,
}

#[napi(object)]
struct FilePathCreateInvalidation {
  pub file_path: String,
}

#[napi(object)]
struct FileNameCreateInvalidation {
  pub file_name: String,
  pub above_file_path: String,
}

#[napi(object)]
struct ResolveResult {
  pub file_path: Option<String>,
  pub builtin: Option<String>,
  pub invalidate_on_file_change: Vec<String>,
  pub invalidate_on_file_create:
    Vec<napi::Either<FilePathCreateInvalidation, FileNameCreateInvalidation>>,
  pub query: Undefined,
  pub side_effects: bool,
}

#[napi]
struct Resolver {
  // cache: SharedReference<Cache, &'static parcel_resolver::Cache>,
  resolver: parcel_resolver::Resolver<'static, JsFileSystemWrapper>,
}

#[napi]
impl Resolver {
  #[napi(constructor)]
  pub fn new(project_root: String, fs: JsFileSystem, env: Env) -> Result<Self> {
    // let cache = cache.share_with(env, |cache| Ok(&cache.cache))?;

    Ok(Self {
      // cache,
      resolver: parcel_resolver::Resolver::parcel(
        Cow::Owned(project_root.into()),
        // parcel_resolver::CacheCow::Borrowed(*cache),
        parcel_resolver::CacheCow::Owned(parcel_resolver::Cache::new(JsFileSystemWrapper {
          env,
          canonicalize: env.create_reference(fs.canonicalize)?,
          read: env.create_reference(fs.read)?,
          is_file: env.create_reference(fs.is_file)?,
          is_dir: env.create_reference(fs.is_dir)?,
        })),
      ),
    })
  }

  #[napi]
  pub fn resolve(&self, options: ResolveOptions) -> Result<ResolveResult> {
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

    match res {
      Ok((Resolution::Path(p), invalidations)) => {
        let (invalidate_on_file_change, invalidate_on_file_create) =
          convert_invalidations(invalidations);
        let side_effects = self.resolver.resolve_side_effects(&p).unwrap();
        Ok(ResolveResult {
          file_path: Some(p.to_string_lossy().into_owned()),
          builtin: None,
          invalidate_on_file_change,
          invalidate_on_file_create,
          side_effects,
          query: (),
        })
      }
      Ok((Resolution::Excluded, invalidations)) => {
        let (invalidate_on_file_change, invalidate_on_file_create) =
          convert_invalidations(invalidations);
        Ok(ResolveResult {
          file_path: None,
          builtin: None,
          invalidate_on_file_change,
          invalidate_on_file_create,
          side_effects: true,
          query: (),
        })
      }
      Ok((Resolution::Builtin(builtin), invalidations)) => {
        let (invalidate_on_file_change, invalidate_on_file_create) =
          convert_invalidations(invalidations);
        Ok(ResolveResult {
          file_path: None,
          builtin: Some(builtin),
          invalidate_on_file_change,
          invalidate_on_file_create,
          side_effects: true,
          query: (),
        })
      }
      Err((err, invalidations)) => {
        let (invalidate_on_file_change, invalidate_on_file_create) =
          convert_invalidations(invalidations);
        println!("{:?}", err);
        // Err(napi::Error::new(
        //   napi::Status::GenericFailure,
        //   format!(
        //     "Failed to resolve {} from {}",
        //     options.filename, options.parent
        //   ),
        // ))
        Ok(ResolveResult {
          file_path: None,
          builtin: None,
          invalidate_on_file_change,
          invalidate_on_file_create,
          side_effects: true,
          query: (),
        })
      }
      _ => Err(napi::Error::new(
        napi::Status::GenericFailure,
        format!(
          "Failed to resolve {} from {}",
          options.filename, options.parent
        ),
      )),
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
