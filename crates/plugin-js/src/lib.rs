use std::{cell::RefCell, path::Path, rc::Rc, sync::Arc};

use indexmap::IndexMap;
use parcel_core::{
  Asset, AssetFlags, AssetRequest, AssetType, BufferContent, BundleBehavior, Dependency,
  DependencyFlags, DependencyResolution, Diagnostic, Environment, ExportsCondition, FileSystem,
  Location, OsFileSystem, OutputFormat, Priority, SourceLocation, SourceUrl, SpecifierType,
  Transformer,
};
use parcel_macros::{JsValue, MacroError};
use rquickjs::{
  Class, Context, Ctx, FromJs, Function, IntoJs, JsLifetime, Module, Object, Runtime, Symbol, Type,
  TypedArray, Value,
  class::{self, JsClass, Trace},
  function::{Args, Constructor},
  methods,
  object::Accessor,
  prelude::Rest,
};
use rquickjs_extra_console::Formatter;

pub use crate::{cjs::CjsLoader, esm::create_esm_loader};

mod cjs;
mod esm;

thread_local! {
  static JS_ENV: RefCell<Option<Context>> = RefCell::new(None);
}

fn with_js_env<F, R>(f: F) -> Result<R, Diagnostic>
where
  F: FnOnce(&Ctx) -> rquickjs::Result<R>,
{
  JS_ENV.with(|cell| {
    let mut context = cell.borrow_mut();

    if context.is_none() {
      let ctx = create_runtime(Arc::new(OsFileSystem {}))
        .map_err(|e| Diagnostic::from_message(e.to_string()))?;
      *context = Some(ctx);
    }

    let env = context.as_ref().unwrap();
    env.with(|ctx| {
      f(&ctx).map_err(|e| Diagnostic {
        origin: None,
        message: if matches!(e, rquickjs::Error::Exception) {
          let e = ctx.catch();
          if let Some(exception) = e.as_exception() {
            exception.to_string()
          } else if let Some(message) = e.as_string() {
            message.to_string().unwrap_or_else(|e| e.to_string())
          } else {
            "Unknown error".into()
          }
        } else {
          e.to_string()
        },
        code_frames: Vec::new(),
        documentation_url: None,
        hints: Vec::new(),
        severity: parcel_core::DiagnosticSeverity::Error,
      })
    })
  })
}

pub fn create_runtime(fs: Arc<dyn FileSystem>) -> rquickjs::Result<Context> {
  let runtime = Runtime::new()?;
  let ctx = Context::full(&runtime)?;
  let (resolver, loader) = create_esm_loader("/".into(), fs.clone());
  runtime.set_loader(resolver, loader);
  // runtime.set_max_stack_size(10 * 1024 * 1024);

  ctx.with(|ctx| -> rquickjs::Result<()> {
    ctx.store_userdata(CjsLoader::new("/".into(), fs))?;

    let global = ctx.globals();
    let req = Function::new(ctx.clone(), cjs::require)?;
    req.prop("cache", Object::new(ctx.clone()))?;
    req.prop("resolve", Function::new(ctx.clone(), cjs::require_resolve)?)?;
    global.prop("require", req)?;

    global.prop("module", Accessor::new(cjs::get_module, || {}))?;

    let console = Console::new(Formatter::default());
    global.set("console", console)?;

    global.set("process", Process {})?;
    global.set("global", global.clone())?;

    global.set("TextDecoder", TextDecoder::constructor(&ctx))?;
    global.set("TextEncoder", TextEncoder::constructor(&ctx))?;
    global.set("URL", URL::constructor(&ctx))?;

    global.set("atob", Function::new(ctx.clone(), atob)?)?;
    global.set("btoa", Function::new(ctx.clone(), btoa)?)?;

    Ok(())
  })?;

  Ok(ctx)
}

pub struct JsPlugin {
  path: String,
}

impl JsPlugin {
  pub fn new(path: &Path) -> JsPlugin {
    JsPlugin {
      path: path.to_str().unwrap().to_owned(),
    }
  }
}

fn load_module<'js>(ctx: &Ctx<'js>, path: &str) -> rquickjs::Result<Object<'js>> {
  let cjs = ctx.userdata::<CjsLoader>().unwrap();
  let module = cjs.load(ctx, path)?;
  module.into_object().ok_or(rquickjs::Error::Unknown)
}

