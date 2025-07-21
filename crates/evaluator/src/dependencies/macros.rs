use std::{cell::RefCell, sync::Arc};

use parcel_core::{Diagnostic, SourceLocation};
use std::rc::Rc;
use swc_core::{common::Span, ecma::atoms::Atom as JsWord};

use super::context::ModuleContext;
use crate::{Function, JsValue, Object};

pub type MacroCallback = Arc<
  dyn Fn(String, String, Vec<JsValue>, SourceLocation) -> Result<JsValue, Diagnostic> + Send + Sync,
>;

pub struct MacroModule {
  pub module: Rc<RefCell<ModuleContext>>,
  pub src: JsWord,
  pub callback: MacroCallback,
}

impl Object for MacroModule {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    if let JsValue::String(prop) = prop {
      JsValue::Function(
        Rc::new(MacroFunction {
          module: self.module.clone(),
          src: self.src.clone(),
          export: prop.clone(),
          callback: self.callback.clone(),
        })
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

pub struct MacroFunction {
  pub module: Rc<RefCell<ModuleContext>>,
  pub src: JsWord,
  pub export: JsWord,
  pub callback: MacroCallback,
}

impl Object for MacroFunction {}
impl Function for MacroFunction {
  fn call(
    &self,
    _this: JsValue,
    args: Vec<JsValue>,
    span: Span,
    _evaluator: &crate::Evaluator,
  ) -> JsValue {
    let loc = self.module.borrow().loc(span);
    match (self.callback)(self.src.to_string(), self.export.to_string(), args, loc) {
      Ok(value) => value,
      Err(err) => {
        self.module.borrow_mut().diagnostics.push(err);
        JsValue::Unknown(span)
      }
    }
  }
}
