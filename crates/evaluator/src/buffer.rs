use std::rc::Rc;

use data_encoding::{BASE64, HEXLOWER};
use swc_core::{
  common::{Span, SyntaxContext, DUMMY_SP},
  ecma::{ast::*, atoms::Atom as JsWord},
};

use crate::{Evaluator, JsValue, Object};

pub struct Buffer(pub Rc<Vec<u8>>);

impl Object for Buffer {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop {
      JsValue::String(prop) => match prop.as_str() {
        "toString" => {
          let contents = self.0.clone();
          JsValue::Function(
            Rc::new(
              move |_this, args: Vec<JsValue>, span, _evaluator: &Evaluator| {
                let encoding = match args.get(0) {
                  None => "utf8",
                  Some(JsValue::String(e)) => e.as_str(),
                  _ => return JsValue::Unknown(span),
                };
                let start = match args.get(1) {
                  None | Some(JsValue::Undefined | JsValue::Null) => 0,
                  Some(JsValue::Number(s)) => *s as usize,
                  _ => return JsValue::Unknown(span),
                };
                let end = match args.get(2) {
                  None | Some(JsValue::Undefined | JsValue::Null) => contents.len(),
                  Some(JsValue::Number(s)) => *s as usize,
                  _ => return JsValue::Unknown(span),
                };
                let slice = &contents[start..end];

                match encoding {
                  "base64" => JsValue::String(BASE64.encode(&slice).into()),
                  "hex" => JsValue::String(HEXLOWER.encode(&slice).into()),
                  "utf8" | "utf-8" => std::str::from_utf8(&slice)
                    .ok()
                    .map(|v| JsValue::String(v.into()))
                    .unwrap_or(JsValue::Unknown(span)),
                  _ => JsValue::Unknown(span),
                }
              },
            )
            .into(),
          )
        }
        "length" => JsValue::Number(self.0.len() as f64),
        _ => JsValue::Unknown(span),
      },
      JsValue::Number(index) => self
        .0
        .get(*index as usize)
        .map_or(JsValue::Unknown(span), |v| JsValue::Number(*v as f64)),
      _ => JsValue::Unknown(span),
    }
  }

  fn has(&self, _prop: &JsValue) -> bool {
    false
  }

  fn entries<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    Box::new(std::iter::empty())
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    Ok(Expr::Call(CallExpr {
      callee: Callee::Expr(Box::new(Expr::Member(MemberExpr {
        obj: Box::new(Expr::Ident(Ident::new(
          "Buffer".into(),
          DUMMY_SP,
          SyntaxContext::empty(),
        ))),
        prop: MemberProp::Ident(IdentName::new("from".into(), DUMMY_SP)),
        span: DUMMY_SP,
      }))),
      args: vec![
        ExprOrSpread {
          expr: Box::new(BASE64.encode(&self.0).into()),
          spread: None,
        },
        ExprOrSpread {
          expr: Box::new(Expr::Lit(Lit::Str("base64".into()))),
          spread: None,
        },
      ],
      span: DUMMY_SP,
      ctxt: SyntaxContext::empty(),
      type_args: None,
    }))
  }
}
