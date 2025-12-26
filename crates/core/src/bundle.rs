use std::{path::PathBuf, sync::Arc};

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

use crate::{AssetType, Environment, impl_bitflags_serde};

#[derive(Debug)]
pub struct Bundle {
  pub ty: AssetType,
  pub env: Arc<Environment>,
  pub bundle_behavior: BundleBehavior,
  pub flags: BundleFlags,
  pub name: Option<PathBuf>,
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
