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
  module::{Module, Symbol},
  Evaluator, Function, JsValue, Object,
};

pub struct URL;
impl Object for URL {}
impl Function for URL {
  fn construct(&self, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    if let (Some(JsValue::String(url)), Some(base)) = (args.get(0), args.get(1)) {
      if *base
        != evaluator
          .import_meta
          .get(&JsValue::String("url".into()), span)
      {
        return JsValue::Unknown(span);
      }

      JsValue::Object(
        Rc::new(UrlDep {
          specifier: url.clone(),
          span,
          needs_stable_name: false,
        })
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

pub fn parcel_url_dep(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let (Some(JsValue::String(url)), Some(JsValue::Bool(needs_stable_name))) =
    (args.get(0), args.get(1))
  {
    JsValue::Object(
      Rc::new(UrlDep {
        specifier: url.clone(),
        span,
        needs_stable_name: *needs_stable_name,
      })
      .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

pub struct UrlDep {
  pub specifier: JsWord,
  needs_stable_name: bool,
  span: Span,
}

impl Object for UrlDep {}

impl UrlDep {
  fn to_dependency(&self, module: &Module) -> Dependency {
    Dependency {
      specifier: self.specifier.to_string(),
      specifier_type: SpecifierType::Url,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::Isolated,
      flags: {
        let mut flags = DependencyFlags::empty();
        flags.set(DependencyFlags::NEEDS_STABLE_NAME, self.needs_stable_name);
        flags
      },
      env: module.env.clone(),
      loc: Some(module.loc(self.span)),
      placeholder: None,
      resolve_from: None,
      range: None,
    }
  }
}
