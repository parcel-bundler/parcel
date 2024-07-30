use std::hash::Hash;
use std::path::PathBuf;
use std::sync::Arc;

use parcel_core::diagnostic_error;
use parcel_core::plugin::AssetBuildEvent;
use parcel_core::plugin::BuildProgressEvent;
use parcel_core::plugin::InitialAsset;
use parcel_core::plugin::ReporterEvent;
use parcel_core::plugin::RunTransformContext;
use parcel_core::plugin::TransformResult;
use parcel_core::plugin::TransformationInput;
use parcel_core::types::Asset;
use parcel_core::types::AssetStats;
use parcel_core::types::Dependency;
use parcel_core::types::Environment;
use parcel_core::types::FileType;

use crate::plugins::PluginsRef;
use crate::plugins::TransformerPipeline;
use crate::request_tracker::{Request, ResultAndInvalidations, RunRequestContext, RunRequestError};

use super::RequestResult;

/// The AssetRequest runs transformer plugins on discovered Assets.
/// - Decides which transformer pipeline to run from the input Asset type
/// - Runs the pipeline in series, switching pipeline if the Asset type changes
/// - Stores the final Asset source code in the cache, for access in packaging
/// - Finally, returns the complete Asset and it's discovered Dependencies
#[derive(Clone, Debug, Hash, PartialEq)]
pub struct AssetRequest {
  pub env: Arc<Environment>,
  pub file_path: PathBuf,
  pub code: Option<String>,
  pub pipeline: Option<String>,
  pub side_effects: bool,
  pub query: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AssetRequestOutput {
  pub asset: Asset,
  pub dependencies: Vec<Dependency>,
}

impl Request for AssetRequest {
  fn run(
    &self,
    request_context: RunRequestContext,
  ) -> Result<ResultAndInvalidations, RunRequestError> {
    request_context.report(ReporterEvent::BuildProgress(BuildProgressEvent::Building(
      AssetBuildEvent {
        // TODO: Should we try avoid a clone here?
        file_path: self.file_path.clone(),
      },
    )));

    let pipeline = request_context
      .plugins()
      .transformers(&self.file_path, self.pipeline.clone())?;
    let asset_type = FileType::from_extension(
      self
        .file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or(""),
    );
    let mut transform_ctx = RunTransformContext::new(request_context.file_system().clone());

    let result = run_pipeline(
      pipeline,
      TransformationInput::InitialAsset(InitialAsset {
        // TODO: Are these clones necessary?
        file_path: self.file_path.clone(),
        code: self.code.clone(),
        env: self.env.clone(),
        side_effects: self.side_effects,
      }),
      asset_type,
      request_context.plugins().clone(),
      &mut transform_ctx,
    )?;

    Ok(ResultAndInvalidations {
      result: RequestResult::Asset(AssetRequestOutput {
        asset: Asset {
          stats: AssetStats {
            size: result.asset.code.size(),
            time: 0,
          },
          ..result.asset
        },
        dependencies: result.dependencies,
      }),
      // TODO: Support invalidations
      invalidations: vec![],
    })
  }
}

fn run_pipeline(
  mut pipeline: TransformerPipeline,
  input: TransformationInput,
  asset_type: FileType,
  plugins: PluginsRef,
  transform_ctx: &mut RunTransformContext,
) -> anyhow::Result<TransformResult> {
  let mut dependencies = vec![];
  let mut invalidations = vec![];

  let mut transform_input = input;

  let pipeline_hash = pipeline.hash();
  for transformer in &mut pipeline.transformers {
    let transform_result = transformer.transform(transform_ctx, transform_input)?;
    let is_different_asset_type = transform_result.asset.asset_type != asset_type;

    transform_input = TransformationInput::Asset(transform_result.asset);

    // If the Asset has changed type then we may need to trigger a different pipeline
    if is_different_asset_type {
      let next_pipeline = plugins.transformers(transform_input.file_path(), None)?;

      if next_pipeline.hash() != pipeline_hash {
        return run_pipeline(
          next_pipeline,
          transform_input,
          asset_type,
          plugins,
          transform_ctx,
        );
      };
    }

    dependencies.extend(transform_result.dependencies);
    invalidations.extend(transform_result.invalidate_on_file_change);
  }

  if let TransformationInput::Asset(asset) = transform_input {
    Ok(TransformResult {
      asset,
      dependencies,
      invalidate_on_file_change: invalidations,
    })
  } else {
    Err(diagnostic_error!("No transformations for Asset"))
  }
}
