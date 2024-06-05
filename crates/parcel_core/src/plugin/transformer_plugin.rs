use std::fmt::Debug;
use std::fs::File;
use std::path::PathBuf;

use super::PluginConfig;
use crate::types::Asset;
use crate::types::SourceMap;

pub struct AST {}

pub struct GenerateOutput {
  pub content: File,
  pub map: Option<SourceMap>,
}

#[derive(PartialEq, Eq, Clone, Copy)]
pub enum SpecifierType {
  Esm,
  Cjs,
  Url,
}

pub struct ResolveOptions {
  /// A list of custom conditions to use when resolving package.json "exports" and "imports"
  pub package_conditions: Vec<String>,

  /// How the specifier should be interpreted
  pub specifier_type: SpecifierType,
}

/// A function that enables transformers to resolve a dependency specifier
pub type Resolve = dyn Fn(PathBuf, String, ResolveOptions) -> Result<PathBuf, anyhow::Error>;

/// Compile a single asset, discover dependencies, or convert the asset to a different format
///
/// Many transformers are wrappers around other tools such as compilers and preprocessors, and are
/// designed to integrate with Parcel.
///
pub trait TransformerPlugin: Debug + Send + Sync {
  /// A hook designed to setup config needed to transform assets
  ///
  /// This function will run once, shortly after the plugin is initialised.
  fn load_config(&mut self, config: &PluginConfig) -> Result<(), anyhow::Error>;

  /// Whether an AST from a previous transformer can be reused to prevent double-parsing
  ///
  /// This function should inspect the type and version of the AST to determine if it can be
  /// reused. When the AST is reused, parsing is skipped. Otherwise the previous transformer
  /// generate function is called, and the next transformer will parse that result.
  ///
  fn can_reuse_ast(&self, ast: AST) -> bool;

  /// Parse the asset code into an AST
  ///
  /// This function is called when an AST is not available and can_reuse_ast returns false.
  ///
  fn parse(
    &mut self,
    config: &PluginConfig,
    asset: &Asset,
    resolve: &Resolve,
  ) -> Result<AST, anyhow::Error>;

  /// Transform the asset and/or add new assets
  fn transform(
    &mut self,
    config: &PluginConfig,
    asset: &mut Asset,
    resolve: &Resolve,
  ) -> Result<Vec<Asset>, anyhow::Error>;

  // Perform processing after the transformation
  fn post_process(
    &mut self,
    config: &PluginConfig,
    assets: Vec<&Asset>,
  ) -> Result<Vec<Asset>, anyhow::Error>;

  /// Stringify the AST
  ///
  /// This function is called when the next transformer AST cannot be reused, or this is the last
  /// transformer in a pipeline.
  ///
  fn generate(&self, asset: Asset, ast: AST) -> Result<GenerateOutput, anyhow::Error>;
}

#[cfg(test)]
mod tests {
  use super::*;

  #[derive(Debug)]
  struct TestTransformerPlugin {}

  impl TransformerPlugin for TestTransformerPlugin {
    fn load_config(&mut self, _config: &PluginConfig) -> Result<(), anyhow::Error> {
      todo!()
    }

    fn can_reuse_ast(&self, _ast: AST) -> bool {
      todo!()
    }

    fn parse(
      &mut self,
      _config: &PluginConfig,
      _asset: &Asset,
      _resolve: &Resolve,
    ) -> Result<AST, anyhow::Error> {
      todo!()
    }

    fn transform(
      &mut self,
      _config: &PluginConfig,
      _asset: &mut Asset,
      _resolve: &Resolve,
    ) -> Result<Vec<Asset>, anyhow::Error> {
      todo!()
    }

    fn post_process(
      &mut self,
      _config: &PluginConfig,
      _assets: Vec<&Asset>,
    ) -> Result<Vec<Asset>, anyhow::Error> {
      todo!()
    }

    fn generate(&self, _asset: Asset, _ast: AST) -> Result<GenerateOutput, anyhow::Error> {
      todo!()
    }
  }

  #[test]
  fn can_be_defined_in_dyn_vec() {
    let mut transformers = Vec::<Box<dyn TransformerPlugin>>::new();

    transformers.push(Box::new(TestTransformerPlugin {}));

    assert_eq!(transformers.len(), 1);
  }
}