impl Transformer for JsPlugin {
  fn transform(
    &self,
    asset: Asset,
    _options: &parcel_core::ParcelOptions,
  ) -> std::result::Result<Asset, parcel_core::DiagnosticList> {
    let asset = with_js_env(|ctx| {
      // let promise = Module::import(&ctx, self.path.clone())?;
      // let module: Object = promise.finish()?;
      let module = load_module(&ctx, &self.path)?;
      // let default: Object = module.get("default")?;
      // let symbol: Object = ctx.globals().get("Symbol")?;
      // let symbol_for: Function = symbol.get("for")?;
      // let sym: Symbol = symbol_for.call(("parcel-plugin-config",))?;
      // let config: Object = default.get(sym)?;
      let transform: Function = module.get("transform")?;
      let asset = JsAsset { asset: Some(asset) };
      let value = asset.into_js(&ctx)?;
      let _: () = transform.call((value.clone(),))?;
      let obj = Class::<JsAsset>::from_js(&ctx, value)?;
      let js_asset = &mut *obj.borrow_mut();
      let asset = js_asset.asset.take().expect("Asset already taken");
      Ok(asset)
    })?;

    Ok(asset)
  }
}

#[derive(JsLifetime)]
#[rquickjs::class]
struct JsAsset {
  asset: Option<Asset>,
}

impl<'js> Trace<'js> for JsAsset {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods]
impl JsAsset {
  #[qjs(get)]
  fn url(&self) -> &str {
    let Some(asset) = &self.asset else {
      unreachable!()
    };
    asset.loc.url.as_str()
  }

  #[qjs(get, rename = "type")]
  fn get_type(&self) -> &str {
    let Some(asset) = &self.asset else {
      unreachable!()
    };
    asset.ty.extension()
  }

  #[qjs(set, rename = "type")]
  fn set_type(&mut self, ty: String) {
    let Some(asset) = &mut self.asset else {
      unreachable!()
    };
    asset.ty = AssetType::from_extension(&ty)
  }

  fn bytes<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<TypedArray<'js, u8>> {
    let Some(asset) = &self.asset else {
      unreachable!()
    };
    let src = asset.content.read().unwrap();
    TypedArray::new(ctx, src)
  }

  fn text(&self) -> rquickjs::Result<String> {
    let Some(asset) = &self.asset else {
      unreachable!()
    };
    let src = asset.content.read().unwrap();
    Ok(String::from_utf8(src).unwrap())
  }

  #[qjs(rename = "setBytes")]
  fn set_bytes<'js>(&mut self, buf: TypedArray<'js, u8>) {
    let Some(asset) = &mut self.asset else {
      unreachable!()
    };
    asset.content = Arc::new(BufferContent::new(buf.as_bytes().unwrap().to_owned()));
  }

  #[qjs(rename = "setText")]
  fn set_text(&mut self, value: String) {
    let Some(asset) = &mut self.asset else {
      unreachable!()
    };
    asset.content = Arc::new(BufferContent::new(value.into_bytes()));
  }

  #[qjs(get)]
  fn target(&mut self) -> JsTarget {
    let Some(asset) = &mut self.asset else {
      unreachable!()
    };
    JsTarget {
      env: asset.env.clone(),
    }
  }
}

#[derive(JsLifetime)]
#[rquickjs::class]
pub struct JsTarget {
  env: Arc<Environment>,
}

impl<'js> Trace<'js> for JsTarget {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods]
impl JsTarget {
  #[qjs(get, rename = "outputFormat")]
  fn output_format(&self) -> &str {
    match self.env.output_format {
      OutputFormat::Commonjs => "commonjs",
      OutputFormat::Esmodule => "esmodule",
      OutputFormat::Global => "global",
    }
  }
}

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class(frozen)]
pub struct Console {
  formatter: Formatter,
}

impl Console {
  pub fn new(formatter: Formatter) -> Self {
    Self { formatter }
  }

  fn print(&self, values: Rest<Value<'_>>) -> rquickjs::Result<()> {
    use std::fmt::Write;
    let mut message = String::new();
    for (i, value) in values.0.into_iter().enumerate() {
      if i > 0 {
        write!(&mut message, ", ").map_err(|_| rquickjs::Error::Unknown)?
      }
      self.formatter.format(&mut message, value)?
    }
    // log::log!(target: &self.target, level, "{message}");
    println!("{}", message);
    Ok(())
  }
}

