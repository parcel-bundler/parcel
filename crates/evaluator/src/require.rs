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

pub struct Require {
  module: Rc<RefCell<Module>>,
  builtin_modules: HashMap<&'static str, JsValue>,
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

      // if collector.in_try {
      //   d.flags |= DependencyFlags::OPTIONAL;
      // }

      if let Some(ns) = module.deps.get(src) {
        return ns.clone();
      }

      let ns = JsValue::Object(
        Rc::new(RequireDep {
          src: src.clone(),
          span,
          symbols: RefCell::new(HashSet::new()),
          ns: self
            .builtin_modules
            .get(src.as_str())
            .cloned()
            .unwrap_or(JsValue::Unknown(span)),
        })
        .into(),
      );

      module.deps.insert(src.clone(), ns.clone());
      ns
    } else {
      JsValue::Unknown(span)
    }
  }
}

pub struct RequireDep {
  src: JsWord,
  span: Span,
  symbols: RefCell<HashSet<Symbol>>,
  ns: JsValue,
}

impl RequireDep {
  pub fn to_dependency(&self, module: &Module) -> Dependency {
    Dependency {
      specifier: self.src.to_string(),
      specifier_type: SpecifierType::Commonjs,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::empty(),
      env: module.env.clone(),
      loc: Some(module.loc(self.span)),
      placeholder: None,
      resolve_from: None,
      range: None,
    }
  }
}

impl Object for RequireDep {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    if let JsValue::String(name) = prop {
      self
        .symbols
        .borrow_mut()
        .insert(Symbol::Name(name.clone()));
    } else {
      self.symbols.borrow_mut().insert(Symbol::Namespace);
    }

    self.ns.get(prop, span)
  }

  fn has(&self, prop: &JsValue) -> bool {
    if let JsValue::Object(obj) = &self.ns {
      obj.has(prop)
    } else {
      false
    }
  }

  fn entries<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    self.symbols.borrow_mut().insert(Symbol::Namespace);

    if let JsValue::Object(obj) = &self.ns {
      obj.entries()
    } else {
      Box::new(std::iter::empty())
    }
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    self.ns.clone().into_expr()
  }
}
