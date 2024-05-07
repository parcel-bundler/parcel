use std::num::NonZeroU16;
use std::str::FromStr;

#[derive(PartialEq, Clone, Copy, PartialOrd, Ord, Eq, Hash)]
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

impl FromStr for Version {
  type Err = ();

  fn from_str(version: &str) -> Result<Self, Self::Err> {
    let version = version.split('-').next();
    if version.is_none() {
      return Err(());
    }

    let mut version = version.unwrap().split('.');
    let major = version.next().and_then(|v| v.parse::<NonZeroU16>().ok());
    if let Some(major) = major {
      let minor = version
        .next()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(0);
      // let patch = version.next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
      return Ok(Version::new(major, minor));
    }

    Err(())
  }
}

impl std::fmt::Display for Version {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, ">= {}", self.major())?;
    if self.minor() > 0 {
      write!(f, "{}", self.minor())?;
    }
    Ok(())
  }
}

impl std::fmt::Debug for Version {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{}", self.major())?;
    if self.minor() > 0 {
      write!(f, "{}", self.minor())?;
    }
    Ok(())
  }
}

impl serde::Serialize for Version {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    format!("{}", self).serialize(serializer)
  }
}

impl<'de> serde::Deserialize<'de> for Version {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let v: String = serde::Deserialize::deserialize(deserializer)?;
    if let Some(version) = node_semver::Range::parse(v.as_str())
      .ok()
      .and_then(|r| r.min_version())
    {
      Ok(Version(
        NonZeroU16::new((version.major as u16) << 8 | (version.minor as u16))
          .ok_or(serde::de::Error::custom("version must be > 0"))?,
      ))
    } else {
      Err(serde::de::Error::custom("invalid semver range"))
    }
  }
}
