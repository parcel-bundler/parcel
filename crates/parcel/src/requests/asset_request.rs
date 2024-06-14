use std::hash::Hash;
use std::hash::Hasher;
use std::path::PathBuf;
use std::sync::Arc;

use ahash::AHasher;
use parcel_config::ParcelConfig;
use parcel_core::plugin::AssetBuildEvent;
use parcel_core::plugin::BuildProgressEvent;
use parcel_core::plugin::PluginConfig;
use parcel_core::plugin::ReporterEvent;
use parcel_core::plugin::RunTransformContext;
use parcel_core::plugin::TransformerPlugin;
use parcel_core::types::Asset;
use parcel_core::types::AssetStats;
use parcel_core::types::BundleBehavior;
use parcel_core::types::Dependency;
use parcel_core::types::Environment;
use parcel_core::types::FileType;
use parcel_core::types::JSONObject;
use parcel_core::types::ParcelOptions;
use parcel_plugin_transformer_js::RunTransformContext;
use parcel_plugin_transformer_js::TransformationInput;

use crate::plugins::Plugins;
use crate::request_tracker::{Request, RequestResult, RunRequestContext, RunRequestError};

pub struct AssetRequest<'a> {
  pub plugins: Arc<Plugins<'a>>,
  pub env: Arc<Environment>,
  pub file_path: PathBuf,
  pub code: Option<Vec<u8>>,
  pub pipeline: Option<String>,
  pub side_effects: bool,
}

impl<'a> Hash for AssetRequest<'a> {
  fn hash<H: Hasher>(&self, state: &mut H) {
    // We don't include 'plugins' in the hash as we don't know
    // which plugins will be needed until after the request has run.
    // These are tracked via invalidations instead.
    self.file_path.hash(state);
    self.code.hash(state);
    self.pipeline.hash(state);
    self.env.hash(state);
    self.side_effects.hash(state);
  }
}

#[derive(Debug, Clone, PartialEq)]
pub enum AssetResult {
  Something,
}

impl<'a> Request<AssetResult> for AssetRequest<'a> {
  fn id(&self) -> u64 {
    let mut hasher = AHasher::default();

    self.file_path.hash(&mut hasher);
    self.code.hash(&mut hasher);
    self.pipeline.hash(&mut hasher);
    self.env.hash(&mut hasher);
    self.side_effects.hash(&mut hasher);

    hasher.finish()
  }

  fn run(
    &self,
    request_context: RunRequestContext<AssetResult>,
  ) -> Result<RequestResult<AssetResult>, RunRequestError> {
    request_context.report(ReporterEvent::BuildProgress(BuildProgressEvent::Building(
      AssetBuildEvent {
        // TODO: Should we try avoid a clone here?
        file_path: self.file_path.clone(),
      },
    )));

    let pipeline = self
      .plugins
      .transformers(&self.file_path, self.pipeline.as_deref());

    let asset = Asset {
      file_path: self.file_path.to_path_buf(),
      asset_type: FileType::from_extension(
        self
          .file_path
          .extension()
          .and_then(|s| s.to_str())
          .unwrap_or(""),
      ),
      env: Arc::clone(&self.env),
      meta: JSONObject::new(),
      side_effects: self.side_effects,
      stats: AssetStats::default(),
      symbols: vec![],
      unique_key: None,

      // TODO: Do we really need the clone?
      pipeline: self.pipeline.clone(),

      //TODO: Assign correct values to the following
      bundle_behavior: BundleBehavior::None,
      is_bundle_splittable: false,
      is_source: true,
      query: None,
    };

    todo!()
  }
}

struct TransformerResult {
  asset: Asset,
  dependencies: Vec<Dependency>,
}

fn run_pipeline(
  pipeline: Vec<Box<dyn TransformerPlugin>>,
  asset: Asset,
  plugins: &Plugins,
) -> anyhow::Result<TransformerResult> {
  let mut result = TransformerResult {
    asset,
    dependencies: vec![],
  };

  let mut transformer_ctx = RunTransformContext::new();
  fn resolve() -> anyhow::Result<PathBuf> {
    todo!("Internal Transformation resolve");
  }

  for transformer in pipeline {
    let asset_type = result.asset.asset_type;
    let transformed = transformer.transform(
      &mut transformer_ctx,
      TransformationInput::file_path(asset.file_path),
    )?;
    if transformed.asset.asset_type != asset_type {
      let next_path = transformed
        .asset
        .file_path
        .with_extension(transformed.asset.asset_type.extension());
      let next_pipeline = transformers.get(&next_path, &transformed.asset.pipeline, false);
      if next_pipeline != pipeline {
        return run_pipeline(next_pipeline, transformed.asset, transformed.code);
      };
    }
    result.asset = transformed.asset;
    result.code = transformed.code;
    result.dependencies.extend(transformed.dependencies);
  }

  Ok(result)
}
