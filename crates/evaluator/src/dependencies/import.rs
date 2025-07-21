use std::{cell::RefCell, rc::Rc, sync::Arc};

use parcel_core::{
  BundleBehavior, Dependency, DependencyFlags, Environment, EnvironmentContext, EnvironmentFeature,
  OutputFormat, Priority, SourceType, SpecifierType,
};
use swc_core::common::Span;

use super::context::ModuleContext;
use crate::{builtins::promise::PromiseInstance, Evaluator, Function, JsValue, Object};

pub struct Import {
  pub module: Rc<RefCell<ModuleContext>>,
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

      let loc = module.loc(span);
      let env = Arc::new(Environment {
        source_type: SourceType::Module,
        output_format,
        loc: Some(loc.clone()),
        ..(*module.env).clone()
      });

      let dep = Dependency {
        specifier: src.to_string(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        flags,
        env,
        loc: Some(loc),
        placeholder: None,
        resolve_from: None,
        range: None,
      };

      let index = module.add_dependency(dep);
      let ns = module.get_import_namespace(index);

      JsValue::Object(Rc::new(PromiseInstance::new(ns)).into())
    } else {
      JsValue::Unknown(span)
    }
  }
}
