use swc_core::{
  common::{Span, DUMMY_SP},
  ecma::{ast::*, atoms::Atom as JsWord},
  quote,
};

use crate::{JsValue, Object};

pub struct ImportMeta {
  url: JsWord,
}

impl ImportMeta {
  pub fn new(url: JsWord) -> ImportMeta {
    ImportMeta { url }
  }
}

impl Object for ImportMeta {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "url" => JsValue::String(self.url.clone()),
      // "distDir" => JsValue::Function((&Helpers::DIST_DIR).into()),
      // "publicUrl" => JsValue::Function((&Helpers::PUBLIC_URL).into()),
      // "devServer" => JsValue::Function((&Helpers::DEV_SERVER).into()),
      _ => JsValue::Unknown(span),
    }
  }

  fn has(&self, prop: &JsValue) -> bool {
    matches!(
      prop.to_string().as_str(),
      "url" | "distDir" | "publicUrl" | "devServer"
    )
  }

  fn entries<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    let keys = &["url", "distDist", "publicUrl", "devServer"];
    Box::new(keys.into_iter().map(|k| {
      (
        (*k).into(),
        self.get(&JsValue::String((*k).into()), DUMMY_SP),
      )
    }))
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    Ok(
      quote!("Object.assign(Object.create(null), {url: $url})" as Expr, url: Expr = self.url.clone().into()),
    )
  }
}
