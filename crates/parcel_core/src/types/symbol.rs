use bitflags::bitflags;
use serde::Deserialize;
use serde::Serialize;

use super::source::SourceLocation;
use crate::bitflags_serde;

/// A map of export names to the corresponding local variable names
#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
pub struct Symbol {
  pub exported: String,
  pub flags: SymbolFlags,
  pub loc: Option<SourceLocation>,
  pub local: String,
}

bitflags! {
  #[derive(Debug, Clone, Copy, Hash)]
  pub struct SymbolFlags: u8 {
    const IS_WEAK = 1 << 0;
    const IS_ESM = 1 << 1;
    const SELF_REFERENCED = 1 << 2;
  }
}

bitflags_serde!(SymbolFlags);
