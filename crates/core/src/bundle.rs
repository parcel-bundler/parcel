use std::{path::PathBuf, sync::Arc};

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

use crate::{AssetType, BundleBehavior, Environment, impl_bitflags_serde};

pub struct Bundle {
  pub ty: AssetType,
  pub env: Arc<Environment>,
  pub bundle_behavior: BundleBehavior,
  pub flags: BundleFlags,
  pub name: Option<PathBuf>,
  pub assets: Vec<usize>,
  pub entry_assets: Vec<usize>,
  pub main_entry_asset: Option<usize>,
}

bitflags! {
  #[derive(Debug, Clone, Copy)]
  pub struct BundleFlags: u8 {
    const NEEDS_STABLE_NAME = 1 << 0;
    const IS_SPLITTABLE = 1 << 1;
    const IS_PLACEHOLDER = 1 << 2;
  }
}

impl_bitflags_serde!(BundleFlags);
