use std::{cell::RefCell, rc::Rc};

use parcel_core::SourceType;
use swc_core::common::Span;

use super::context::ModuleContext;
use crate::{Evaluator, Function, JsValue, Object};

pub struct Require {
  pub module: Rc<RefCell<ModuleContext>>,
}

impl Object for Require {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "extensions" => JsValue::Undefined,
      _ => JsValue::Unknown(span),
    }
  }
}

impl Function for Require {
  fn call(
    &self,
    _this: JsValue,
    args: Vec<JsValue>,
    span: Span,
    _evaluator: &Evaluator,
  ) -> JsValue {
    if let Some(JsValue::String(src)) = args.get(0) {
      let mut module = self.module.borrow_mut();
      let env = &module.env;

      if env.source_type == SourceType::Script {
        // collector.add_script_error(node.span());
        return JsValue::Unknown(span);
      }

      let index = module.add_require_dependency(src.clone(), span);
      module.get_import_namespace(index)
    } else {
      JsValue::Unknown(span)
    }
  }
}
