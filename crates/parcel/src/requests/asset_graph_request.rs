use crate::request_tracker::{Request, RequestResult, RunRequestContext, RunRequestError};
use parcel_core::plugin::{RunTransformContext, TransformationInput, TransformerPlugin};
use parcel_core::types::Asset;
use parcel_filesystem::os_file_system::OsFileSystem;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
struct AssetGraph;

/// This is temporary just to structure the use-cases out.
#[allow(unused)]
#[derive(Hash)]
struct AssetGraphRequest {
  entry_point: PathBuf,
}

impl Request<AssetGraph> for AssetGraphRequest {
  fn run(
    &self,
    request_context: RunRequestContext<AssetGraph>,
  ) -> Result<RequestResult<AssetGraph>, RunRequestError> {
    let entry = &self.entry_point;
    let config = request_context.get_plugins();
    let transformers = config.transformers(&entry, None)?;
    let asset = get_asset();
    let _result = run_transformer_pipeline(transformers, asset);

    todo!()
  }
}

/// This is some initial asset building code
fn get_asset() -> Asset {
  todo!()
}

/// This is part of the asset request ultimately
fn run_transformer_pipeline(
  transformers: Vec<Box<dyn TransformerPlugin>>,
  asset: Asset,
) -> anyhow::Result<()> {
  let mut input = TransformationInput::Asset(asset);
  let mut transform_context = RunTransformContext::new(Arc::new(OsFileSystem::default()));
  for mut transformer in transformers {
    let result = transformer.transform(&mut transform_context, input)?;
    input = TransformationInput::Asset(result.asset);
  }

  Ok(())
}
