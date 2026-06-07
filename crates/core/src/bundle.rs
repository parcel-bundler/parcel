use std::{path::PathBuf, sync::Arc};

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

use crate::{AssetType, SourceUrl, Target, impl_bitflags_serde};

#[derive(Debug)]
pub struct Bundle {
  pub ty: AssetType,
  pub target: Arc<Target>,
  pub bundle_behavior: BundleBehavior,
  pub flags: BundleFlags,
  pub name: Option<String>,
  pub assets: Vec<usize>,
  pub entry_assets: Vec<usize>,
  pub main_entry_asset: Option<usize>,
  pub referenced_bundles: Vec<usize>,
}

bitflags! {
  #[derive(Debug, Clone, Copy)]
  pub struct BundleFlags: u8 {
    const NEEDS_STABLE_NAME = 1 << 0;
    const IS_SPLITTABLE = 1 << 1;
    const IS_PLACEHOLDER = 1 << 2;
    const ENTRY = 1 << 3;
  }
}

impl_bitflags_serde!(BundleFlags);

#[derive(Debug, Default, PartialEq, Eq, Hash, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BundleBehavior {
  #[default]
  None,
  Inline,
  Isolated,
}

impl Bundle {
  pub fn relative_url(&self, from: &Bundle) -> Option<String> {
    if let (Some(this), Some(from)) = (&self.name, &from.name) {
      let root = url::Url::parse("file:///").unwrap();
      let this = root.join(this).ok()?;
      let from = root.join(from).ok()?;
      from.make_relative(&this)
    } else {
      None
    }
  }

  pub fn relative_specifier(&self, from: &Bundle) -> Option<String> {
    self.relative_url(from).map(|mut r| {
      if !r.starts_with(".") {
        r.insert_str(0, "./");
      }
      r
    })
  }

  pub fn dist_path(&self, project_root: &SourceUrl) -> PathBuf {
    self.dist_url().to_file_path(project_root).unwrap()
  }

  pub fn dist_url(&self) -> SourceUrl {
    self.target.dist_dir.join(self.name.as_ref().unwrap())
  }
}
