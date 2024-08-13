use std::fmt::Display;
use std::fmt::Formatter;

use browserslist::Distrib;

use super::version::Version;

/// List of targeted browsers
#[derive(Clone, Default, Debug, Eq, Hash, PartialEq)]
pub struct Browsers {
  pub android: Option<Version>,
  pub chrome: Option<Version>,
  pub edge: Option<Version>,
  pub firefox: Option<Version>,
  pub ie: Option<Version>,
  pub ios_saf: Option<Version>,
  pub opera: Option<Version>,
  pub safari: Option<Version>,
  pub samsung: Option<Version>,
}

impl Browsers {
  pub fn is_empty(&self) -> bool {
    self.iter().all(|(_browser, version)| version.is_none())
  }

  pub fn iter(&self) -> BrowsersIterator {
    BrowsersIterator {
      browsers: self,
      index: 0,
    }
  }
}

pub struct BrowsersIterator<'a> {
  browsers: &'a Browsers,
  index: usize,
}

impl<'a> Iterator for BrowsersIterator<'a> {
  type Item = (&'a str, Option<Version>);

  fn next(&mut self) -> Option<Self::Item> {
    let browser = match self.index {
      0 => Some(("android", self.browsers.android)),
      1 => Some(("chrome", self.browsers.chrome)),
      2 => Some(("edge", self.browsers.edge)),
      3 => Some(("firefox", self.browsers.firefox)),
      4 => Some(("ie", self.browsers.ie)),
      5 => Some(("ios_saf", self.browsers.ios_saf)),
      6 => Some(("opera", self.browsers.opera)),
      7 => Some(("safari", self.browsers.safari)),
      8 => Some(("samsung", self.browsers.samsung)),
      _ => None,
    };

    if self.index < 9 {
      self.index += 1;
    }

    browser
  }
}

impl Display for Browsers {
  fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
    macro_rules! browsers {
      ( $( $b:ident ),* ) => {
        // Bypass unused_assignments false positive
        let mut _is_first_write = true;
        $(
          if let Some(version) = self.$b {
            if !_is_first_write {
              write!(f, ", ")?;
            }
            _is_first_write = false;
            write!(f, "{} {}", stringify!($b), version)?;
          }
        )*
      };
    }

    browsers![android, chrome, edge, firefox, ie, ios_saf, opera, safari, samsung];
    Ok(())
  }
}

impl From<Vec<Distrib>> for Browsers {
  fn from(distribs: Vec<Distrib>) -> Self {
    let mut browsers = Browsers::default();
    for distrib in distribs {
      macro_rules! browser {
        ($browser: ident) => {{
          if let Ok(v) = distrib.version().parse() {
            if browsers.$browser.is_none() || v < browsers.$browser.unwrap() {
              browsers.$browser = Some(v);
            }
          }
        }};
      }

      match distrib.name() {
        "android" => browser!(android),
        "chrome" | "and_chr" => browser!(chrome),
        "edge" => browser!(edge),
        "firefox" | "and_ff" => browser!(firefox),
        "ie" => browser!(ie),
        "ios_saf" => browser!(ios_saf),
        "opera" | "op_mob" => browser!(opera),
        "safari" => browser!(safari),
        "samsung" => browser!(samsung),
        _ => {}
      }
    }

    browsers
  }
}

impl<'de> serde::Deserialize<'de> for Browsers {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let value = serde_value::Value::deserialize(deserializer)?;
    let browsers = match value {
      serde_value::Value::String(s) => vec![s],
      value => Vec::<String>::deserialize(serde_value::ValueDeserializer::new(value))?,
    };
    let distribs = browserslist::resolve(browsers, &Default::default()).unwrap_or(Vec::new());
    Ok(distribs.into())
  }
}

impl serde::Serialize for Browsers {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    format!("{}", self).serialize(serializer)
  }
}

#[cfg(test)]
mod tests {
  use std::num::NonZeroU16;

  use super::*;

  #[test]
  fn display() {
    assert_eq!(format!("{}", Browsers::default()), "");

    assert_eq!(
      format!(
        "{}",
        Browsers {
          chrome: Some(Version::new(NonZeroU16::new(100).unwrap(), 0)),
          ..Browsers::default()
        }
      ),
      "chrome >= 100"
    );

    assert_eq!(
      format!(
        "{}",
        Browsers {
          chrome: Some(Version::new(NonZeroU16::new(1).unwrap(), 20)),
          ..Browsers::default()
        }
      ),
      "chrome >= 1.20"
    );

    assert_eq!(
      format!(
        "{}",
        Browsers {
          chrome: Some(Version::new(NonZeroU16::new(1).unwrap(), 20)),
          firefox: Some(Version::new(NonZeroU16::new(100).unwrap(), 5)),
          ..Browsers::default()
        }
      ),
      "chrome >= 1.20, firefox >= 100.5"
    );
  }
}
