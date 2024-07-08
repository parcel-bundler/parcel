use std::num::NonZeroU16;

use serde::Deserialize;
use serde::Serialize;

use super::browsers::Browsers;
use super::version::Version;
use super::OutputFormat;

/// The engines field in package.json
#[derive(
  Clone,
  Debug,
  Default,
  Deserialize,
  Eq,
  Hash,
  PartialEq,
  Serialize,
  bincode::Encode,
  bincode::Decode,
)]
pub struct Engines {
  #[serde(default)]
  pub browsers: Browsers,
  pub electron: Option<Version>,
  pub node: Option<Version>,
  pub parcel: Option<Version>,
}

/// List of environment features that may be supported by an engine
pub enum EnvironmentFeature {
  ArrowFunctions,
  DynamicImport,
  Esmodules,
  GlobalThis,
  ImportMetaUrl,
  ServiceWorkerModule,
  WorkerModule,
}

impl EnvironmentFeature {
  pub fn engines(&self) -> Engines {
    match self {
      EnvironmentFeature::WorkerModule => Engines {
        browsers: Browsers {
          edge: Some(Version::new(NonZeroU16::new(80).unwrap(), 0)),
          chrome: Some(Version::new(NonZeroU16::new(80).unwrap(), 0)),
          opera: Some(Version::new(NonZeroU16::new(67).unwrap(), 0)),
          android: Some(Version::new(NonZeroU16::new(81).unwrap(), 0)),
          ..Default::default()
        },
        ..Default::default()
      },
      EnvironmentFeature::DynamicImport => Engines {
        browsers: Browsers {
          edge: Some(Version::new(NonZeroU16::new(76).unwrap(), 0)),
          firefox: Some(Version::new(NonZeroU16::new(67).unwrap(), 0)),
          chrome: Some(Version::new(NonZeroU16::new(63).unwrap(), 0)),
          safari: Some(Version::new(NonZeroU16::new(11).unwrap(), 1)),
          opera: Some(Version::new(NonZeroU16::new(50).unwrap(), 0)),
          ios_saf: Some(Version::new(NonZeroU16::new(11).unwrap(), 3)),
          android: Some(Version::new(NonZeroU16::new(63).unwrap(), 0)),
          samsung: Some(Version::new(NonZeroU16::new(8).unwrap(), 0)),
          ..Default::default()
        },
        ..Default::default()
      },
      _ => todo!(),
    }
  }
}

/// List of browsers to exclude when the esmodule target is specified based on
/// https://caniuse.com/#feat=es6-module
const _ESMODULE_BROWSERS: &'static [&'static str] = &[
  "not ie <= 11",
  "not edge < 16",
  "not firefox < 60",
  "not chrome < 61",
  "not safari < 11",
  "not opera < 48",
  "not ios_saf < 11",
  "not op_mini all",
  "not android < 76",
  "not blackberry > 0",
  "not op_mob > 0",
  "not and_chr < 76",
  "not and_ff < 68",
  "not ie_mob > 0",
  "not and_uc > 0",
  "not samsung < 8.2",
  "not and_qq > 0",
  "not baidu > 0",
  "not kaios > 0",
];

impl Engines {
  pub fn from_browserslist(browserslist: Vec<String>) -> Browsers {
    browserslist::resolve(browserslist, &Default::default())
      .map(|b| b.into())
      .unwrap_or_default()
  }

  // TODO Reinstate this so that engines.browsers are filtered out with ESMODULE_BROWSERS when
  // we are using an esmodule output format
  pub fn optimize(_engines: Engines, _output_format: OutputFormat) -> Engines {
    todo!()
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
