use browserslist::Distrib;

use super::Version;

#[derive(Default, PartialEq, Clone, Debug, Hash)]
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

impl std::fmt::Display for Browsers {
  // TODO [ALSH] remote this
  #[allow(unused_assignments)]
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    let mut first = true;

    macro_rules! browser {
      ($b: ident) => {
        if let Some(v) = self.$b {
          if !first {
            write!(f, ", ")?;
          }
          first = false;
          write!(f, "{} {}", stringify!($b), v)?;
        }
      };
    }

    browser!(android);
    browser!(chrome);
    browser!(edge);
    browser!(firefox);
    browser!(ie);
    browser!(ios_saf);
    browser!(opera);
    browser!(safari);
    browser!(samsung);
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

impl serde::Serialize for Browsers {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    format!("{}", self).serialize(serializer)
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
