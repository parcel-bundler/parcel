use rquickjs::{
  Ctx, JsLifetime,
  class::{self, Trace},
};

#[derive(Clone, JsLifetime)]
#[rquickjs::class]
pub struct URL {
  url: url::Url,
}

impl<'js> Trace<'js> for URL {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[rquickjs::methods(rename_all = "camelCase")]
impl URL {
  #[qjs(constructor)]
  pub fn new<'js>(
    ctx: Ctx<'js>,
    input: rquickjs::Coerced<String>,
    base: rquickjs::function::Opt<rquickjs::Coerced<String>>,
  ) -> rquickjs::Result<Self> {
    if let Some(base) = base.0 {
      match url::Url::parse(&base) {
        Ok(base) => match base.join(&input.0) {
          Ok(url) => {
            return Ok(URL { url });
          }
          Err(e) => {
            return Err(rquickjs::Exception::throw_type(
              &ctx,
              &format!("Invalid URL: {}", e.to_string()),
            ));
          }
        },
        Err(e) => {
          return Err(rquickjs::Exception::throw_type(
            &ctx,
            &format!("Invalid base URL: {}", e.to_string()),
          ));
        }
      }
    } else {
      match url::Url::parse(&input.0) {
        Ok(url) => {
          return Ok(URL { url });
        }
        Err(e) => {
          return Err(rquickjs::Exception::throw_type(
            &ctx,
            &format!("Invalid URL: {}", e.to_string()),
          ));
        }
      }
    }
  }

  pub fn to_string(&self) -> String {
    self.url.to_string()
  }

  pub fn to_json(&self) -> String {
    self.url.to_string()
  }
}
