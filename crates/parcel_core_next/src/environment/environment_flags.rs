use bitflags::bitflags;
use serde::Deserialize;
use serde::Serialize;

use crate::types::impl_bitflags_serde;

bitflags! {
  #[derive(Clone, Copy, Hash, Debug)]
  pub struct EnvironmentFlags: u8 {
    const IS_LIBRARY = 1 << 0;
    const SHOULD_OPTIMIZE = 1 << 1;
    const SHOULD_SCOPE_HOIST = 1 << 2;
  }
}

impl_bitflags_serde!(EnvironmentFlags);
