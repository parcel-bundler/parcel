use serde_repr::Deserialize_repr;
use serde_repr::Serialize_repr;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize_repr, Deserialize_repr)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum SpecifierType {
  Esm = 0,
  Commonjs = 1,
  Url = 2,
  Custom = 3,
}

impl Default for SpecifierType {
  fn default() -> Self {
    SpecifierType::Esm
  }
}
