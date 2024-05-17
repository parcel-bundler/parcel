use std::path::Path;
use std::path::PathBuf;
use std::rc::Rc;

use indexmap::IndexMap;
use serde::Deserialize;
use serde::Serialize;

use super::config_error::ConfigError;
use super::partial_parcel_config::PartialParcelConfig;
use super::pipeline::is_match;
use super::pipeline::PipelineMap;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNode {
  pub package_name: String,
  pub resolve_from: Rc<PathBuf>,
}

/// Represents a fully merged and validated .parcel_rc config
#[derive(Debug, Deserialize, PartialEq, Serialize)]
pub struct ParcelConfig {
  pub(crate) bundler: PluginNode,
  pub(crate) compressors: PipelineMap,
  pub(crate) namers: Vec<PluginNode>,
  pub(crate) optimizers: PipelineMap,
  pub(crate) packagers: IndexMap<String, PluginNode>,
  pub(crate) reporters: Vec<PluginNode>,
  pub(crate) resolvers: Vec<PluginNode>,
  pub(crate) runtimes: Vec<PluginNode>,
  pub(crate) transformers: PipelineMap,
  pub(crate) validators: PipelineMap,
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

impl ParcelConfig {
  pub fn validators(&self, path: &Path) -> Result<Vec<PluginNode>, ConfigError> {
    let pipeline: &Option<&str> = &None;
    let validators = self.validators.get(path, pipeline);

    Ok(validators)
  }

  pub fn transformers(
    &self,
    path: &Path,
    pipeline: &Option<impl AsRef<str>>,
    allow_empty: bool,
  ) -> Result<Vec<PluginNode>, ConfigError> {
    let transformers = self.transformers.get(path, pipeline);

    if transformers.is_empty() {
      if allow_empty {
        return Ok(Vec::new());
      }

      return Err(ConfigError::MissingPlugin {
        path: PathBuf::from(path),
        phase: String::from("transformers"),
        pipeline: pipeline.as_ref().map(|p| String::from(p.as_ref())),
      });
    }

    Ok(transformers)
  }

  pub fn bundler<P: AsRef<str>>(&self) -> Result<&PluginNode, ConfigError> {
    Ok(&self.bundler)
  }

  pub fn namers(&self) -> Result<&Vec<PluginNode>, ConfigError> {
    Ok(&self.namers)
  }

  pub fn runtimes(&self) -> Result<&Vec<PluginNode>, ConfigError> {
    Ok(&self.runtimes)
  }

  pub fn packager(&self, path: &Path) -> Result<&PluginNode, ConfigError> {
    let basename = path.file_name().unwrap().to_str().unwrap();
    let path_str = path.as_os_str().to_str().unwrap();
    let packager = self
      .packagers
      .iter()
      .find(|(pattern, _)| is_match(pattern, path_str, basename, ""));

    match packager {
      None => Err(ConfigError::MissingPlugin {
        path: PathBuf::from(path),
        phase: String::from("packager"),
        pipeline: None,
      }),
      Some((_, pkgr)) => Ok(pkgr),
    }
  }

  pub fn optimizers(
    &self,
    path: &Path,
    pipeline: &Option<impl AsRef<str>>,
  ) -> Result<Vec<PluginNode>, ConfigError> {
    let mut use_empty_pipeline = false;
    // If a pipeline is specified, but it doesn't exist in the optimizers config, ignore it.
    // Pipelines for bundles come from their entry assets, so the pipeline likely exists in transformers.
    if let Some(p) = pipeline {
      if !self.optimizers.contains_named_pipeline(p) {
        use_empty_pipeline = true;
      }
    }

    let optimizers = self
      .optimizers
      .get(path, if use_empty_pipeline { &None } else { pipeline });

    Ok(optimizers)
  }

  pub fn compressors(&self, path: &Path) -> Result<Vec<PluginNode>, ConfigError> {
    let pipeline: &Option<&str> = &None;
    let compressors = self.compressors.get(path, pipeline);

    if compressors.is_empty() {
      return Err(ConfigError::MissingPlugin {
        path: PathBuf::from(path),
        phase: String::from("compressors"),
        pipeline: None,
      });
    }

    Ok(compressors)
  }

  pub fn resolvers(&self) -> Result<&Vec<PluginNode>, ConfigError> {
    Ok(&self.resolvers)
  }

  pub fn reporters(&self) -> Result<&Vec<PluginNode>, ConfigError> {
    Ok(&self.reporters)
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
