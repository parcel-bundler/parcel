use crate::types::{impl_bitflags_serde, SourceLocation};
use bitflags::bitflags;
use browserslist::Distrib;
use parcel_resolver::IncludeNodeModules;
use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};

#[derive(Clone, Debug, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
  pub context: EnvironmentContext,
  pub output_format: OutputFormat,
  pub source_type: SourceType,
  pub flags: EnvironmentFlags,
  pub source_map: Option<TargetSourceMapOptions>,
  pub loc: Option<SourceLocation>,
  pub include_node_modules: IncludeNodeModules,
  pub engines: Engines,
}

#[derive(PartialEq, Clone, Debug, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSourceMapOptions {
  source_root: Option<String>,
  inline: Option<bool>,
  inline_sources: Option<bool>,
}

#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct Engines {
  #[serde(
    default,
    serialize_with = "serialize_browsers",
    deserialize_with = "deserialize_browsers"
  )]
  pub browsers: Vec<Distrib>,
  pub electron: Option<String>,
  pub node: Option<String>,
  pub parcel: Option<String>,
}

fn serialize_browsers<S>(browsers: &Vec<Distrib>, serializer: S) -> Result<S::Ok, S::Error>
where
  S: serde::Serializer,
{
  let browsers: Vec<String> = browsers.iter().map(|b| b.to_string()).collect();
  browsers.serialize(serializer)
}

fn deserialize_browsers<'de, D>(deserializer: D) -> Result<Vec<Distrib>, D::Error>
where
  D: serde::Deserializer<'de>,
{
  let value = serde_value::Value::deserialize(deserializer)?;
  let browsers = match value {
    serde_value::Value::String(s) => vec![s],
    value => Vec::<String>::deserialize(serde_value::ValueDeserializer::new(value))?,
  };
  let distribs = browserslist::resolve(browsers, &Default::default()).unwrap_or(Vec::new());
  Ok(distribs)
}

// List of browsers to exclude when the esmodule target is specified.
// Based on https://caniuse.com/#feat=es6-module
const ESMODULE_BROWSERS: &'static [&'static str] = &[
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
      browsers: browsers.unwrap_or(Vec::new()),
      electron: None,
      node: None,
      parcel: None,
    }
  }
}

impl std::hash::Hash for Engines {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    for browser in &self.browsers {
      browser.name().hash(state);
      browser.version().hash(state);
    }
    self.electron.hash(state);
    self.node.hash(state);
    self.parcel.hash(state);
  }
}

bitflags! {
  #[derive(Clone, Copy, Hash, Debug)]
  pub struct EnvironmentFlags: u8 {
    const IS_LIBRARY = 1 << 0;
    const SHOULD_OPTIMIZE = 1 << 1;
    const SHOULD_SCOPE_HOIST = 1 << 2;
  }
}

impl_bitflags_serde!(EnvironmentFlags);

#[derive(PartialEq, Clone, Copy, Debug, Hash, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum EnvironmentContext {
  Browser = 0,
  WebWorker = 1,
  ServiceWorker = 2,
  Worklet = 3,
  Node = 4,
  ElectronMain = 5,
  ElectronRenderer = 6,
}

impl EnvironmentContext {
  pub fn is_node(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, Node | ElectronMain | ElectronRenderer)
  }

  pub fn is_browser(&self) -> bool {
    use EnvironmentContext::*;
    matches!(
      self,
      Browser | WebWorker | ServiceWorker | Worklet | ElectronRenderer
    )
  }

  pub fn is_worker(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, WebWorker | ServiceWorker)
  }

  pub fn is_electron(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, ElectronMain | ElectronRenderer)
  }
}

#[derive(PartialEq, Clone, Copy, Debug, Hash, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum SourceType {
  Module = 0,
  Script = 1,
}

#[derive(PartialEq, Clone, Copy, Debug, Hash, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum OutputFormat {
  Global = 0,
  Commonjs = 1,
  Esmodule = 2,
}
