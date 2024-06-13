use crate::request_tracker::{Request, RequestResult, RunRequestContext, RunRequestError};
use parcel_core::plugin::{RunTransformContext, TransformerPlugin};
use parcel_core::types::Asset;
use std::path::PathBuf;

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
    let mut asset = get_asset();
    let _result = run_transformer_pipeline(transformers, &mut asset);

    todo!()
  }
}

fn get_asset() -> Asset {
  todo!()
}

fn run_transformer_pipeline(
  transformers: Vec<Box<dyn TransformerPlugin>>,
  asset: &mut Asset,
) -> anyhow::Result<()> {
  for mut transformer in transformers {
    let mut transform_context = RunTransformContext::new(asset);
    transformer.transform(&mut transform_context)?;
  }

  Ok(())
}
