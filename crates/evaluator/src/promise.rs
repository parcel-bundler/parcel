use std::{cell::RefCell, rc::Rc};

use swc_core::{common::Span, ecma::ast::Expr};

use crate::{module::ImportNamespace, Evaluator, Function, JsValue, Object, StaticOrRc};

pub struct Promise;
impl Object for Promise {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "resolve" => JsValue::Function(StaticOrRc::Static(&promise_resolve)),
      _ => JsValue::Unknown(span),
    }
  }
}

fn promise_resolve(
  _this: JsValue,
  args: Vec<JsValue>,
  _span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  let arg = args.get(0).cloned().unwrap_or(JsValue::Undefined);
  JsValue::Object(StaticOrRc::Rc(Rc::new(PromiseInstance(arg))))
}

impl Function for Promise {
  fn construct(&self, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    if let Some(JsValue::Function(f)) = args.get(0) {
      let result = Rc::new(RefCell::new(JsValue::Unknown(span)));
      let result_clone = result.clone();
      let resolve = JsValue::Function(
        Rc::new(
          move |_this: JsValue, args: Vec<JsValue>, _span: Span, _evaluator: &Evaluator| {
            if let Some(arg) = args.get(0) {
              *result_clone.borrow_mut() = arg.clone();
            }
            JsValue::Undefined
          },
        )
        .into(),
      );
      f.call(JsValue::Undefined, vec![resolve], span, evaluator);

      let res = result.clone().borrow().clone();
      JsValue::Object(StaticOrRc::Rc(Rc::new(PromiseInstance(res))))
    } else {
      JsValue::Unknown(span)
    }
  }
}

pub struct PromiseInstance(JsValue);
impl PromiseInstance {
  pub fn new(value: JsValue) -> PromiseInstance {
    PromiseInstance(value)
  }

  pub fn value(&self) -> JsValue {
    self.0.clone()
  }
}

impl Object for PromiseInstance {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "then" => {
        let val = self.0.clone();
        JsValue::Function(
          Rc::new(
            move |this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator| {
              if let Some(JsValue::Function(f)) = args.get(0) {
                f.call(this, vec![val.clone()], span, evaluator)
              } else {
                JsValue::Unknown(span)
              }
            },
          )
          .into(),
        )
      }
      _ => JsValue::Unknown(span),
    }
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    if let JsValue::Object(obj) = &self.0 {
      if let Some(dep) = obj.as_any().downcast_ref::<ImportNamespace>() {
        // TODO: mark dep as async
        return dep.into_expr();
      }
    }

    Err(())
  }
}
