use std::path::{Path, PathBuf};

use swc_core::common::Span;

use crate::{builtin_object, Evaluator, JsValue, StaticOrRc};

pub fn create_path_module() -> JsValue {
  builtin_object! {
    "join" => JsValue::Function(StaticOrRc::Static(&path_join))
  }
}

pub fn path_join(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  let mut path = PathBuf::new();
  for arg in args {
    match arg {
      JsValue::String(s) => {
        if path.as_os_str().is_empty() {
          path.push(s.to_string());
        } else {
          let s = s.to_string();
          let mut p = Path::new(s.as_str());

          // Node's path.join ignores separators at the start of path components.
          // Rust's does not, so we need to strip them.
          if let Ok(stripped) = p.strip_prefix("/") {
            p = stripped;
          }
          path.push(p);
        }
      }
      _ => return JsValue::Unknown(span),
    }
  }

  JsValue::String(path.to_string_lossy().into())
}
