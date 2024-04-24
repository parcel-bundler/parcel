use mockall::automock;
use napi_derive::napi;

use crate::core::project_path::ProjectPath;
use crate::core::requests::config_request::InternalFileCreateInvalidation;

pub mod js_delegate_transformer;

pub struct TransformationInput {
  pub file_path: ProjectPath,
}

#[napi(object)]
pub struct AssetValue {
  pub id: String,
}

/// TODO consolidate with config request
#[napi(object)]
pub struct TransformationInvalidations {
  pub invalidate_on_file_change: Vec<String>,
  pub invalidate_on_file_create: Vec<InternalFileCreateInvalidation>,
  pub invalidate_on_env_change: Vec<String>,
  pub invalidate_on_option_change: Vec<String>,
  pub invalidate_on_startup: bool,
  pub invalidate_on_build: bool,
}

#[napi(object)]
pub struct TransformationResult {
  pub assets: Vec<AssetValue>,
  pub invalidations: TransformationInvalidations,
}

#[automock]
pub trait Transformer {
  fn transform(&self, input: TransformationInput) -> anyhow::Result<TransformationResult>;
}
