use std::{cell::RefCell, rc::Rc};

use data_encoding::{BASE64, HEXLOWER, HEXLOWER_PERMISSIVE};
use swc_core::{
  common::Span,
  ecma::{ast::*, atoms::Atom as JsWord},
  quote,
};

use super::context::{ModuleContext, Symbol};
use crate::{Evaluator, Function, JsValue, Object};

pub struct BufferConstructor {
  pub module: Rc<RefCell<ModuleContext>>,
}

impl Object for BufferConstructor {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "from" => JsValue::Function((&from).into()),
      _ => JsValue::Unknown(span),
    }
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    let ident = self
      .module
      .borrow_mut()
      .add_global_import("buffer", Symbol::Default);
    Ok(ident.into())
  }
}

impl Function for BufferConstructor {}

fn from(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let JsValue::Function(f) = this {
    if let Some(buffer) = f.as_any().downcast_ref::<BufferConstructor>() {
      match &args[..] {
        [JsValue::String(string), JsValue::String(encoding)] => {
          let content = match encoding.as_str() {
            "base64" => BASE64.decode(string.as_bytes()).ok(),
            "hex" => HEXLOWER_PERMISSIVE.decode(string.as_bytes()).ok(),
            "utf-8" | "utf8" => Some(string.as_bytes().to_vec()),
            _ => return JsValue::Unknown(span),
          };
          if let Some(content) = content {
            return JsValue::Object(
              Rc::new(Buffer {
                module: buffer.module.clone(),
                content,
              })
              .into(),
            );
          }
        }
        [JsValue::String(string)] => {
          return JsValue::Object(
            Rc::new(Buffer {
              module: buffer.module.clone(),
              content: string.as_bytes().to_vec(),
            })
            .into(),
          );
        }
        _ => {}
      }
    }
  }

  JsValue::Unknown(span)
}

pub struct Buffer {
  pub module: Rc<RefCell<ModuleContext>>,
  pub content: Vec<u8>,
}

impl Object for Buffer {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop {
      JsValue::String(prop) => match prop.as_str() {
        "toString" => JsValue::Function((&to_string).into()),
        "length" => JsValue::Number(self.content.len() as f64),
        _ => JsValue::Unknown(span),
      },
      JsValue::Number(index) => self
        .content
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
    let ident = self
      .module
      .borrow_mut()
      .add_global_import("buffer", Symbol::Default);
    Ok(quote!(
      "$buffer.from($content, 'base64')" as Expr,
      buffer: Expr = ident.into(),
      content: Expr = BASE64.encode(&self.content).into()
    ))
  }

  fn to_string(&self) -> JsWord {
    std::str::from_utf8(&self.content)
      .ok()
      .map(|s| s.into())
      .unwrap_or_else(|| "".into())
  }
}

fn to_string(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let JsValue::Object(this) = this {
    if let Some(buffer) = this.as_any().downcast_ref::<Buffer>() {
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
        None | Some(JsValue::Undefined | JsValue::Null) => buffer.content.len(),
        Some(JsValue::Number(s)) => *s as usize,
        _ => return JsValue::Unknown(span),
      };
      let slice = &buffer.content[start..end];

      return match encoding {
        "base64" => JsValue::String(BASE64.encode(&slice).into()),
        "hex" => JsValue::String(HEXLOWER.encode(&slice).into()),
        "utf8" | "utf-8" => std::str::from_utf8(&slice)
          .ok()
          .map(|v| JsValue::String(v.into()))
          .unwrap_or(JsValue::Unknown(span)),
        _ => JsValue::Unknown(span),
      };
    }
  }

  JsValue::Unknown(span)
}
