use parcel_filesystem::FileSystemRef;
use std::fmt::Debug;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use parcel_resolver::SpecifierType;

use crate::types::{Asset, SourceCode};
use crate::types::{Dependency, SourceMap};

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

/// Transformers may run against:
///
/// * File-paths that have just been discovered
/// * Outputs of previous transformation steps, which are in-place modified
/// * These two scenarios are distinguished
pub enum TransformationInput {
  FilePath(PathBuf),
  Asset(Asset),
}

impl TransformationInput {
  pub fn file_path(&self) -> &Path {
    match self {
      TransformationInput::FilePath(path) => path,
      TransformationInput::Asset(asset) => asset.file_path(),
    }
  }

  pub fn read_source_code(&self, fs: FileSystemRef) -> anyhow::Result<Rc<SourceCode>> {
    match self {
      TransformationInput::FilePath(file_path) => {
        let code = fs.read_to_string(&file_path)?;
        let code = SourceCode::from(code);
        Ok(Rc::new(code))
      }
      TransformationInput::Asset(asset) => Ok(asset.source_code.clone()),
    }
  }
}

/// Context parameters for the transformer, other than the input.
pub struct RunTransformContext {
  file_system: FileSystemRef,
}

impl RunTransformContext {
  pub fn new(file_system: FileSystemRef) -> Self {
    Self { file_system }
  }

  pub fn file_system(&self) -> FileSystemRef {
    self.file_system.clone()
  }
}

#[derive(Debug)]
pub struct TransformResult {
  pub asset: Asset,
  pub dependencies: Vec<Dependency>,
  /// The transformer signals through this field that its result should be invalidated
  /// if these paths change.
  pub invalidate_on_file_change: Vec<PathBuf>,
}

/// Compile a single asset, discover dependencies, or convert the asset to a different format
///
/// Many transformers are wrappers around other tools such as compilers and preprocessors, and are
/// designed to integrate with Parcel.
///
pub trait TransformerPlugin: Debug + Send + Sync {
  /// Transform the asset and/or add new assets
  fn transform(
    &self,
    context: &mut RunTransformContext,
    input: TransformationInput,
  ) -> Result<TransformResult, anyhow::Error>;
}
