use std::{hash::Hash, path::PathBuf};

use serde::{Deserialize, Serialize};

mod asset;
mod dependency;
mod diagnostic;
mod environment;

pub use asset::*;
pub use dependency::*;
pub use diagnostic::*;
pub use environment::*;

// By default, bitflags serializes as a string, but we want the raw number instead.
#[macro_export]
macro_rules! impl_bitflags_serde {
  ($t: ty) => {
    impl Serialize for $t {
      fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
      where
        S: serde::Serializer,
      {
        self.bits().serialize(serializer)
      }
    }

    impl<'de> Deserialize<'de> for $t {
      fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
      where
        D: serde::Deserializer<'de>,
      {
        let bits = Deserialize::deserialize(deserializer)?;
        Ok(<$t>::from_bits_truncate(bits))
      }
    }
  };
}

#[derive(PartialEq, Eq, Debug, Clone, Hash, Default, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
  pub file_path: PathBuf,
  pub start: Location,
  pub end: Location,
}

#[derive(PartialEq, Eq, Debug, Clone, Hash, Default, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Location {
  pub line: u32,
  pub column: u32,
}

#[derive(Debug, Default, PartialEq, Eq, Hash, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BundleBehavior {
  #[default]
  None,
  Inline,
  Isolated,
}
