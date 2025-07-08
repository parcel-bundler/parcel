use std::{cell::RefCell, rc::Rc};

use parcel_core::{BundleBehavior, Dependency, DependencyFlags, Priority, SpecifierType};
use swc_core::{
  common::Span,
  ecma::{ast::*, atoms::Atom as JsWord},
  quote,
};

use crate::{module::ModuleRecord, Evaluator, Function, JsValue, Object};

pub struct URL {
  pub module: Rc<RefCell<ModuleRecord>>,
}

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
          module: self.module.clone(),
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

// pub fn parcel_url_dep(
//   _this: JsValue,
//   args: Vec<JsValue>,
//   span: Span,
//   _evaluator: &Evaluator,
// ) -> JsValue {
//   if let (Some(JsValue::String(url)), Some(JsValue::Bool(needs_stable_name))) =
//     (args.get(0), args.get(1))
//   {
//     JsValue::Object(
//       Rc::new(UrlDep {
//         specifier: url.clone(),
//         span,
//         needs_stable_name: *needs_stable_name,
//       })
//       .into(),
//     )
//   } else {
//     JsValue::Unknown(span)
//   }
// }

pub struct UrlDep {
  pub module: Rc<RefCell<ModuleRecord>>,
  pub specifier: JsWord,
  needs_stable_name: bool,
  span: Span,
}

impl Object for UrlDep {
  fn into_expr(&self) -> Result<Expr, ()> {
    let mut module = self.module.borrow_mut();
    let dep = Dependency {
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
    };
    let index = module.add_dependency(dep);
    Ok(quote!("new URL(__parcel_url__($index))" as Expr, index: Expr = (index as f64).into()))
  }
}
