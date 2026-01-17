use std::{cell::RefCell, path::Path, sync::Arc};

use parcel_core::{Asset, AssetType, BufferContent, Diagnostic, Transformer};
use rquickjs::{
  Class, Context, Ctx, FromJs, Function, IntoJs, JsLifetime, Module, Object, Runtime, TypedArray,
  Value,
  class::{self, Trace},
  methods,
  object::Accessor,
  prelude::Rest,
};
use rquickjs_extra_console::Formatter;

use crate::{cjs::CjsLoader, esm::create_esm_loader};

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
      let runtime = Runtime::new().map_err(|e| Diagnostic::from_message(e.to_string()))?;
      let ctx = Context::full(&runtime).map_err(|e| Diagnostic::from_message(e.to_string()))?;
      let (resolver, loader) = create_esm_loader("/".into());
      runtime.set_loader(resolver, loader);
      runtime.set_max_stack_size(10 * 1024 * 1024);

      ctx
        .with(|ctx| -> rquickjs::Result<()> {
          ctx.store_userdata(CjsLoader::new("/".into()))?;

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
          Ok(())
        })
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

pub struct JsPlugin {
  path: Vec<u8>,
}

impl JsPlugin {
  pub fn new(path: &Path) -> JsPlugin {
    JsPlugin {
      path: path.as_os_str().as_encoded_bytes().into(),
    }
  }
}

impl Transformer for JsPlugin {
  fn transform(
    &self,
    asset: Asset,
    _options: &parcel_core::ParcelOptions,
  ) -> std::result::Result<Asset, parcel_core::DiagnosticList> {
    let asset = with_js_env(|ctx| {
      let promise = Module::import(&ctx, self.path.clone())?;
      let module: Object = promise.finish()?;
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
