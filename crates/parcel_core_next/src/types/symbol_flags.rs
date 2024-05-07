use bitflags::bitflags;
use serde::Deserialize;
use serde::Serialize;

use super::impl_bitflags_serde;

bitflags! {
  #[derive(Debug, Clone, Copy, Hash)]
  pub struct SymbolFlags: u8 {
    const IS_WEAK = 1 << 0;
    const IS_ESM = 1 << 1;
  }
}

impl_bitflags_serde!(SymbolFlags);
