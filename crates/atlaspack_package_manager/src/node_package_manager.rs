use std::{borrow::Cow, path::PathBuf};

use anyhow::anyhow;
use atlaspack_filesystem::FileSystemRef;
use atlaspack_resolver::{Resolution, SpecifierType};

use crate::PackageManager;

pub struct NodePackageManager<'a> {
  resolver: atlaspack_resolver::Resolver<'a>,
}

impl<'a> NodePackageManager<'a> {
  pub fn new(project_root: PathBuf, fs: FileSystemRef) -> Self {
    Self {
      resolver: atlaspack_resolver::Resolver::node(
        Cow::Owned(project_root),
        atlaspack_resolver::CacheCow::Owned(atlaspack_resolver::Cache::new(fs)),
      ),
    }
  }
}

impl<'a> PackageManager for NodePackageManager<'a> {
  fn resolve(&self, specifier: &str, from: &std::path::Path) -> anyhow::Result<crate::Resolution> {
    let res = self.resolver.resolve(specifier, from, SpecifierType::Cjs);

    match res.result? {
      (Resolution::Path(pathbuf), _invalidations) => Ok(crate::Resolution { resolved: pathbuf }),
      other_case => Err(anyhow!("Unexpected resolution result: {:?}", other_case)),
    }
  }
}
