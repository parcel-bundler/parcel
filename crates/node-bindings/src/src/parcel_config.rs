use std::path::PathBuf;
use std::rc::Rc;

use indexmap::IndexMap;
use serde::Deserialize;
use serde::Serialize;

use super::config_error::ConfigError;
use super::partial_parcel_config::PartialParcelConfig;
use super::pipeline::PipelineMap;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNode {
  pub package_name: String,
  pub resolve_from: Rc<PathBuf>,
}

/// Represents a fully merged and validated .parcel_rc config
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ParcelConfig {
  pub bundler: PluginNode,
  pub compressors: PipelineMap,
  pub namers: Vec<PluginNode>,
  pub optimizers: PipelineMap,
  pub packagers: IndexMap<String, PluginNode>,
  pub reporters: Vec<PluginNode>,
  pub resolvers: Vec<PluginNode>,
  pub runtimes: Vec<PluginNode>,
  pub transformers: PipelineMap,
  pub validators: PipelineMap,
}

impl TryFrom<PartialParcelConfig> for ParcelConfig {
  type Error = ConfigError;

  fn try_from(config: PartialParcelConfig) -> Result<Self, Self::Error> {
    // The final stage of merging filters out any ... extensions as they are a noop
    fn filter_out_extends(pipelines: Vec<PluginNode>) -> Vec<PluginNode> {
      pipelines
        .into_iter()
        .filter(|p| p.package_name != "...")
        .collect()
    }

    fn filter_out_extends_from_map(
      map: IndexMap<String, Vec<PluginNode>>,
    ) -> IndexMap<String, Vec<PluginNode>> {
      map
        .into_iter()
        .map(|(pattern, plugins)| (pattern, filter_out_extends(plugins)))
        .collect()
    }

    let mut missing_phases = Vec::new();

    if let None = config.bundler {
      missing_phases.push(String::from("bundler"));
    }

    let namers = filter_out_extends(config.namers);
    if namers.is_empty() {
      missing_phases.push(String::from("namers"));
    }

    let resolvers = filter_out_extends(config.resolvers);
    if resolvers.is_empty() {
      missing_phases.push(String::from("resolvers"));
    }

    if !missing_phases.is_empty() {
      return Err(ConfigError::InvalidConfig(format!(
        "Missing plugins for the following phases: {:?}",
        missing_phases
      )));
    }

    Ok(ParcelConfig {
      bundler: config.bundler.unwrap(),
      compressors: PipelineMap::new(filter_out_extends_from_map(config.compressors)),
      namers,
      optimizers: PipelineMap::new(filter_out_extends_from_map(config.optimizers)),
      packagers: config.packagers,
      reporters: filter_out_extends(config.reporters),
      resolvers,
      runtimes: filter_out_extends(config.runtimes),
      transformers: PipelineMap::new(filter_out_extends_from_map(config.transformers)),
      validators: PipelineMap::new(filter_out_extends_from_map(config.validators)),
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  mod try_from {
    use super::*;
    use crate::partial_parcel_config::PartialParcelConfigBuilder;

    #[test]
    fn returns_an_error_when_required_phases_are_optional() {
      assert_eq!(
        ParcelConfig::try_from(PartialParcelConfig::default()).map_err(|e| e.to_string()),
        Err(
          ConfigError::InvalidConfig(format!(
            "Missing plugins for the following phases: {:?}",
            vec!("bundler", "namers", "resolvers")
          ))
          .to_string()
        )
      );
    }

    #[test]
    fn returns_the_config() {
      fn plugin() -> PluginNode {
        PluginNode {
          package_name: String::from("package"),
          resolve_from: Rc::new(PathBuf::from("/")),
        }
      }

      fn extension() -> PluginNode {
        PluginNode {
          package_name: String::from("..."),
          resolve_from: Rc::new(PathBuf::from("/")),
        }
      }

      let partial_config = PartialParcelConfigBuilder::default()
        .bundler(Some(plugin()))
        .namers(vec![plugin()])
        .resolvers(vec![extension(), plugin()])
        .build()
        .unwrap();

      let config = ParcelConfig::try_from(partial_config);

      assert!(config.is_ok_and(|c| !c.resolvers.contains(&extension())));
    }
  }
}
