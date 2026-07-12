use std::{path::Path, sync::Arc};

use parcel_core::{
  Asset, AssetFlags, AssetRequest, AssetType, BufferContent, BundleBehavior, DependencyFlags,
  DependencyResolution, Environment, EnvironmentFlags, ExportsCondition, FileContent, OutputFormat,
  PathId, Priority, Resolver, SourceLocation, SourceType, SourceUrl, SpecifierType, Target,
  Transformer,
};
use rquickjs::{
  Class, Coerced, Ctx, FromJs, Function, IntoJs, JsLifetime, Object, Symbol, TypedArray,
  class::{self, Trace},
  methods,
};

use crate::{await_promise, cjs::CjsLoader, with_js_env};

pub struct JsPlugin {
  path: String,
}

impl JsPlugin {
  pub fn new(path: PathId) -> JsPlugin {
    JsPlugin {
      path: path.with_path(|path| path.to_str().unwrap().to_owned()),
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
    fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> std::result::Result<Asset, parcel_core::DiagnosticList> {
    let asset = with_js_env(fs.clone(), &options.env, options.cwd, |ctx| {
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
      await_promise(ctx, res)?;
      let obj = Class::<JsAsset>::from_js(&ctx, value)?;
      let js_asset = &mut *obj.borrow_mut();
      let asset = js_asset.asset.take().expect("Asset already taken");
      Ok(asset)
    })?;

    Ok(asset)
  }
}

impl Resolver for JsPlugin {
  fn resolve(
    &self,
    dep: &parcel_core::Dependency,
    specifier: &str,
    pipeline: Option<&str>,
    options: &parcel_core::ParcelOptions,
    fs: &Arc<dyn parcel_core::FileSystem>,
  ) -> Result<parcel_core::DependencyResolution, parcel_core::DiagnosticList> {
    with_js_env(fs.clone(), &options.env, options.cwd, |ctx| {
      let module = load_module(&ctx, &self.path)?;
      let symbol: Object = ctx.globals().get("Symbol")?;
      let symbol_for: Function = symbol.get("for")?;
      let sym: Symbol = symbol_for.call(("parcel-plugin-config",))?;
      let config: Object = module.get::<_, Object>(sym.clone()).or_else(|_| {
        module
          .get::<_, Object>("default")
          .and_then(|o| o.get::<_, Object>(sym))
      })?;

      let resolve: Function = config.get("resolve")?;
      let js_dep = JsDependency { dep: dep.clone() };
      let opts = Object::new(ctx.clone())?;
      opts.set("dependency", js_dep)?;
      opts.set("specifier", specifier)?;
      opts.set("pipeline", pipeline)?;

      let res: rquickjs::Value = resolve.call((opts,))?;
      let res = await_promise(ctx, res)?;
      if let Some(res) = res.as_object() {
        // TODO: Support the remaining Resolver API surface: options/logger/tracer/config and
        // loadConfig inputs, plus priority/meta/canDefer/diagnostics/invalidation result fields.
        let is_excluded: Option<bool> = res.get("isExcluded")?;
        if is_excluded == Some(true) {
          return Ok(DependencyResolution::External);
        }

        let file_path: Option<String> = res.get("filePath")?;
        if let Some(file_path) = file_path {
          if !Path::new(&file_path).is_absolute() {
            return Err(rquickjs::Exception::throw_type(
              &ctx,
              &format!("Resolvers must return an absolute path, returned: {file_path}"),
            ));
          }

          let query_value: rquickjs::Value = res.get("query")?;
          let query = if query_value.is_null() || query_value.is_undefined() {
            None
          } else {
            Some(Coerced::<String>::from_js(&ctx, query_value)?.0)
          };
          let side_effects: Option<bool> = res.get("sideEffects")?;
          let code: Option<String> = res.get("code")?;
          let result_pipeline: rquickjs::Value = res.get("pipeline")?;
          let path = PathId::new(Path::new(&file_path));
          let url = SourceUrl::from_path_and_query(&path, query.as_ref().map(|s| s.as_str()));
          let ty = AssetType::from_url(&url);
          return Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
            loc: SourceLocation {
              url,
              ..Default::default()
            },
            content: if let Some(code) = code {
              Arc::new(BufferContent::new(code.into_bytes()))
            } else {
              Arc::new(FileContent::new(path, options.input_fs.clone()))
            },
            target: Target::normalize(&dep.target, &ty),
            pipeline: if result_pipeline.is_undefined() {
              pipeline.map(Into::into)
            } else if result_pipeline.is_null() {
              None
            } else {
              Some(String::from_js(&ctx, result_pipeline)?.into())
            },
            ty,
            side_effects: side_effects.unwrap_or(true),
          })));
        }
      }

      Ok(DependencyResolution::None)
    })
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
  fn url(&self) -> String {
    let Some(asset) = &self.asset else {
      unreachable!()
    };
    asset.loc.url.to_string()
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

#[derive(JsLifetime)]
#[rquickjs::class]
pub struct JsDependency {
  dep: parcel_core::Dependency,
}

impl<'js> Trace<'js> for JsDependency {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods(rename_all = "camelCase")]
impl JsDependency {
  #[qjs(get)]
  pub fn specifier(&self) -> &str {
    &self.dep.specifier
  }

  #[qjs(get)]
  pub fn specifier_type(&self) -> &str {
    match self.dep.specifier_type {
      SpecifierType::Commonjs => "commonjs",
      SpecifierType::Esm => "esm",
      SpecifierType::Url => "url",
      SpecifierType::Custom => "custom",
    }
  }

  #[qjs(get)]
  pub fn priority(&self) -> &str {
    match self.dep.priority {
      Priority::Sync => "sync",
      Priority::Parallel => "parallel",
      Priority::Lazy => "lazy",
    }
  }

  #[qjs(get)]
  pub fn bundle_behavior(&self) -> Option<&str> {
    match self.dep.bundle_behavior {
      BundleBehavior::None => None,
      BundleBehavior::Inline => Some("inline"),
      BundleBehavior::Isolated => Some("isolated"),
    }
  }

  #[qjs(get)]
  pub fn is_entry(&self) -> bool {
    self.dep.flags.contains(DependencyFlags::ENTRY)
  }

  #[qjs(get)]
  pub fn is_optional(&self) -> bool {
    self.dep.flags.contains(DependencyFlags::OPTIONAL)
  }

  #[qjs(get)]
  pub fn needs_stable_name(&self) -> bool {
    self.dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME)
  }

  #[qjs(get)]
  pub fn target(&self) -> JsTarget {
    JsTarget {
      target: self.dep.target.clone(),
    }
  }

  #[qjs(get)]
  pub fn resolve_from(&self) -> Option<String> {
    self.dep.resolve_from.as_ref().map(|s| s.to_string())
  }

  #[qjs(get)]
  pub fn loc<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<Option<Object<'js>>> {
    let Some(loc) = &self.dep.loc else {
      return Ok(None);
    };
    let result = Object::new(ctx.clone())?;
    result.set(
      "filePath",
      loc
        .url
        .to_file_path()
        .map(|path| path.to_path_buf().to_string_lossy().into_owned())
        .unwrap_or_else(|_| loc.url.to_string()),
    )?;
    result.set(
      "start",
      js_location(&ctx, loc.start.line, loc.start.column)?,
    )?;
    result.set("end", js_location(&ctx, loc.end.line, loc.end.column)?)?;
    Ok(Some(result))
  }

  #[qjs(get)]
  pub fn package_conditions(&self) -> Vec<&'static str> {
    let conditions = self.dep.conditions;
    [
      (ExportsCondition::IMPORT, "import"),
      (ExportsCondition::REQUIRE, "require"),
      (ExportsCondition::MODULE, "module"),
      (ExportsCondition::NODE, "node"),
      (ExportsCondition::BROWSER, "browser"),
      (ExportsCondition::WORKER, "worker"),
      (ExportsCondition::WORKLET, "worklet"),
      (ExportsCondition::ELECTRON, "electron"),
      (ExportsCondition::DEVELOPMENT, "development"),
      (ExportsCondition::PRODUCTION, "production"),
      (ExportsCondition::TYPES, "types"),
      (ExportsCondition::DEFAULT, "default"),
      (ExportsCondition::STYLE, "style"),
      (ExportsCondition::SASS, "sass"),
      (ExportsCondition::LESS, "less"),
      (ExportsCondition::STYLUS, "stylus"),
      (ExportsCondition::REACT_SERVER, "react-server"),
      (ExportsCondition::SOURCE, "source"),
    ]
    .into_iter()
    .filter_map(|(flag, name)| conditions.contains(flag).then_some(name))
    .collect()
  }

  #[qjs(get)]
  pub fn range(&self) -> Option<&str> {
    self.dep.range.as_deref()
  }
}

fn js_location<'js>(ctx: &Ctx<'js>, line: u32, column: u32) -> rquickjs::Result<Object<'js>> {
  let location = Object::new(ctx.clone())?;
  location.set("line", line)?;
  location.set("column", column)?;
  Ok(location)
}
