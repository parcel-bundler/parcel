use std::sync::Arc;

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

use crate::{AssetType, PathId, SourceUrl, Target, impl_bitflags_serde};

#[derive(Debug)]
pub struct Bundle {
  pub ty: AssetType,
  pub target: Arc<Target>,
  pub bundle_behavior: BundleBehavior,
  pub flags: BundleFlags,
  pub dist_path: Option<PathId>,
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
    Some(self.dist_path?.relative_url(&from.dist_path?))
  }

  pub fn relative_specifier(&self, from: &Bundle) -> Option<String> {
    self.relative_url(from).map(|mut r| {
      if !r.starts_with(".") {
        r.insert_str(0, "./");
      }
      r
    })
  }

  pub fn dist_path(&self) -> PathId {
    self.dist_path.unwrap()
  }

  pub fn dist_url(&self) -> SourceUrl {
    SourceUrl::from_path(&self.dist_path())
  }

  pub fn name(&self) -> String {
    self
      .dist_path()
      .relative_url_from_dir(&self.target.dist_dir)
  }

  pub fn absolute_url(&self) -> String {
    let name = self.name();
    let public_url = self.target.public_url.trim_end_matches('/');
    if public_url.is_empty() {
      format!("/{}", name)
    } else {
      format!("{}/{}", public_url, name)
    }
  }
}
