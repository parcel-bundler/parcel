use std::{
  borrow::Cow,
  path::{Path, PathBuf},
};

use crate::{
  request_tracker::{Request, RequestResult},
  types::Dependency,
};
use parcel_resolver::{Cache, CacheCow, OsFileSystem, Resolution, Resolver};

// TODO: find a way to have a cached resolver per project.
lazy_static::lazy_static! {
  static ref RESOLVER: Resolver<'static, OsFileSystem> = {
    Resolver::parcel(
      Cow::Borrowed(Path::new("/")),
      CacheCow::Owned(Cache::new(OsFileSystem::default())),
    )
  };
}

#[derive(Hash)]
pub struct PathRequest {
  pub dep: Dependency,
}

impl Request for PathRequest {
  type Output = PathBuf;

  fn run(&self, _farm: &crate::worker_farm::WorkerFarm) -> RequestResult<Self::Output> {
    let (res, _) = RESOLVER
      .resolve(
        &self.dep.specifier,
        self
          .dep
          .source_path
          .as_ref()
          .map(|p| p.as_path())
          .unwrap_or(Path::new("/")),
        parcel_resolver::SpecifierType::Esm,
      )
      .result
      .unwrap();

    if let Resolution::Path(path) = res {
      RequestResult {
        result: Ok(path),
        invalidations: Vec::new(),
      }
    } else {
      // TODO
      RequestResult {
        result: Ok(
          Path::new(
            "/Users/devongovett/dev/parcel/packages/utils/node-resolver-core/src/_empty.js",
          )
          .into(),
        ),
        invalidations: Vec::new(),
      }
    }
  }
}
