use rquickjs::{Ctx, JsLifetime, Object, class::Trace};

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class]
pub struct TextDecoder {
  encoding: String,
  fatal: bool,
  ignore_bom: bool,
}

#[rquickjs::methods]
impl<'js> TextDecoder {
  #[qjs(constructor)]
  pub fn new(
    label: rquickjs::function::Opt<String>,
    options: rquickjs::function::Opt<Object<'js>>,
  ) -> rquickjs::Result<Self> {
    let mut fatal = false;
    let mut ignore_bom = false;

    if let Some(options) = options.0 {
      if let Ok(opt) = options.get("fatal") {
        fatal = opt;
      }
      if let Ok(opt) = options.get("ignoreBOM") {
        ignore_bom = opt;
      }
    }

    Ok(TextDecoder {
      encoding: label.as_deref().unwrap_or("utf-8").to_owned(),
      fatal,
      ignore_bom,
    })
  }

  #[qjs(get)]
  pub fn encoding(&self) -> &str {
    self.encoding.as_str()
  }

  #[qjs(get)]
  fn fatal(&self) -> bool {
    self.fatal
  }

  #[qjs(get, rename = "ignoreBOM")]
  fn ignore_bom(&self) -> bool {
    self.ignore_bom
  }

  pub fn decode(&self, ctx: Ctx<'js>, bytes: rquickjs::Object<'js>) -> rquickjs::Result<String> {
    if let Some(bytes) = bytes
      .as_array_buffer()
      .and_then(|a| a.as_bytes())
      .or_else(|| bytes.as_typed_array::<u8>().and_then(|t| t.as_bytes()))
    {
      let start_pos = if !self.ignore_bom {
        match (self.encoding.as_str(), bytes.get(..3)) {
          ("utf-16le", Some([0xFF, 0xFE, ..])) => 2,
          ("utf-16be", Some([0xFE, 0xFF, ..])) => 2,
          ("utf-8", Some([0xEF, 0xBB, 0xBF])) => 3,
          _ => 0,
        }
      } else {
        0
      };

      // TODO: other encodings
      Ok(String::from_utf8(bytes[start_pos..].to_vec()).unwrap())
    } else {
      Err(rquickjs::Exception::throw_type(&ctx, "Invalid bytes"))
    }
  }
}

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class]
pub struct TextEncoder {}

#[rquickjs::methods]
impl<'js> TextEncoder {
  #[qjs(constructor)]
  pub fn new() -> rquickjs::Result<Self> {
    Ok(TextEncoder {})
  }

  #[qjs(get)]
  pub fn encoding(&self) -> &str {
    "utf-8"
  }

  pub fn encode(
    &self,
    ctx: Ctx<'js>,
    string: String,
  ) -> rquickjs::Result<rquickjs::TypedArray<'js, u8>> {
    rquickjs::TypedArray::new(ctx, string.as_bytes())
  }
}

#[rquickjs::function]
pub fn btoa(string: String) -> String {
  use data_encoding::BASE64;
  BASE64.encode(string.as_bytes())
}

#[rquickjs::function]
pub fn atob<'js>(ctx: Ctx<'js>, string: String) -> rquickjs::Result<rquickjs::String<'js>> {
  use data_encoding::BASE64;
  match BASE64.decode(string.as_bytes()) {
    Ok(v) => {
      let str: String = v.iter().map(|&b| b as char).collect();
      rquickjs::String::from_str(ctx, &str)
    }
    Err(_) => Err(rquickjs::Exception::throw_message(&ctx, "Invalid base64")),
  }
}
