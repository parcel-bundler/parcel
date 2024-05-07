use serde_repr::Deserialize_repr;
use serde_repr::Serialize_repr;

#[derive(PartialEq, Clone, Copy, Debug, Hash, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum SourceType {
  Module = 0,
  Script = 1,
}
