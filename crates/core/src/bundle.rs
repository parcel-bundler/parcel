use std::{path::PathBuf, sync::Arc};

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

use crate::{AssetType, BundleBehavior, Environment, impl_bitflags_serde};

pub struct Bundle {
  ty: AssetType,
  env: Arc<Environment>,
  bundle_behavior: BundleBehavior,
  flags: BundleFlags,
  name: Option<PathBuf>,
  assets: Vec<usize>,
  entry_assets: Vec<usize>,
  main_entry_asset: Option<usize>,
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
