use bitflags::bitflags;
use serde::Serialize;
use serde::{Deserialize, Deserializer, Serializer};

use super::source::SourceLocation;

/// A map of export names to the corresponding local variable names
#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
pub struct Symbol {
  pub exported: String,
  pub loc: Option<SourceLocation>,
  pub local: String,
  pub flags: SymbolFlags,
}

macro_rules! impl_bitflags_serde {
  ($t: ty) => {
    impl Serialize for $t {
      fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
      where
        S: serde::Serializer,
      {
        self.bits().serialize(serializer)
      }
    }

    impl<'de> Deserialize<'de> for $t {
      fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
      where
        D: serde::Deserializer<'de>,
      {
        let bits = Deserialize::deserialize(deserializer)?;
        Ok(<$t>::from_bits_truncate(bits))
      }
    }
  };
}

bitflags! {
  #[derive(Debug, Clone, Copy, Hash)]
  pub struct SymbolFlags: u8 {
    const IS_WEAK = 1 << 0;
    const IS_ESM = 1 << 1;
    const SELF_REFERENCED = 1 << 2;
  }
}
impl_bitflags_serde!(SymbolFlags);
