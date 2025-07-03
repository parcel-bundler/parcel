use std::{
  cell::RefCell,
  collections::{HashMap, HashSet},
  rc::Rc,
  sync::Arc,
};

use parcel_core::{
  BundleBehavior, Dependency, DependencyFlags, Environment, EnvironmentContext, EnvironmentFeature,
  OutputFormat, Priority, SourceType, SpecifierType,
};
use swc_core::{
  common::Span,
  ecma::{ast::*, atoms::Atom as JsWord},
};

use crate::{
  module::{Module, Symbol},
  url::UrlDep,
  Evaluator, Function, JsValue, Object,
};

pub struct Worker;
impl Object for Worker {}
impl Function for Worker {
  fn construct(&self, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
    if let Some(dep) = match_url_dep(&args) {
      let mut source_type = SourceType::Script;
      if let Some(JsValue::Object(obj)) = args.get(1) {
        if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), span) {
          if ty == "module" {
            source_type = SourceType::Module;
          }
        }
      }

      JsValue::Object(
        Rc::new(WorkerDep {
          specifier: dep.clone(),
          source_type,
          span,
        })
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

pub struct SharedWorker;
impl Object for SharedWorker {}
impl Function for SharedWorker {
  fn construct(&self, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
    if let Some(dep) = match_url_dep(&args) {
      let mut source_type = SourceType::Script;
      if let Some(JsValue::Object(obj)) = args.get(1) {
        if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), span) {
          if ty == "module" {
            source_type = SourceType::Module;
          }
        }
      }

      JsValue::Object(
        Rc::new(WorkerDep {
          specifier: dep.clone(),
          source_type,
          span,
        })
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

fn match_url_dep<'a, 'b>(args: &'a Vec<JsValue>) -> Option<&'a JsWord> {
  match args.get(0) {
    Some(JsValue::Object(src)) => {
      if let Some(url) = src.as_any().downcast_ref::<UrlDep>() {
        return Some(&url.specifier);
      }
    }
    _ => {}
  }

  None
}

struct WorkerDep {
  specifier: JsWord,
  source_type: SourceType,
  span: Span,
}

impl Object for WorkerDep {}

impl WorkerDep {
  pub fn to_dependency(&self, module: &Module) -> Dependency {
    // Use native ES module output if the worker was created with `type: 'module'` and all targets
    // support native module workers. Only do this if parent asset output format is also esmodule so that
    // assets can be shared between workers and the main thread in the global output format.
    let output_format = if module.env.output_format == OutputFormat::Esmodule
      && self.source_type == SourceType::Module
      && module
        .env
        .engines
        .supports(EnvironmentFeature::WorkerModule)
    {
      OutputFormat::Esmodule
    } else if module.env.output_format == OutputFormat::Commonjs {
      OutputFormat::Commonjs
    } else {
      OutputFormat::Global
    };

    let loc = Some(module.loc(self.span));
    let env = Arc::new(Environment {
      context: EnvironmentContext::WebWorker,
      source_type: self.source_type,
      output_format,
      loc: loc.clone(),
      ..(*module.env).clone()
    });

    Dependency {
      specifier: self.specifier.to_string(),
      specifier_type: SpecifierType::Url,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::IS_WEBWORKER,
      env,
      loc,
      placeholder: None,
      resolve_from: None,
      range: None,
    }
  }
}

pub fn service_worker_register(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  evaluator: &Evaluator,
) -> JsValue {
  if let Some(dep) = match_url_dep(&args) {
    let mut source_type = SourceType::Script;
    if let Some(JsValue::Object(obj)) = args.get(1) {
      if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), span) {
        if ty == "module" {
          source_type = SourceType::Module;
        }
      }
    }

    JsValue::Object(
      Rc::new(ServiceWorkerDep {
        specifier: dep.clone(),
        source_type,
        span,
      })
      .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

pub struct ServiceWorkerDep {
  specifier: JsWord,
  source_type: SourceType,
  span: Span,
}

impl Object for ServiceWorkerDep {}

impl ServiceWorkerDep {
  pub fn to_dependency(&self, module: &Module) -> Dependency {
    let loc = module.loc(self.span);
    Dependency {
      specifier: self.specifier.to_string(),
      specifier_type: SpecifierType::Url,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::NEEDS_STABLE_NAME,
      env: Arc::new(Environment {
        context: EnvironmentContext::ServiceWorker,
        source_type: self.source_type,
        output_format: OutputFormat::Global, // TODO: module service worker support
        loc: Some(loc.clone()),
        ..(*module.env).clone()
      }),
      loc: Some(loc),
      placeholder: None,
      resolve_from: None,
      range: None,
    }
  }
}

pub fn paint_worklet(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  evaluator: &Evaluator,
) -> JsValue {
  if let Some(dep) = match_url_dep(&args) {
    JsValue::Object(
      Rc::new(WorkletDep {
        specifier: dep.clone(),
        span,
      })
      .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

pub struct WorkletDep {
  specifier: JsWord,
  span: Span,
}

impl Object for WorkletDep {}

impl WorkletDep {
  fn to_dependency(&self, module: &Module) -> Dependency {
    let loc = Some(module.loc(self.span));
    Dependency {
      specifier: self.specifier.to_string(),
      specifier_type: SpecifierType::Url,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::empty(),
      env: Arc::new(Environment {
        context: EnvironmentContext::Worklet,
        source_type: SourceType::Module,
        output_format: OutputFormat::Esmodule, // Worklets require ESM
        loc: loc.clone(),
        ..(*module.env).clone()
      }),
      loc,
      placeholder: None,
      resolve_from: None,
      range: None,
    }
  }
}
