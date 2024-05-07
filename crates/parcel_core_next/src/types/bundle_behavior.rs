use serde_repr::Deserialize_repr;
use serde_repr::Serialize_repr;

#[derive(Debug, PartialEq, Eq, Hash, Clone, Copy, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum BundleBehavior {
  None = 255,
  Inline = 0,
  Isolated = 1,
}

impl Default for BundleBehavior {
  fn default() -> Self {
    BundleBehavior::None
  }
}
