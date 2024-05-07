use serde::Deserialize;
use serde::Serialize;

#[derive(PartialEq, Debug, Clone, Hash, Serialize, Deserialize)]
pub struct Location {
  pub line: u32,
  pub column: u32,
}
