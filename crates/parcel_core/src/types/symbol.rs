use serde::Deserialize;
use serde::Serialize;

use super::source::SourceLocation;

/// A map of export names to the corresponding local variable names
#[derive(Clone, PartialEq, Debug, Default, Deserialize, Hash, Serialize)]
pub struct Symbol {
  /// The IMPORTED name. Most of the time this is the mangled symbol the transformer has replaced
  /// an import with.
  ///
  /// On re-exports, this is rather a generated string, using the asset-id and symbol local value.
  /// this is different to `HoistResult::re_exports`. We're generating this mangled key when
  /// converting from `ImportedSymbol` to `Symbol`
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
  pub is_weak: bool,
  /// Only on ESM exports, this may be set to true
  pub is_esm_export: bool,
  pub self_referenced: bool,
}
