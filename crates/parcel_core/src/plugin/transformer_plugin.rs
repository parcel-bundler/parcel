use parcel_filesystem::FileSystemRef;
use std::fmt::Debug;
use std::fs::File;
use std::path::PathBuf;

use parcel_resolver::SpecifierType;

use crate::types::Asset;
use crate::types::SourceMap;

pub struct GenerateOutput {
  pub content: File,
  pub map: Option<SourceMap>,
}

pub struct ResolveOptions {
  /// A list of custom conditions to use when resolving package.json "exports" and "imports"
  pub package_conditions: Vec<String>,

  /// How the specifier should be interpreted
  pub specifier_type: SpecifierType,
}

/// A function that enables transformers to resolve a dependency specifier
pub type Resolve = dyn Fn(PathBuf, String, ResolveOptions) -> Result<PathBuf, anyhow::Error>;

pub struct RunTransformContext<'a> {
  // TODO: We want to split this into its own tbh
  asset: &'a mut Asset,
}

impl<'a> RunTransformContext<'a> {
  pub fn new(asset: &'a mut Asset) -> Self {
    Self { asset }
  }

  pub fn asset(&mut self) -> &mut Asset {
    self.asset
  }

  pub fn file_system(&self) -> FileSystemRef {
    todo!()
  }
}

pub struct TransformResult {}

/// Compile a single asset, discover dependencies, or convert the asset to a different format
///
/// Many transformers are wrappers around other tools such as compilers and preprocessors, and are
/// designed to integrate with Parcel.
///
pub trait TransformerPlugin: Debug + Send + Sync {
  /// Transform the asset and/or add new assets
  fn transform(
    &mut self,
    context: &mut RunTransformContext,
  ) -> Result<TransformResult, anyhow::Error>;
}

#[cfg(test)]
mod tests {
  use super::*;
  use anyhow::Error;

  #[derive(Debug)]
  struct TestTransformerPlugin {}

  impl TransformerPlugin for TestTransformerPlugin {
    fn transform(&mut self, context: &mut RunTransformContext) -> Result<TransformResult, Error> {
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
