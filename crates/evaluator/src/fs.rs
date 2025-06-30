use std::{path::Path, rc::Rc};

use data_encoding::{BASE64, HEXLOWER};
use swc_core::common::Span;

use crate::{buffer::Buffer, Evaluator, JsValue};

pub fn create_fs_module(project_root: String) -> JsValue {
  JsValue::Object(
    Rc::new(indexmap::indexmap! {
      "readFileSync".into() => JsValue::Function(Rc::new(move |this, args, span, _evaluator: &Evaluator|{
        read_file_sync(this, args, span, &project_root)
      }).into())
    })
    .into(),
  )
}

fn read_file_sync(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  // deps: Rc<RefCell<Vec<(JsWord, Span)>>>,
  project_root: &str,
  // unresolved_mark: Mark,
) -> JsValue {
  if let Some(JsValue::String(path)) = args.get(0) {
    // deps.borrow_mut().push((path.clone(), span));
    let encoding = match args.get(1) {
      Some(JsValue::String(encoding)) => encoding.as_str(),
      _ => "buffer",
    };

    let path = Path::new(project_root).join(path.as_str());
    // let path = match dunce::canonicalize(path) {
    //   Ok(path) => path,
    //   Err(_err) => return JsValue::Unknown(span),
    // };
    if !path.starts_with(project_root) {
      return JsValue::Unknown(span);
    }

    let contents = match encoding {
      "buffer" => {
        if let Ok(contents) = std::fs::read(&path) {
          return JsValue::Object(Rc::new(Buffer(Rc::new(contents))).into());
        } else {
          return JsValue::Unknown(span);
        }
      }
      "base64" => {
        if let Ok(contents) = std::fs::read(&path) {
          BASE64.encode(&contents)
        } else {
          return JsValue::Unknown(span);
        }
      }
      "hex" => {
        if let Ok(contents) = std::fs::read(&path) {
          HEXLOWER.encode(&contents)
        } else {
          return JsValue::Unknown(span);
        }
      }
      "utf8" | "utf-8" => {
        if let Ok(contents) = std::fs::read_to_string(&path) {
          contents
        } else {
          return JsValue::Unknown(span);
        }
      }
      _ => return JsValue::Unknown(span),
    };

    return JsValue::String(contents.into());
  }

  JsValue::Unknown(span)
}
