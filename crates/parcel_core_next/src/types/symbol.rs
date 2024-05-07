use serde::Deserialize;
use serde::Serialize;

use super::SourceLocation;
use super::SymbolFlags;

#[derive(Clone, Debug, Hash, Serialize, Deserialize)]
pub struct Symbol {
  pub exported: String,
  pub local: String,
  pub loc: Option<SourceLocation>,
  pub flags: SymbolFlags,
}
