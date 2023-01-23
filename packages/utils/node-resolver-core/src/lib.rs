use napi::{
  bindgen_prelude::{Reference, SharedReference, Undefined},
  Env, Result,
};
use napi_derive::napi;
use std::{borrow::Cow, path::Path};

use parcel_resolver::{FileCreateInvalidation, Invalidations, Resolution, SpecifierType};

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
  pub invalidate_on_file_change: Vec<String>,
  pub invalidate_on_file_create:
    Vec<napi::Either<FilePathCreateInvalidation, FileNameCreateInvalidation>>,
  pub query: Undefined,
  pub side_effects: bool,
}

#[napi]
struct Resolver {
  // cache: SharedReference<Cache, &'static parcel_resolver::Cache>,
  resolver: parcel_resolver::Resolver<'static>,
}

#[napi]
impl Resolver {
  #[napi(constructor)]
  pub fn new(project_root: String) -> Result<Self> {
    // let cache = cache.share_with(env, |cache| Ok(&cache.cache))?;

    Ok(Self {
      // cache,
      resolver: parcel_resolver::Resolver::parcel(
        Cow::Owned(project_root.into()),
        // parcel_resolver::CacheCow::Borrowed(*cache),
        parcel_resolver::CacheCow::Owned(parcel_resolver::Cache::default()),
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
