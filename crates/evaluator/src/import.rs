use std::{cell::RefCell, collections::HashSet, rc::Rc, sync::Arc};

use parcel_core::{
  BundleBehavior, Dependency, DependencyFlags, Environment, EnvironmentContext, EnvironmentFeature,
  OutputFormat, Priority, SourceType, SpecifierType,
};
use swc_core::{common::Span, ecma::atoms::Atom as JsWord};

use crate::{
  module::{Module, Symbol},
  promise::PromiseInstance,
  Evaluator, Function, JsValue, Object,
};

pub struct Import {
  module: Rc<RefCell<Module>>,
}

impl Object for Import {}
impl Function for Import {
  fn call(
    &self,
    _this: JsValue,
    args: Vec<JsValue>,
    span: Span,
    _evaluator: &Evaluator,
  ) -> JsValue {
    if let Some(JsValue::String(src)) = args.get(0) {
      let mut flags = DependencyFlags::empty();
      if let Some(JsValue::Object(attrs)) = args.get(1) {
        if matches!(
          attrs.get(&JsValue::String("preload".into()), span),
          JsValue::Bool(true)
        ) {
          flags |= DependencyFlags::PRELOAD;
        }

        if matches!(
          attrs.get(&JsValue::String("prefetch".into()), span),
          JsValue::Bool(true)
        ) {
          flags |= DependencyFlags::PREFETCH;
        }
      }

      let mut module = self.module.borrow_mut();
      let env = &module.env;
      if matches!(
        env.context,
        EnvironmentContext::Worklet | EnvironmentContext::ServiceWorker
      ) {
        // collector.add_import_error(node.span());
        return JsValue::Unknown(span);
      }

      if let Some(ns) = module.deps.get(src) {
        return ns.clone();
      }

      let ns = JsValue::Object(
        Rc::new(PromiseInstance::new(JsValue::Object(
          Rc::new(ImportDep {
            src: src.clone(),
            span,
            symbols: RefCell::new(HashSet::new()),
            flags,
          })
          .into(),
        )))
        .into(),
      );

      module.deps.insert(src.clone(), ns.clone());
      ns
    } else {
      JsValue::Unknown(span)
    }
  }
}

pub struct ImportDep {
  src: JsWord,
  span: Span,
  symbols: RefCell<HashSet<Symbol>>,
  flags: DependencyFlags,
}

impl Object for ImportDep {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    if let JsValue::String(name) = prop {
      self.symbols.borrow_mut().insert(Symbol::Name(name.clone()));
    } else {
      self.symbols.borrow_mut().insert(Symbol::Namespace);
    }

    JsValue::Unknown(span)
  }

  fn entries<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    self.symbols.borrow_mut().insert(Symbol::Namespace);

    Box::new(std::iter::empty())
  }
}

impl ImportDep {
  pub fn to_dependency(&self, module: &Module) -> Dependency {
    // If all of the target engines support dynamic import natively,
    // we can output native ESM if scope hoisting is enabled.
    // Only do this for scripts, rather than modules in the global
    // output format so that assets can be shared between the bundles.
    let mut output_format = module.env.output_format;
    if module.env.source_type == SourceType::Script
      && module.env.should_scope_hoist()
      && module
        .env
        .engines
        .supports(EnvironmentFeature::DynamicImport)
    {
      output_format = OutputFormat::Esmodule;
    }

    let loc = module.loc(self.span);
    let env = Arc::new(Environment {
      source_type: SourceType::Module,
      output_format,
      loc: Some(loc.clone()),
      ..(*module.env).clone()
    });

    Dependency {
      specifier: self.src.to_string(),
      specifier_type: SpecifierType::Esm,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::None,
      flags: self.flags,
      env,
      loc: Some(loc),
      placeholder: None,
      resolve_from: None,
      range: None,
    }
  }
}
