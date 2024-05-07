use serde::Deserialize;
use serde::Serialize;

use super::Browsers;
use super::EnvironmentFeature;
use super::OutputFormat;
use super::Version;
use super::ESMODULE_BROWSERS;

#[derive(PartialEq, Clone, Debug, Hash, Default, Serialize, Deserialize)]
pub struct Engines {
  #[serde(default)]
  pub browsers: Browsers,
  pub electron: Option<Version>,
  pub node: Option<Version>,
  pub parcel: Option<Version>,
}

impl Engines {
  pub fn from_browserslist(browserslist: &str, output_format: OutputFormat) -> Engines {
    let browsers = if output_format == OutputFormat::Esmodule {
      // If the output format is esmodule, exclude browsers
      // that support them natively so that we transpile less.
      browserslist::resolve(
        std::iter::once(browserslist).chain(ESMODULE_BROWSERS.iter().map(|s| *s)),
        &Default::default(),
      )
    } else {
      browserslist::resolve(std::iter::once(browserslist), &Default::default())
    };

    Engines {
      browsers: browsers.map(|b| b.into()).unwrap_or_default(),
      electron: None,
      node: None,
      parcel: None,
    }
  }

  pub fn supports(&self, feature: EnvironmentFeature) -> bool {
    let min = feature.engines();
    macro_rules! check {
      ($p: ident$(. $x: ident)*) => {{
        if let Some(v) = self.$p$(.$x)* {
          match min.$p$(.$x)* {
            None => return false,
            Some(v2) if v < v2 => return false,
            _ => {}
          }
        }
      }};
    }

    check!(browsers.android);
    check!(browsers.chrome);
    check!(browsers.edge);
    check!(browsers.firefox);
    check!(browsers.ie);
    check!(browsers.ios_saf);
    check!(browsers.opera);
    check!(browsers.safari);
    check!(browsers.samsung);
    true
  }
}
