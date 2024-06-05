use std::borrow::Cow;

use anyhow::anyhow;
use parcel_core::plugin::SpecifierType;
use parcel_filesystem::FileSystemRef;
use parcel_plugin_resolver::core::Resolution;

use crate::PackageManager;

pub struct NodePackageManager<'a> {
  resolver: parcel_plugin_resolver::core::Resolver<'a>,
}

impl<'a> NodePackageManager<'a> {
  pub fn new(project_root: &str, fs: FileSystemRef) -> Self {
    Self {
      resolver: parcel_plugin_resolver::core::Resolver::node(
        Cow::Owned(project_root.into()),
        parcel_plugin_resolver::core::CacheCow::Owned(parcel_plugin_resolver::core::Cache::new(fs)),
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
