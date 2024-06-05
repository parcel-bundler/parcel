use std::fmt::Debug;

use super::PluginConfig;
use crate::types::Asset;

pub struct Validation {
  pub errors: Vec<anyhow::Error>,
  pub warnings: Vec<anyhow::Error>,
}

/// Analyzes assets to ensure they are in a valid state
///
/// Validators may throw errors or log warnings to indicate an asset is invalid. They can be used
/// to verify linting, type safety, etc and are run after a build has completed. This enables more
/// important compilation errors to occur first.
///
/// When Parcel runs in watch mode, the built bundles are served even if a validator throws an
/// error. But when running a build, Parcel exits with a failure and status code to ensure code is
/// not deployed for assets that do not meet the validation criteria. This ensures developers
/// remain productive, and do not have to worry about every small typing or linting issue while
/// trying to solve a problem.
///
pub trait ValidatorPlugin: Debug {
  /// A hook designed to setup config needed to validate assets
  ///
  /// This function will run once, shortly after the plugin is initialised.
  ///
  fn load_config(&mut self, config: &PluginConfig) -> Result<(), anyhow::Error>;

  /// Validates a single asset at a time
  ///
  /// This is usually designed for stateless validators
  ///
  fn validate_asset(
    &mut self,
    config: &PluginConfig,
    asset: &Asset,
  ) -> Result<Validation, anyhow::Error>;

  /// Validates all assets
  ///
  /// Some validators may wish to maintain a project-wide state or cache for efficiency. For these
  /// cases, it is appropriate to use a different interface where Parcel passses all the changed
  /// files to the validator at the same time.
  ///
  /// This type of validator is slower than a stateless validator, as it runs everything on a
  /// single thread. Only use this if you have no other choice, as is typically the case for
  /// validators that need to have access to the entire project, like TypeScript.
  ///
  fn validate_assets(
    &mut self,
    config: &PluginConfig,
    assets: Vec<&Asset>,
  ) -> Result<Validation, anyhow::Error>;
}

#[cfg(test)]
mod tests {
  use super::*;

  #[derive(Debug)]
  struct TestValidatorPlugin {}

  impl ValidatorPlugin for TestValidatorPlugin {
    fn load_config(&mut self, _config: &PluginConfig) -> Result<(), anyhow::Error> {
      todo!()
    }

    fn validate_asset(
      &mut self,
      _config: &PluginConfig,
      _asset: &Asset,
    ) -> Result<Validation, anyhow::Error> {
      todo!()
    }

    fn validate_assets(
      &mut self,
      _config: &PluginConfig,
      _assets: Vec<&Asset>,
    ) -> Result<Validation, anyhow::Error> {
      todo!()
    }
  }

  #[test]
  fn can_be_defined_in_dyn_vec() {
    let mut validators = Vec::<Box<dyn ValidatorPlugin>>::new();

    validators.push(Box::new(TestValidatorPlugin {}));

    assert_eq!(validators.len(), 1);
  }
}
