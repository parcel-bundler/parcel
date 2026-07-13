use std::{cell::RefCell, path::PathBuf, rc::Rc};

use rquickjs::{
  Class, Ctx, FromJs, IntoJs, JsLifetime, Object, Value, class::Trace, module::ModuleDef,
};

use crate::cjs::CjsLoader;
use crate::url_search_params::URLSearchParams;
use url::Url;

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class]
pub struct UrlModule {}

#[rquickjs::methods(rename_all = "camelCase")]
impl UrlModule {
  #[qjs(get, rename = "URL")]
  fn url<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Value<'js>> {
    ctx.globals().get("URL")
  }

  #[qjs(get, rename = "URLSearchParams")]
  fn url_search_params<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Value<'js>> {
    ctx.globals().get("URLSearchParams")
  }

  #[qjs(rename = "fileURLToPath")]
  fn file_url_to_path<'js>(ctx: Ctx<'js>, value: Value<'js>) -> rquickjs::Result<String> {
    let url = if let Ok(value) = Class::<URL>::from_js(&ctx, value.clone()) {
      value.borrow().url.borrow().clone()
    } else {
      let value = rquickjs::Coerced::<String>::from_js(&ctx, value)?.0;
      Url::parse(&value)
        .map_err(|err| rquickjs::Exception::throw_type(&ctx, &format!("Invalid URL: {err}")))?
    };

    url
      .to_file_path()
      .map(|path| path.to_string_lossy().into_owned())
      .map_err(|_| rquickjs::Exception::throw_type(&ctx, "The URL must be a file URL"))
  }

  #[qjs(rename = "pathToFileURL")]
  fn path_to_file_url<'js>(
    ctx: Ctx<'js>,
    path: rquickjs::Coerced<String>,
  ) -> rquickjs::Result<Class<'js, URL<'js>>> {
    let mut path = PathBuf::from(path.0);
    if path.is_relative() {
      let process: Object = ctx.globals().get("process")?;
      let cwd: rquickjs::Function = process.get("cwd")?;
      path = PathBuf::from(cwd.call::<_, String>(())?).join(path);
    }

    let url = Url::from_file_path(path)
      .map_err(|_| rquickjs::Exception::throw_type(&ctx, "Invalid file path"))?;
    Class::instance(ctx.clone(), URL::from_url(ctx, url)?)
  }
}

impl ModuleDef for UrlModule {
  fn declare<'js>(decl: &rquickjs::module::Declarations<'js>) -> rquickjs::Result<()> {
    for name in [
      "default",
      "URL",
      "URLSearchParams",
      "fileURLToPath",
      "pathToFileURL",
      "parse",
      "resolve",
      "resolveObject",
      "format",
      "Url",
    ] {
      decl.declare(name)?;
    }
    Ok(())
  }

  fn evaluate<'js>(
    ctx: &Ctx<'js>,
    exports: &rquickjs::module::Exports<'js>,
  ) -> rquickjs::Result<()> {
    let module = url_module(ctx)?;
    for name in [
      "URL",
      "URLSearchParams",
      "fileURLToPath",
      "pathToFileURL",
      "parse",
      "resolve",
      "resolveObject",
      "format",
      "Url",
    ] {
      exports.export(name, module.get::<_, Value>(name)?)?;
    }
    exports.export("default", module)?;
    Ok(())
  }
}

pub fn url_module<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
  let cjs = ctx.userdata::<CjsLoader>().unwrap();
  let legacy = cjs.load(ctx, "builtin:url-legacy/index.js")?;
  let legacy = legacy.into_object().ok_or(rquickjs::Error::Unknown)?;
  let module = UrlModule {}.into_js(ctx)?;
  let module = module.into_object().ok_or(rquickjs::Error::Unknown)?;
  for key in legacy.keys::<String>() {
    let key = key?;
    module.set(&key, legacy.get::<_, Value>(&key)?)?;
  }
  Ok(module)
}

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class]
pub struct URL<'js> {
  #[qjs(skip_trace)]
  url: Rc<RefCell<Url>>,
  search_params: Class<'js, URLSearchParams>,
}

#[rquickjs::methods(rename_all = "camelCase")]
impl<'js> URL<'js> {
  #[qjs(skip)]
  fn from_url(ctx: Ctx<'js>, url: Url) -> rquickjs::Result<Self> {
    let url = Rc::new(RefCell::new(url));
    Ok(URL {
      url: url.clone(),
      search_params: Class::instance(ctx, URLSearchParams { url })?,
    })
  }

