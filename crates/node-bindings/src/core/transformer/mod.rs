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

/// A `Transformer` is responsible for parsing a file and its dependencies, and producing the
/// output version of the file as well as other metadata related to the file.
///
/// This is a trait, so we can initially delegate to JavaScript transformers. But this should soon
/// be implemented into Rust. This may be better represented as an async call.
#[automock]
pub trait Transformer {
  fn transform(&self, input: TransformationInput) -> anyhow::Result<TransformationResult>;
}
