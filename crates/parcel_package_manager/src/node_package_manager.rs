use std::borrow::Cow;

use anyhow::anyhow;
use parcel_filesystem::FileSystem;
use parcel_resolver::{Resolution, SpecifierType};

use crate::PackageManager;

pub struct NodePackageManager<Fs: FileSystem + 'static> {
  resolver: parcel_resolver::Resolver<'static, Fs>,
}

impl<Fs: FileSystem> NodePackageManager<Fs> {
  fn new(project_root: String, fs: Fs) -> Self {
    Self {
      resolver: parcel_resolver::Resolver::node(
        Cow::Owned(project_root.into()),
        parcel_resolver::CacheCow::Owned(parcel_resolver::Cache::new(fs)),
      ),
    }
  }
}

impl<Fs: FileSystem> PackageManager for NodePackageManager<Fs> {
  fn resolve(&self, specifier: &str, from: &std::path::Path) -> anyhow::Result<crate::Resolution> {
    let res = self.resolver.resolve(specifier, from, SpecifierType::Cjs);

    match res.result {
      Result::Ok((resolution, _invalidations)) => match resolution {
        Resolution::Path(pathbuf) => Ok(crate::Resolution { resolved: pathbuf }),
        other_case => Err(anyhow!(format!("Err: {:?}", other_case))),
      },
      // TOOO This is definitely not right
      Result::Err(err) => Err(anyhow!(format!("Err: {:?}", err))),
    }
  }
}