#[rquickjs::methods]
impl Console {
  // fn debug(&self, values: Rest<Value<'_>>) -> rquickjs::Result<()> {
  //   self.print(log::Level::Debug, values)
  // }

  fn log(&self, values: Rest<Value<'_>>) -> rquickjs::Result<()> {
    self.print(values)
  }

  // fn warn(&self, values: Rest<Value<'_>>) -> rquickjs::Result<()> {
  //   self.print(log::Level::Warn, values)
  // }

  // fn error(&self, values: Rest<Value<'_>>) -> rquickjs::Result<()> {
  //   self.print(log::Level::Error, values)
  // }
}

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class(frozen)]
pub struct Process {}

#[methods]
impl Process {
  #[qjs(get)]
  fn env<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    Object::new(ctx)
  }

  #[qjs(get)]
  fn browser(&self) -> bool {
    true
  }

  fn cwd(&self) -> String {
    std::env::current_dir()
      .unwrap()
      .to_str()
      .unwrap()
      .to_owned()
  }
}

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
fn btoa(string: String) -> String {
  use data_encoding::BASE64;
  BASE64.encode(string.as_bytes())
}

#[rquickjs::function]
fn atob<'js>(ctx: Ctx<'js>, string: String) -> rquickjs::Result<rquickjs::String> {
  use data_encoding::BASE64;
  match BASE64.decode(string.as_bytes()) {
    Ok(v) => {
      let str: String = v.iter().map(|&b| b as char).collect();
      rquickjs::String::from_str(ctx, &str)
    }
    Err(_) => Err(rquickjs::Exception::throw_message(&ctx, "Invalid base64")),
  }
}

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

#[derive(JsLifetime)]
#[rquickjs::class]
pub struct MacroContext {
  url: SourceUrl,
  env: Arc<Environment>,
  loc: parcel_macros::Location,
  dependencies: Rc<RefCell<Vec<Dependency>>>,
}

impl<'js> Trace<'js> for MacroContext {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods]
impl MacroContext {
  #[qjs(rename = "addAsset")]
  fn add_asset<'js>(&mut self, asset: Object<'js>) {
    let ty: String = asset.get("type").unwrap();
    let content: String = asset.get("content").unwrap();
    self.dependencies.borrow_mut().push(Dependency {
      specifier: format!("macro"),
      specifier_type: SpecifierType::Esm,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::empty(),
      env: self.env.clone(),
      loc: Some(SourceLocation {
        url: self.url.clone(),
        start: Location {
          line: self.loc.line,
          column: self.loc.col,
        },
        end: Location {
          line: self.loc.line,
          column: self.loc.col,
        },
      }),
      placeholder: None,
      resolve_from: None,
      range: None,
      conditions: ExportsCondition::empty(),
      resolution: DependencyResolution::Deferred(Arc::new(AssetRequest {
        url: self.url.clone(),
        ty: AssetType::from_extension(&ty),
        pipeline: None,
        env: self.env.clone(),
        code: Some(content.into_bytes()),
        side_effects: true,
      })),
    })
  }

  #[qjs(get)]
  fn loc<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    let res = Object::new(ctx)?;
    res.set("filePath", self.url.as_str())?;
    res.set("line", self.loc.line)?;
    res.set("col", self.loc.col)?;
    Ok(res)
  }

  // TODO: invalidations
}

pub fn call_macro(
  url: SourceUrl,
  env: Arc<Environment>,
  src: String,
  export: String,
  args: Vec<JsValue>,
  loc: parcel_macros::Location,
) -> Result<(JsValue, Vec<Dependency>), MacroError> {
  with_js_env(|ctx| {
    let module = load_module(&ctx, &src)?;
    let f: Function = module.get(&export)?;
    let mut js_args = Args::new(ctx.clone(), args.len());
    let dependencies = Rc::new(RefCell::new(Vec::new()));
    let context = MacroContext {
      url,
      env,
      loc,
      dependencies: dependencies.clone(),
    };
    js_args.this(context)?;
    for arg in args {
      js_args.push_arg(js_value_to_quickjs(arg, ctx.clone())?)?;
    }
    let result: rquickjs::Value = f.call_arg(js_args)?;
    if result.is_promise() {
      // TODO
    }
    let result = quickjs_to_js_value(result, ctx.clone())?;
    Ok((result, std::mem::take(&mut *dependencies.borrow_mut())))
  })
  .map_err(|d| MacroError::ExecutionError(d.message, Default::default()))
}

