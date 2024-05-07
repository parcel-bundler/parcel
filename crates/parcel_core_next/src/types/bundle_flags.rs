use bitflags::bitflags;
use serde::Deserialize;
use serde::Serialize;

use super::impl_bitflags_serde;

bitflags! {
  #[derive(Debug, Clone, Copy, Hash)]
  pub struct BundleFlags: u8 {
    const NEEDS_STABLE_NAME = 1 << 0;
    const IS_SPLITTABLE = 1 << 1;
    const IS_PLACEHOLDER = 1 << 2;
  }
}

impl_bitflags_serde!(BundleFlags);
