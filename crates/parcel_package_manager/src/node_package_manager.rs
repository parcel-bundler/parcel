use std::{borrow::Cow, sync::Arc};

use anyhow::anyhow;
use parcel_filesystem::FileSystemRef;
use parcel_resolver::{Resolution, SpecifierType};

use crate::PackageManager;

pub struct NodePackageManager<'a> {
  resolver: parcel_resolver::Resolver<'a>,
}

impl<'a> NodePackageManager<'a> {
  pub fn new(project_root: &str, fs: FileSystemRef) -> Self {
    Self {
      resolver: parcel_resolver::Resolver::node(
        Cow::Owned(project_root.into()),
        parcel_resolver::CacheCow::Owned(parcel_resolver::Cache::new(fs)),
      ),
    }
  }
}

impl<'a> PackageManager for NodePackageManager<'a> {
  fn resolve(&self, specifier: &str, from: &std::path::Path) -> anyhow::Result<crate::Resolution> {
    let res = self.resolver.resolve(specifier, from, SpecifierType::Cjs);

    match res.result {
      Result::Ok((resolution, _invalidations)) => match resolution {
        Resolution::Path(pathbuf) => Ok(crate::Resolution { resolved: pathbuf }),
        other_case => Err(anyhow!(format!("Err: {:?}", other_case))),
      },
      // TODO: This is definitely not right
      Result::Err(err) => Err(anyhow!(format!("Err: {:?}", err))),
    }
  }
}
