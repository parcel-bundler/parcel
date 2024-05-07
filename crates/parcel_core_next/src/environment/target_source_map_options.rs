use serde::Deserialize;
use serde::Serialize;

#[derive(PartialEq, Clone, Debug, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSourceMapOptions {
  source_root: Option<String>,
  inline: Option<bool>,
  inline_sources: Option<bool>,
}
