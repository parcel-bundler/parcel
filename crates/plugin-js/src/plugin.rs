use std::{path::Path, sync::Arc};

use parcel_core::{Asset, AssetType, BufferContent, OutputFormat, Target, Transformer};
use rquickjs::{
  Class, Ctx, FromJs, Function, IntoJs, JsLifetime, Object, TypedArray,
  class::{self, Trace},
  methods,
};

use crate::{cjs::CjsLoader, with_js_env};

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

pub fn load_module<'js>(ctx: &Ctx<'js>, path: &str) -> rquickjs::Result<Object<'js>> {
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
      target: asset.target.clone(),
    }
  }
}

#[derive(JsLifetime)]
#[rquickjs::class]
pub struct JsTarget {
  target: Arc<Target>,
}

impl<'js> Trace<'js> for JsTarget {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods]
impl JsTarget {
  #[qjs(get, rename = "outputFormat")]
  fn output_format(&self) -> &str {
    match self.target.output_format {
      OutputFormat::Commonjs => "commonjs",
      OutputFormat::Esmodule => "esmodule",
      OutputFormat::Global => "global",
    }
  }
}
