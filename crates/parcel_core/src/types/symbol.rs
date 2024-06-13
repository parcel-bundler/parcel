use bitflags::bitflags;
use serde::Serialize;
use serde::{Deserialize, Deserializer, Serializer};

use crate::impl_bitflags_serde;

use super::source::SourceLocation;

/// A map of export names to the corresponding local variable names
#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
pub struct Symbol {
  pub exported: String,
  pub loc: Option<SourceLocation>,
  pub local: String,
  pub flags: SymbolFlags,
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
