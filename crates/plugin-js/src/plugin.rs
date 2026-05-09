use std::{path::Path, sync::Arc};

use parcel_core::{
  Asset, AssetFlags, AssetType, BufferContent, BundleBehavior, Environment, EnvironmentFlags,
  OutputFormat, SourceType, Target, Transformer,
};
use rquickjs::{
  Class, Ctx, FromJs, Function, IntoJs, JsLifetime, Object, Symbol, TypedArray,
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
    options: &parcel_core::ParcelOptions,
  ) -> std::result::Result<Asset, parcel_core::DiagnosticList> {
    let asset = with_js_env(options.input_fs.clone(), |ctx| {
      let module = load_module(&ctx, &self.path)?;
      let symbol: Object = ctx.globals().get("Symbol")?;
      let symbol_for: Function = symbol.get("for")?;
      let sym: Symbol = symbol_for.call(("parcel-plugin-config",))?;
      let config: Object = module.get::<_, Object>(sym.clone()).or_else(|_| {
        module
          .get::<_, Object>("default")
          .and_then(|o| o.get::<_, Object>(sym))
      })?;
      let transform: Function = config.get("transform")?;
      let asset = JsAsset { asset: Some(asset) };
      let value = asset.into_js(&ctx)?;
      let options = Object::new(ctx.clone())?;
      options.set("asset", value.clone())?;
      let res: rquickjs::Value = transform.call((options,))?;
      if let Some(promise) = res.as_promise() {
        loop {
          if promise.result::<rquickjs::Value>().is_some() {
            break;
          }

          if !ctx.execute_pending_job() {
            let err = ctx.catch();
            if !err.is_null() {
              return Err(ctx.throw(err));
            }
          }
        }
      }
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

#[methods(rename_all = "camelCase")]
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

  fn get_buffer<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<TypedArray<'js, u8>> {
    let Some(asset) = &self.asset else {
      unreachable!()
    };
    let src = asset.content.read().unwrap();
    TypedArray::new(ctx, src)
  }

  fn get_code(&self) -> rquickjs::Result<String> {
    let Some(asset) = &self.asset else {
      unreachable!()
    };
    let src = asset.content.read().unwrap();
    Ok(String::from_utf8(src).unwrap())
  }

  fn set_buffer<'js>(&mut self, buf: TypedArray<'js, u8>) {
    let Some(asset) = &mut self.asset else {
      unreachable!()
    };
    asset.content = Arc::new(BufferContent::new(buf.as_bytes().unwrap().to_owned()));
  }

  fn set_code(&mut self, value: String) {
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

  #[qjs(get)]
  fn is_source(&self) -> bool {
    let Some(asset) = &self.asset else {
      unreachable!()
    };
    asset.flags.contains(AssetFlags::IS_SOURCE)
  }

  #[qjs(get)]
  fn side_effects(&self) -> bool {
    let Some(asset) = &self.asset else {
      unreachable!()
    };
    asset.flags.contains(AssetFlags::SIDE_EFFECTS)
  }

  #[qjs(get, rename = "isBundleSplittable")]
  fn is_bundle_splittable(&self) -> bool {
    let Some(asset) = &self.asset else {
      unreachable!()
    };
    asset.flags.contains(AssetFlags::IS_BUNDLE_SPLITTABLE)
  }

  #[qjs(set, rename = "isBundleSplittable")]
  fn set_is_bundle_splittable(&mut self, value: bool) {
    let Some(asset) = &mut self.asset else {
      unreachable!()
    };
    if value {
      asset.flags.insert(AssetFlags::IS_BUNDLE_SPLITTABLE);
    } else {
      asset.flags.remove(AssetFlags::IS_BUNDLE_SPLITTABLE);
    }
  }

  #[qjs(get, rename = "bundleBehavior")]
  fn bundle_behavior(&self) -> Option<&str> {
    let Some(asset) = &self.asset else {
      unreachable!()
    };
    match asset.bundle_behavior {
      BundleBehavior::None => None,
      BundleBehavior::Inline => Some("inline"),
      BundleBehavior::Isolated => Some("isolated"),
    }
  }

  #[qjs(set, rename = "bundleBehavior")]
  fn set_bundle_behavior(&mut self, value: Option<String>) {
    let Some(asset) = &mut self.asset else {
      unreachable!()
    };
    asset.bundle_behavior = match value.as_deref() {
      None | Some("none") => BundleBehavior::None,
      Some("inline") => BundleBehavior::Inline,
      Some("isolated") => BundleBehavior::Isolated,
      _ => BundleBehavior::None,
    };
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

#[methods(rename_all = "camelCase")]
impl JsTarget {
  #[qjs(get)]
  fn environment(&self) -> &str {
    match self.target.environment {
      Environment::Browser => "browser",
      Environment::WebWorker => "web-worker",
      Environment::ServiceWorker => "service-worker",
      Environment::Worklet => "worklet",
      Environment::Node => "node",
      Environment::ElectronMain => "electron-main",
      Environment::ElectronRenderer => "electron-renderer",
      Environment::ReactClient => "react-client",
      Environment::ReactServer => "react-server",
    }
  }

  #[qjs(get)]
  fn output_format(&self) -> &str {
    match self.target.output_format {
      OutputFormat::Commonjs => "commonjs",
      OutputFormat::Esmodule => "esmodule",
      OutputFormat::Global => "global",
    }
  }

  #[qjs(get)]
  fn source_type(&self) -> &str {
    match self.target.source_type {
      SourceType::Module => "module",
      SourceType::Script => "script",
    }
  }

  #[qjs(get)]
  fn is_library(&self) -> bool {
    self.target.flags.contains(EnvironmentFlags::IS_LIBRARY)
  }

  #[qjs(get)]
  fn should_optimize(&self) -> bool {
    self
      .target
      .flags
      .contains(EnvironmentFlags::SHOULD_OPTIMIZE)
  }

  fn is_browser(&self) -> bool {
    self.target.environment.is_browser()
  }

  fn is_node(&self) -> bool {
    self.target.environment.is_node()
  }

  fn is_electron(&self) -> bool {
    self.target.environment.is_electron()
  }

  fn is_worker(&self) -> bool {
    self.target.environment.is_worker()
  }
}
