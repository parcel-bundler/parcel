use parcel_resolver::IncludeNodeModules;
use serde::Deserialize;
use serde::Serialize;

use super::Engines;
use super::EnvironmentContext;
use super::EnvironmentFlags;
use super::OutputFormat;
use super::SourceType;
use super::TargetSourceMapOptions;
use crate::types::SourceLocation;

#[derive(Clone, Debug, Serialize, Deserialize)]
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

impl std::hash::Hash for Environment {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    self.context.hash(state);
    self.output_format.hash(state);
    self.source_type.hash(state);
    self.flags.hash(state);
    self.source_map.hash(state);
    self.include_node_modules.hash(state);
    self.engines.hash(state);
  }
}
