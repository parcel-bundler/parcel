use std::rc::Rc;

use napi::bindgen_prelude::{FromNapiValue, ToNapiValue};
use napi::{Env, JsObject, JsUnknown, NapiRaw, NapiValue};

use crate::core::js_helpers::call_method;
use crate::core::transformer::{TransformationInput, TransformationResult, Transformer};

/// Transformer implementation that delegates to a JavaScript object.
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