  #[qjs(constructor)]
  pub fn new(
    ctx: Ctx<'js>,
    input: rquickjs::Coerced<String>,
    base: rquickjs::function::Opt<rquickjs::Coerced<String>>,
  ) -> rquickjs::Result<Self> {
    if let Some(base) = base.0 {
      match url::Url::parse(&base) {
        Ok(base) => match base.join(&input.0) {
          Ok(url) => {
            let url = Rc::new(RefCell::new(url));
            return Ok(URL {
              url: url.clone(),
              search_params: Class::instance(ctx, URLSearchParams { url })?,
            });
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
          let url = Rc::new(RefCell::new(url));
          return Ok(URL {
            url: url.clone(),
            search_params: Class::instance(ctx, URLSearchParams { url })?,
          });
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
    self.url.borrow().to_string()
  }

  pub fn to_json(&self) -> String {
    self.url.borrow().to_string()
  }

  #[qjs(get)]
  pub fn href(&self) -> String {
    self.url.borrow().to_string()
  }

  #[qjs(set, rename = "href")]
  pub fn set_href(&mut self, value: String) {
    if let Ok(url) = url::Url::parse(&value) {
      *self.url.borrow_mut() = url;
    }
  }

  #[qjs(get)]
  pub fn origin(&self) -> String {
    self.url.borrow().origin().ascii_serialization()
  }

  #[qjs(get)]
  pub fn protocol(&self) -> String {
    format!("{}:", self.url.borrow().scheme())
  }

  #[qjs(set, rename = "protocol")]
  pub fn set_protocol(&mut self, value: String) {
    let scheme = value.trim_end_matches(':');
    let _ = self.url.borrow_mut().set_scheme(scheme);
  }

  #[qjs(get)]
  pub fn username(&self) -> String {
    self.url.borrow().username().to_string()
  }
  #[qjs(set, rename = "username")]
  pub fn set_username(&mut self, value: String) {
    self.url.borrow_mut().set_username(&value).ok();
  }

  #[qjs(get)]
  pub fn password(&self) -> String {
    self.url.borrow().password().unwrap_or("").to_string()
  }

  #[qjs(set, rename = "password")]
  pub fn set_password(&mut self, value: String) {
    self.url.borrow_mut().set_password(Some(&value)).ok();
  }

  #[qjs(get)]
  pub fn host(&self) -> String {
    let url = self.url.borrow();
    match url.port() {
      Some(port) => format!("{}:{}", url.host_str().unwrap_or(""), port),
      None => url.host_str().unwrap_or("").to_string(),
    }
  }

  #[qjs(set, rename = "host")]
  pub fn set_host(&mut self, value: String) {
    // Split host:port
    let mut parts = value.splitn(2, ':');
    let host = parts.next().unwrap_or("");
    let port = parts.next();
    let mut url = self.url.borrow_mut();
    url.set_host(Some(host)).ok();
    if let Some(port) = port {
      if let Ok(port) = port.parse::<u16>() {
        url.set_port(Some(port)).ok();
      } else {
        url.set_port(None).ok();
      }
    } else {
      url.set_port(None).ok();
    }
  }

  #[qjs(get)]
  pub fn hostname(&self) -> String {
    self.url.borrow().host_str().unwrap_or("").to_string()
  }

  #[qjs(set, rename = "hostname")]
  pub fn set_hostname(&mut self, value: String) {
    self.url.borrow_mut().set_host(Some(&value)).ok();
  }

  #[qjs(get)]
  pub fn port(&self) -> String {
    self
      .url
      .borrow()
      .port()
      .map(|p| p.to_string())
      .unwrap_or_default()
  }

  #[qjs(set, rename = "port")]
  pub fn set_port(&mut self, value: String) {
    if value.is_empty() {
      self.url.borrow_mut().set_port(None).ok();
    } else if let Ok(port) = value.parse::<u16>() {
      self.url.borrow_mut().set_port(Some(port)).ok();
    }
  }

  #[qjs(get)]
  pub fn pathname(&self) -> String {
    self.url.borrow().path().to_string()
  }

  #[qjs(set, rename = "pathname")]
  pub fn set_pathname(&mut self, value: String) {
    self.url.borrow_mut().set_path(&value);
  }

  #[qjs(get)]
  pub fn search(&self) -> String {
    match self.url.borrow().query() {
      Some(q) => format!("?{}", q),
      None => "".to_string(),
    }
  }

  #[qjs(set, rename = "search")]
  pub fn set_search(&mut self, value: String) {
    let v = value.strip_prefix('?').unwrap_or(&value);
    if v.is_empty() {
      self.url.borrow_mut().set_query(None);
    } else {
      self.url.borrow_mut().set_query(Some(v));
    }
  }

  #[qjs(get)]
  pub fn search_params(&self) -> &rquickjs::Value<'js> {
    self.search_params.as_value()
  }

  #[qjs(get)]
  pub fn hash(&self) -> String {
    match self.url.borrow().fragment() {
      Some(f) => format!("#{}", f),
      None => "".to_string(),
    }
  }

  #[qjs(set, rename = "hash")]
  pub fn set_hash(&mut self, value: String) {
    let v = value.strip_prefix('#').unwrap_or(&value);
    if v.is_empty() {
      self.url.borrow_mut().set_fragment(None);
    } else {
      self.url.borrow_mut().set_fragment(Some(v));
    }
  }

  #[qjs(static)]
  pub fn parse(
    ctx: Ctx<'js>,
    input: rquickjs::Coerced<String>,
    base: rquickjs::function::Opt<rquickjs::Coerced<String>>,
  ) -> Option<Self> {
    if let Some(base) = base.0 {
      match url::Url::parse(&base) {
        Ok(base) => match base.join(&input.0) {
          Ok(url) => {
            let url = Rc::new(RefCell::new(url));
            return Some(URL {
              url: url.clone(),
              search_params: Class::instance(ctx, URLSearchParams { url }).ok()?,
            });
          }
          Err(_) => {
            return None;
          }
        },
        Err(_) => {
          return None;
        }
      }
    } else {
      match url::Url::parse(&input.0) {
        Ok(url) => {
          let url = Rc::new(RefCell::new(url));
          return Some(URL {
            url: url.clone(),
            search_params: Class::instance(ctx, URLSearchParams { url }).ok()?,
          });
        }
        Err(_) => {
          return None;
        }
      }
    }
  }

  #[qjs(static)]
  pub fn can_parse(
    input: rquickjs::Coerced<String>,
    base: rquickjs::function::Opt<rquickjs::Coerced<String>>,
  ) -> rquickjs::Result<bool> {
    let url = if let Some(base) = base.0 {
      match url::Url::parse(&base) {
        Ok(base_url) => base_url.join(&input.0),
        Err(_) => Err(url::ParseError::RelativeUrlWithoutBase),
      }
    } else {
      url::Url::parse(&input.0)
    };

    Ok(url.is_ok())
  }
}
