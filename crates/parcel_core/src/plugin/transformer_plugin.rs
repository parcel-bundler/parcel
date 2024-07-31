use std::fmt::Debug;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;

use parcel_filesystem::os_file_system::OsFileSystem;
use parcel_filesystem::FileSystemRef;

use crate::types::{Asset, Code, Dependency, Environment, ParcelOptions, SpecifierType};

pub struct ResolveOptions {
  /// A list of custom conditions to use when resolving package.json "exports" and "imports"
  pub package_conditions: Vec<String>,
  /// How the specifier should be interpreted
  pub specifier_type: SpecifierType,
}

/// A function that enables transformers to resolve a dependency specifier
pub type Resolve = dyn Fn(PathBuf, String, ResolveOptions) -> Result<PathBuf, anyhow::Error>;

/// A newly resolved file_path/code that needs to be transformed into an Asset
#[derive(Default)]
pub struct InitialAsset {
  pub file_path: PathBuf,
  /// Dynamic code returned from the resolver for virtual files.
  /// It is not set in most cases but should be respected when present.
  pub code: Option<String>,
  pub env: Arc<Environment>,
  pub side_effects: bool,
}

/// The input to transform within the plugin
///
/// Transformers may run against two distinguished scenarios:
///
/// * InitialAsset that have just been discovered
/// * Outputs of previous transformation steps, which are in-place modified
///
pub enum TransformationInput {
  InitialAsset(InitialAsset),
  Asset(Asset),
}

impl TransformationInput {
  pub fn env(&self) -> Arc<Environment> {
    match self {
      TransformationInput::InitialAsset(raw_asset) => raw_asset.env.clone(),
      TransformationInput::Asset(asset) => asset.env.clone(),
    }
  }

  pub fn file_path(&self) -> &Path {
    match self {
      TransformationInput::InitialAsset(raw_asset) => raw_asset.file_path.as_path(),
      TransformationInput::Asset(asset) => &asset.file_path,
    }
  }

  pub fn read_code(&self, fs: FileSystemRef) -> anyhow::Result<Arc<Code>> {
    match self {
      TransformationInput::InitialAsset(raw_asset) => {
        let code = if let Some(code) = &raw_asset.code {
          Code::from(code.clone())
        } else {
          let source = fs.read_to_string(&raw_asset.file_path)?;
          Code::from(source)
        };
        Ok(Arc::new(code))
      }
      TransformationInput::Asset(asset) => Ok(asset.code.clone()),
    }
  }
}

/// Context parameters for the transformer, other than the input.
pub struct RunTransformContext {
  file_system: FileSystemRef,
  options: Arc<ParcelOptions>,
}

impl Default for RunTransformContext {
  fn default() -> Self {
    Self {
      file_system: Arc::new(OsFileSystem::default()),
      options: Arc::new(ParcelOptions::default()),
    }
  }
}

impl RunTransformContext {
  pub fn new(file_system: FileSystemRef, options: Arc<ParcelOptions>) -> Self {
    Self {
      file_system,
      options,
    }
  }

  pub fn file_system(&self) -> FileSystemRef {
    self.file_system.clone()
  }

  pub fn options(&self) -> &Arc<ParcelOptions> {
    &self.options
  }
}

#[derive(Debug, Serialize, PartialEq)]
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
    &mut self,
    context: &mut RunTransformContext,
    input: TransformationInput,
  ) -> Result<TransformResult, anyhow::Error>;
}
