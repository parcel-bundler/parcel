use bitflags::bitflags;
use serde::Deserialize;

bitflags! {
  pub struct ExportsCondition: u16 {
    const IMPORT = 1 << 0;
    const REQUIRE = 1 << 1;
    const MODULE = 1 << 2;
    const NODE = 1 << 3;
    const BROWSER = 1 << 4;
    const WORKER = 1 << 5;
    const WORKLET = 1 << 6;
    const ELECTRON = 1 << 7;
    const DEVELOPMENT = 1 << 8;
    const PRODUCTION = 1 << 9;
    const TYPES = 1 << 10;
    const DEFAULT = 1 << 11;
    const STYLE = 1 << 12;
    const SASS = 1 << 13;
    const LESS = 1 << 14;
    const STYLUS = 1 << 15;
  }
}

impl Default for ExportsCondition {
  fn default() -> Self {
    ExportsCondition::empty()
  }
}

impl serde::Serialize for ExportsCondition {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    self.bits().serialize(serializer)
  }
}

impl<'de> serde::Deserialize<'de> for ExportsCondition {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let bits = Deserialize::deserialize(deserializer)?;
    Ok(ExportsCondition::from_bits_truncate(bits))
  }
}

impl TryFrom<&str> for ExportsCondition {
  type Error = ();
  fn try_from(value: &str) -> Result<Self, Self::Error> {
    Ok(match value {
      "import" => ExportsCondition::IMPORT,
      "require" => ExportsCondition::REQUIRE,
      "module" => ExportsCondition::MODULE,
      "node" => ExportsCondition::NODE,
      "browser" => ExportsCondition::BROWSER,
      "worker" => ExportsCondition::WORKER,
      "worklet" => ExportsCondition::WORKLET,
      "electron" => ExportsCondition::ELECTRON,
      "development" => ExportsCondition::DEVELOPMENT,
      "production" => ExportsCondition::PRODUCTION,
      "types" => ExportsCondition::TYPES,
      "default" => ExportsCondition::DEFAULT,
      "style" => ExportsCondition::STYLE,
      "sass" => ExportsCondition::SASS,
      "less" => ExportsCondition::LESS,
      "stylus" => ExportsCondition::STYLUS,
      _ => return Err(()),
    })
  }
}
