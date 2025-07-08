use std::{
  cell::RefCell,
  collections::{HashMap, HashSet},
  rc::Rc,
};

use parcel_core::{
  BundleBehavior, Dependency, DependencyFlags, Priority, SourceType, SpecifierType,
};
use swc_core::{
  common::Span,
  ecma::{ast::*, atoms::Atom as JsWord},
};

use crate::{
  module::{ModuleRecord, Symbol},
  Evaluator, Function, JsValue, Object,
};

pub struct Require {
  pub module: Rc<RefCell<ModuleRecord>>,
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

      let dep = Dependency {
        specifier: src.to_string(),
        specifier_type: SpecifierType::Commonjs,
        priority: Priority::Sync,
        bundle_behavior: BundleBehavior::None,
        flags: DependencyFlags::empty(),
        env: module.env.clone(),
        loc: Some(module.loc(span)),
        placeholder: None,
        resolve_from: None,
        range: None,
      };

      let index = module.add_dependency(dep);
      module.get_import_namespace(index)
    } else {
      JsValue::Unknown(span)
    }
  }
}
