use swc_core::{common::Span, ecma::ast::*};

use crate::{Evaluate, Evaluator, JsValue, Object};

pub trait Function: Object {
  #[allow(unused)]
  fn call(&self, this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    JsValue::Unknown(span)
  }

  #[allow(unused)]
  fn construct(&self, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    JsValue::Unknown(span)
  }
}

impl<T: 'static> Object for T where T: Fn(JsValue, Vec<JsValue>, Span, &Evaluator) -> JsValue {}
impl<T: 'static> Function for T
where
  T: Fn(JsValue, Vec<JsValue>, Span, &Evaluator) -> JsValue,
{
  fn call(&self, this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    self(this, args, span, evaluator)
  }
}

pub struct JsFunction {
  pub params: Vec<Pat>,
  pub expr: Expr,
}

impl Object for JsFunction {}
impl Function for JsFunction {
  fn call(&self, this: JsValue, args: Vec<JsValue>, _span: Span, parent: &Evaluator) -> JsValue {
    let mut evaluator = Evaluator::new();
    evaluator.this = this;
    evaluator.parent = Some(parent);

    for (pat, arg) in self.params.iter().zip(args.into_iter()) {
      evaluator.eval_pat(arg, pat, &mut Evaluator::add_value);
    }

    self.expr.evaluate(&evaluator)
  }
}
