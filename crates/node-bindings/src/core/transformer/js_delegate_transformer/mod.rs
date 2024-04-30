use std::rc::Rc;

use napi::bindgen_prelude::FromNapiValue;
use napi::bindgen_prelude::ToNapiValue;
use napi::Env;
use napi::JsObject;
use napi::JsUnknown;
use napi::NapiRaw;
use napi::NapiValue;

use crate::core::js_helpers::call_method;
use crate::core::transformer::TransformationInput;
use crate::core::transformer::TransformationResult;
use crate::core::transformer::Transformer;

/// Transformer implementation that delegates to a JavaScript object.
///
/// This should be delegating into `WorkerFarm::runTransform`.
pub struct JSDelegateTransformer {
  env: Rc<Env>,
  js_delegate: JsObject,
}

impl JSDelegateTransformer {
  pub fn new(env: Rc<Env>, js_delegate: JsObject) -> Self {
    Self { env, js_delegate }
  }
}

impl Transformer for JSDelegateTransformer {
  fn transform(&self, input: TransformationInput) -> anyhow::Result<TransformationResult> {
    let path = unsafe { ToNapiValue::to_napi_value(self.env.raw(), input.file_path) }?;
    let path = unsafe { JsUnknown::from_raw(self.env.raw(), path) }?;
    let result = call_method(&self.env, &self.js_delegate, "transform", &[&path])?;
    let result = unsafe { TransformationResult::from_napi_value(self.env.raw(), result.raw()) }?;
    Ok(result)
  }
}
