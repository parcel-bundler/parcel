use std::num::NonZeroU16;
use std::str::FromStr;

use nodejs_semver::Range as SemVerRange;
use serde::Deserialize;
use serde::Serialize;
use serde::Serializer;

/// Minimum semantic version range for browsers and engines
#[derive(
  PartialEq,
  Clone,
  Copy,
  PartialOrd,
  Ord,
  Eq,
  Hash,
  rkyv::Archive,
  rkyv::Serialize,
  rkyv::Deserialize,
)]
pub struct Version(NonZeroU16);

impl Version {
  pub fn new(major: NonZeroU16, minor: u16) -> Self {
    Version(NonZeroU16::new((major.get() & 0xff) << 8 | (minor & 0xff)).unwrap())
  }

  pub fn major(&self) -> u16 {
    self.0.get() >> 8
  }

  pub fn minor(&self) -> u16 {
    self.0.get() & 0xff
  }
}

impl std::fmt::Debug for Version {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{}", self.major())?;
    if self.minor() > 0 {
      write!(f, ".{}", self.minor())?;
    }
    Ok(())
  }
}

impl std::fmt::Display for Version {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, ">= {}", self.major())?;
    if self.minor() > 0 {
      write!(f, ".{}", self.minor())?;
    }
    Ok(())
  }
}

impl FromStr for Version {
  type Err = String;

  fn from_str(str: &str) -> Result<Self, Self::Err> {
    let version = str.split('-').next();
    if version.is_none() {
      return Err(format!("Invalid semver range: {}", str));
    }

    let mut version = version.unwrap().split('.');
    let major = version.next().and_then(|v| v.parse::<NonZeroU16>().ok());
    if let Some(major) = major {
      let minor = version
        .next()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(0);

      return Ok(Version::new(major, minor));
    }

    Err(format!("Invalid semver range: {}", str))
  }
}

impl Serialize for Version {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: Serializer,
  {
    format!("{}", self).serialize(serializer)
  }
}

impl<'de> Deserialize<'de> for Version {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let v: String = Deserialize::deserialize(deserializer)?;
    if let Some(version) = SemVerRange::parse(v.as_str())
      .ok()
      .and_then(|r| r.min_version())
    {
      Ok(Version(
        NonZeroU16::new((version.major as u16) << 8 | (version.minor as u16))
          .ok_or(serde::de::Error::custom("Version must be > 0"))?,
      ))
    } else {
      Err(serde::de::Error::custom(format!(
        "Invalid semver range: {}",
        v
      )))
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn major() {
    assert_eq!(Version::new(NonZeroU16::new(1).unwrap(), 0).major(), 1);
    assert_eq!(Version::new(NonZeroU16::new(5).unwrap(), 0).major(), 5);
    assert_eq!(Version::new(NonZeroU16::new(100).unwrap(), 0).major(), 100);
  }

  #[test]
  fn minor() {
    assert_eq!(Version::new(NonZeroU16::new(1).unwrap(), 0).minor(), 0);
    assert_eq!(Version::new(NonZeroU16::new(1).unwrap(), 5).minor(), 5);
    assert_eq!(Version::new(NonZeroU16::new(1).unwrap(), 100).minor(), 100);
  }

  #[test]
  fn debug() {
    assert_eq!(
      format!("{:?}", Version::new(NonZeroU16::new(1).unwrap(), 0)),
      "1"
    );

    assert_eq!(
      format!("{:?}", Version::new(NonZeroU16::new(1).unwrap(), 5)),
      "1.5"
    );

    assert_eq!(
      format!("{:?}", Version::new(NonZeroU16::new(100).unwrap(), 10)),
      "100.10"
    );
  }

  #[test]
  fn display() {
    assert_eq!(
      format!("{}", Version::new(NonZeroU16::new(1).unwrap(), 0)),
      ">= 1"
    );

    assert_eq!(
      format!("{}", Version::new(NonZeroU16::new(1).unwrap(), 5)),
      ">= 1.5"
    );

    assert_eq!(
      format!("{}", Version::new(NonZeroU16::new(100).unwrap(), 10)),
      ">= 100.10"
    );
  }

  #[test]
  fn from_str() {
    assert_eq!(
      Version::from_str("foo"),
      Err(String::from("Invalid semver range: foo"))
    );

    assert_eq!(
      Version::from_str("0"),
      Err(String::from("Invalid semver range: 0"))
    );

    assert_eq!(
      Version::from_str("1.0"),
      Ok(Version::new(NonZeroU16::new(1).unwrap(), 0))
    );

    assert_eq!(
      Version::from_str("1.5"),
      Ok(Version::new(NonZeroU16::new(1).unwrap(), 5))
    );

    assert_eq!(
      Version::from_str("100.10"),
      Ok(Version::new(NonZeroU16::new(100).unwrap(), 10))
    );
  }

  #[test]
  fn deserialize() {
    assert_eq!(
      serde_json::from_str::<Version>("\"foo\"")
        .unwrap_err()
        .to_string(),
      "Invalid semver range: foo"
    );

    assert_eq!(
      serde_json::from_str::<Version>("\"0\"")
        .unwrap_err()
        .to_string(),
      "Version must be > 0"
    );

    assert_eq!(
      serde_json::from_str::<Version>("\"1\"").unwrap(),
      Version::new(NonZeroU16::new(1).unwrap(), 0)
    );

    assert_eq!(
      serde_json::from_str::<Version>("\">= 1\"").unwrap(),
      Version::new(NonZeroU16::new(1).unwrap(), 0)
    );

    assert_eq!(
      serde_json::from_str::<Version>("\"1.5\"").unwrap(),
      Version::new(NonZeroU16::new(1).unwrap(), 5)
    );

    assert_eq!(
      serde_json::from_str::<Version>("\">= 1.5\"").unwrap(),
      Version::new(NonZeroU16::new(1).unwrap(), 5)
    );

    assert_eq!(
      serde_json::from_str::<Version>("\"100.10\"").unwrap(),
      Version::new(NonZeroU16::new(100).unwrap(), 10)
    );

    assert_eq!(
      serde_json::from_str::<Version>("\">= 100.10\"").unwrap(),
      Version::new(NonZeroU16::new(100).unwrap(), 10)
    );
  }

  #[test]
  fn serialize() {
    assert_eq!(
      serde_json::to_string(&Version::new(NonZeroU16::new(1).unwrap(), 0)).unwrap(),
      "\">= 1\""
    );

    assert_eq!(
      serde_json::to_string(&Version::new(NonZeroU16::new(1).unwrap(), 5)).unwrap(),
      "\">= 1.5\""
    );

    assert_eq!(
      serde_json::to_string(&Version::new(NonZeroU16::new(100).unwrap(), 10)).unwrap(),
      "\">= 100.10\""
    );
  }
}
