use std::{cell::RefCell, path::Path, rc::Rc, sync::Arc};

use parcel_core::{
  Asset, AssetType, BufferContent, CodeFrame, CodeHighlight, Diagnostic, Environment, FileSystem,
  Location, OsFileSystem, OutputFormat, SourceUrl, Transformer,
};
use rquickjs::{
  Class, Context, Ctx, FromJs, Function, IntoJs, JsLifetime, Object, Runtime, TypedArray,
  class::{self, JsClass, Trace},
  methods,
  object::Accessor,
};
use rquickjs_extra_console::Formatter;

use crate::fs::Fs;
pub use crate::{cjs::CjsLoader, esm::create_esm_loader, macros::call_macro};

mod cjs;
mod console;
mod encoding;
mod esm;
mod fs;
mod macros;
mod process;
mod url;

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
      f(&ctx).map_err(|e| {
        let mut file: Option<String> = None;
        let mut line_number: Option<u32> = None;
        let mut column_number: Option<u32> = None;
        let message = if matches!(e, rquickjs::Error::Exception) {
          let e = ctx.catch();
          if let Some(exception) = e.as_exception() {
            let message = exception.to_string();
            if let Some(stack) = exception.stack() {
              let mut line = stack.split('\n').next().unwrap();
              if line.ends_with(')') {
                line = &line[0..line.len() - 1];
              }
              if let Some(column_pos) = line.rfind(':') {
                column_number = line[column_pos + 1..].parse().ok();
                line = &line[0..column_pos];
                if let Some(line_pos) = line.rfind(':') {
                  line_number = line[line_pos + 1..].parse().ok();
                  line = &line[0..line_pos];
                }
              }
              if let Some(pos) = line.find('(') {
                file = Some(line[pos + 1..].to_string());
              }
            }
            message
          } else if let Some(message) = e.as_string() {
            message.to_string().unwrap_or_else(|e| e.to_string())
          } else {
            "Unknown error".into()
          }
        } else {
          e.to_string()
        };

        Diagnostic {
          origin: None,
          message,
          code_frames: if let (Some(file), Some(line), Some(column)) =
            (file, line_number, column_number)
          {
            vec![CodeFrame {
              url: SourceUrl::from_path(Path::new(&file)).ok(),
              code: None,
              language: None,
              code_highlights: vec![CodeHighlight {
                message: None,
                start: Location { line, column },
                end: Location { line, column },
              }],
            }]
          } else {
            Vec::new()
          },
          documentation_url: None,
          hints: Vec::new(),
          severity: parcel_core::DiagnosticSeverity::Error,
        }
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
    ctx.store_userdata(CjsLoader::new("/".into(), fs.clone()))?;
    ctx.store_userdata(Fs::new(fs))?;

    let global = ctx.globals();
    let req = Function::new(ctx.clone(), cjs::require)?;
    req.prop("cache", Object::new(ctx.clone()))?;
    req.prop("resolve", Function::new(ctx.clone(), cjs::require_resolve)?)?;
    global.prop("require", req)?;

    global.prop("module", Accessor::new(cjs::get_module, || {}))?;
    global.prop("__dirname", Accessor::new(fs::get_dirname, || {}))?;
    global.prop("__filename", Accessor::new(fs::get_filename, || {}))?;

    let console = console::Console::new(Formatter::default());
    global.set("console", console)?;

    global.set("process", process::Process {})?;
    global.set("global", global.clone())?;

    global.set("TextDecoder", encoding::TextDecoder::constructor(&ctx))?;
    global.set("TextEncoder", encoding::TextEncoder::constructor(&ctx))?;
    global.set("URL", url::URL::constructor(&ctx))?;

    global.set("atob", Function::new(ctx.clone(), encoding::atob)?)?;
    global.set("btoa", Function::new(ctx.clone(), encoding::btoa)?)?;

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