fn js_value_to_quickjs<'a>(value: JsValue, ctx: Ctx<'a>) -> rquickjs::Result<rquickjs::Value<'a>> {
  match value {
    JsValue::Undefined => Ok(rquickjs::Value::new_undefined(ctx)),
    JsValue::Null => Ok(rquickjs::Value::new_null(ctx)),
    JsValue::Bool(b) => Ok(rquickjs::Value::new_bool(ctx, b)),
    JsValue::Number(n) => Ok(rquickjs::Value::new_number(ctx, n)),
    JsValue::String(s) => Ok(rquickjs::String::from_str(ctx, &s)?.into_value()),
    JsValue::Regex { source, flags } => {
      let regexp_class: Constructor = ctx.globals().get("RegExp")?;
      let source = rquickjs::String::from_str(ctx.clone(), &source)?.into_value();
      let flags = rquickjs::String::from_str(ctx, &flags)?.into_value();
      let re: Value = regexp_class.construct((source, flags))?;
      Ok(re)
    }
    JsValue::Array(arr) => {
      let res = rquickjs::Array::new(ctx.clone())?;
      for (i, val) in arr.into_iter().enumerate() {
        res.set(i, js_value_to_quickjs(val, ctx.clone())?)?;
      }
      Ok(res.into_value())
    }
    JsValue::Object(obj) => {
      let mut res = rquickjs::Object::new(ctx.clone())?;
      for (k, v) in obj {
        res.set(&k, js_value_to_quickjs(v, ctx.clone())?)?;
      }
      Ok(res.into_value())
    }
    JsValue::Function(_) => {
      // Functions can only be returned from macros, not passed in.
      unreachable!()
    }
  }
}

fn quickjs_to_js_value<'a>(value: rquickjs::Value<'a>, ctx: Ctx<'a>) -> rquickjs::Result<JsValue> {
  match value.type_of() {
    Type::Undefined | Type::Uninitialized => Ok(JsValue::Undefined),
    Type::Null => Ok(JsValue::Null),
    Type::Float => Ok(JsValue::Number(value.as_float().unwrap())),
    Type::Int => Ok(JsValue::Number(value.as_int().unwrap() as f64)),
    Type::Bool => Ok(JsValue::Bool(value.as_bool().unwrap())),
    Type::String => Ok(JsValue::String(
      value.get::<rquickjs::String>()?.to_string()?,
    )),
    Type::Array => {
      let js_arr = value.get::<rquickjs::Array>()?;
      let len = js_arr.len();
      let mut arr = Vec::with_capacity(len);
      for i in 0..len {
        let elem = quickjs_to_js_value(js_arr.get(i)?, ctx.clone())?;
        arr.push(elem);
      }
      Ok(JsValue::Array(arr))
    }
    Type::Object => {
      let obj = value.get::<rquickjs::Object>()?;
      let regexp_class: Constructor = ctx.globals().get("RegExp")?;
      if obj.is_instance_of(regexp_class) {
        let source: rquickjs::String = obj.get("source")?;
        let flags: rquickjs::String = obj.get("flags")?;
        return Ok(JsValue::Regex {
          source: source.to_string()?,
          flags: flags.to_string()?,
        });
      }

      let mut props = IndexMap::new();
      for prop in obj.props::<rquickjs::String, rquickjs::Value>() {
        let (key, value) = prop?;
        let value = quickjs_to_js_value(value, ctx.clone())?;
        props.insert(key.to_string()?, value);
      }
      Ok(JsValue::Object(props))
    }
    Type::Function | Type::Constructor => {
      let string: Function = ctx.globals().get("String")?;
      let source: rquickjs::String = string.call((value, ()))?;
      Ok(JsValue::Function(source.to_string()?))
    }
    Type::Symbol
    | Type::Promise
    | Type::Exception
    | Type::Proxy
    | Type::Module
    | Type::Unknown
    | Type::BigInt => Err(rquickjs::Error::Unknown),
  }
}
