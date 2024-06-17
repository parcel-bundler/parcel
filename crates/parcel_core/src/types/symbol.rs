use bitflags::bitflags;
use serde::Deserialize;
use serde::Serialize;

use crate::impl_bitflags_serde;

use super::source::SourceLocation;

/// A map of export names to the corresponding local variable names
#[derive(Clone, PartialEq, Debug, Deserialize, Hash, Serialize)]
pub struct Symbol {
  /// The IMPORTED name. Most of the time this is the mangled symbol the transformer has replaced
  /// an import with.
  ///
  /// Re-exports are the exception. See `HoistResult`.
  pub local: String,
  /// The original EXPORTED name. Since this type is used also for imported symbols, this might
  /// mean the name of a symbol imported from another module as well.
  ///
  /// This is a non-mangled name, for example, in `import { x } from './dep'`, this name is `x`.
  /// Alternatively on `export const x = 'something';` this is also `x`.
  pub exported: String,
  /// The location might be None if the symbol is the "*" symbol. The location here always refers
  /// to the location within the IMPORT site.
  ///
  /// The star symbol is a special case for "all" exports and should be modeled by a separate ADT
  /// case in the future
  pub loc: Option<SourceLocation>,
  pub flags: SymbolFlags,
}

bitflags! {
  #[derive(PartialEq, Debug, Clone, Copy, Hash)]
  pub struct SymbolFlags: u8 {
    const IS_WEAK = 1 << 0;
    const IS_ESM = 1 << 1;
    const SELF_REFERENCED = 1 << 2;
  }
}

impl_bitflags_serde!(SymbolFlags);
