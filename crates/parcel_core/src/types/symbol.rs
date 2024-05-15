use serde::Deserialize;
use serde::Serialize;

use super::source::SourceLocation;

/// A map of export names to the corresponding local variable names
#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
pub struct Symbol {
  pub exported: String,
  pub loc: Option<SourceLocation>,
  pub local: String,
}
