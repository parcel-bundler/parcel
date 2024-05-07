use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Hash, Serialize, Deserialize)]
pub struct ImportAttribute {
  pub key: String,
  pub value: bool,
}
