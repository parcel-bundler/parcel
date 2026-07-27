use std::{cell::Cell, marker::PhantomData, path::Path, ptr::NonNull, rc::Rc, sync::Arc};

use parcel_core::{
  Asset, AssetFlags, AssetNode, AssetRequest, AssetType, BufferContent, Bundle, BundleBehavior,
  BundleFlags, BundleGraph, Content, ContentWithSourceMap, DependencyFlags, DependencyResolution,
  Environment, EnvironmentFlags, ExportsCondition, FileContent, Namer, Optimizer, OutputFormat,
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
  config: Option<serde_json::Value>,
}

impl JsPlugin {
  pub fn new(path: PathId, config: Option<serde_json::Value>) -> JsPlugin {
    JsPlugin {
      path: path.with_path(|path| path.to_str().unwrap().to_owned()),
      config,
    }
  }

  fn config_to_js<'js>(&self, ctx: &Ctx<'js>) -> rquickjs::Result<rquickjs::Value<'js>> {
    match &self.config {
      Some(config) => ctx.json_parse(config.to_string()),
      None => Ok(rquickjs::Value::new_undefined(ctx.clone())),
    }
  }
}

impl Optimizer for JsPlugin {
  fn optimize(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    contents: Arc<dyn Content>,
    options: &parcel_core::ParcelOptions,
  ) -> Result<Arc<dyn Content>, parcel_core::DiagnosticList> {
    let bundle_index = bundle_graph
      .bundles
      .iter()
      .position(|candidate| std::ptr::eq(candidate, bundle))
      .expect("Bundle passed to optimizer must belong to the bundle graph");
    let source_map = contents
      .downcast_ref::<ContentWithSourceMap>()
      .map(|contents| contents.source_map().to_vec());
    let contents = contents.read()?;

    with_call_scope(|scope| {
      let bundles = Arc::new(
        bundle_graph
          .bundles
          .iter()
          .map(|bundle| scope.wrap(bundle))
          .collect::<Vec<_>>(),
      );
      let assets = Arc::new(
        bundle_graph
          .asset_graph
          .assets
          .iter()
          .map(|asset| scope.wrap(asset))
          .collect::<Vec<_>>(),
      );

      with_js_env(options.input_fs.clone(), &options.env, options.cwd, |ctx| {
        let module = load_module(ctx, &self.path)?;
        let symbol: Object = ctx.globals().get("Symbol")?;
        let symbol_for: Function = symbol.get("for")?;
        let sym: Symbol = symbol_for.call(("parcel-plugin-config",))?;
        let config: Object = module.get::<_, Object>(sym.clone()).or_else(|_| {
          module
            .get::<_, Object>("default")
            .and_then(|o| o.get::<_, Object>(sym))
        })?;
        let optimize: Function = config.get("optimize")?;
        let args = Object::new(ctx.clone())?;
        args.set(
          "bundle",
          JsBundle::new(bundle_index, bundles.clone(), assets.clone()),
        )?;
        args.set(
          "bundleGraph",
          JsBundleGraph::new(bundles.clone(), assets.clone()),
        )?;
        args.set("contents", TypedArray::new(ctx.clone(), contents)?)?;
        if let Some(source_map) = source_map {
          args.set("map", TypedArray::new(ctx.clone(), source_map)?)?;
        } else {
          args.set("map", rquickjs::Value::new_null(ctx.clone()))?;
        }
        args.set("config", self.config_to_js(ctx)?)?;

        let result: rquickjs::Value = optimize.call((args,))?;
        let result = await_promise(ctx, result)?;
        let result = result.into_object().ok_or_else(|| {
          rquickjs::Error::new_from_js_message("optimizer result", "object", "Expected an object")
        })?;
        let contents: TypedArray<u8> = result.get("contents")?;
        let contents = contents
          .as_bytes()
          .ok_or_else(|| {
            rquickjs::Error::new_from_js_message("contents", "Uint8Array", "Invalid Uint8Array")
          })?
          .to_vec();
        let map: rquickjs::Value = result.get("map")?;
        if map.is_null() || map.is_undefined() {
          Ok(Arc::new(BufferContent::new(contents)) as Arc<dyn Content>)
        } else {
          let map = TypedArray::<u8>::from_js(ctx, map)?;
          let map = map
            .as_bytes()
            .ok_or_else(|| {
              rquickjs::Error::new_from_js_message("map", "Uint8Array", "Invalid Uint8Array")
            })?
            .to_vec();
          Ok(Arc::new(ContentWithSourceMap::new(contents, map)) as Arc<dyn Content>)
        }
      })
    })
  }
}

pub fn load_module<'js>(ctx: &Ctx<'js>, path: &str) -> rquickjs::Result<Object<'js>> {
  let cjs = ctx.userdata::<CjsLoader>().unwrap();
  let module = cjs.load(ctx, path)?;
  module.into_object().ok_or(rquickjs::Error::Unknown)
}

/// A non-owning reference which may be retained by JavaScript, but can only be
/// dereferenced while its originating call scope is alive.
struct ScopedRef<T> {
  ptr: NonNull<T>,
  alive: Rc<Cell<bool>>,
}

impl<T> Clone for ScopedRef<T> {
  fn clone(&self) -> Self {
    Self {
      ptr: self.ptr,
      alive: self.alive.clone(),
    }
  }
}

unsafe impl<'js, T: 'static> JsLifetime<'js> for ScopedRef<T> {
  type Changed<'to> = ScopedRef<T>;
}

impl<T> ScopedRef<T> {
  fn with<R>(&self, f: impl for<'a> FnOnce(&'a T) -> R) -> rquickjs::Result<R> {
    if !self.alive.get() {
      return Err(rquickjs::Error::new_from_js_message(
        "scoped object",
        "live scoped object",
        "This object can no longer be accessed because its plugin call has completed",
      ));
    }

    // SAFETY: ScopedRef values can only be created by CallScope::wrap. The
    // higher-ranked with_call_scope closure ensures all source references live
    // through the call, and CallScope::drop invalidates every handle before
    // those references may expire. The pointer is never exposed to callers.
    Ok(f(unsafe { self.ptr.as_ref() }))
  }
}

struct CallScope<'scope> {
  alive: Rc<Cell<bool>>,
  _lifetime: PhantomData<Cell<&'scope ()>>,
}

impl<'scope> CallScope<'scope> {
  fn wrap<T>(&self, value: &'scope T) -> ScopedRef<T> {
    ScopedRef {
      ptr: NonNull::from(value),
      alive: self.alive.clone(),
    }
  }
}

impl Drop for CallScope<'_> {
  fn drop(&mut self) {
    self.alive.set(false);
  }
}

fn with_call_scope<'scope, R>(f: impl FnOnce(&CallScope<'scope>) -> R) -> R {
  let scope = CallScope {
    alive: Rc::new(Cell::new(true)),
    _lifetime: PhantomData,
  };
  f(&scope)
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
      let asset = JsAsset::owned(asset);
      let value = asset.into_js(&ctx)?;
      let options = Object::new(ctx.clone())?;
      options.set("asset", value.clone())?;
      options.set("config", self.config_to_js(ctx)?)?;
      let res: rquickjs::Value = transform.call((options,))?;
      await_promise(ctx, res)?;
      let obj = Class::<JsAsset>::from_js(&ctx, value)?;
      let js_asset = &mut *obj.borrow_mut();
      let asset = js_asset.take_owned().expect("Asset already taken");
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
    with_call_scope(|scope| {
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
        let js_dep = JsDependency {
          dep: scope.wrap(dep),
        };
        let opts = Object::new(ctx.clone())?;
        opts.set("dependency", js_dep)?;
        opts.set("specifier", specifier)?;
        opts.set("pipeline", pipeline)?;
        opts.set("config", self.config_to_js(ctx)?)?;

        let res: rquickjs::Value = resolve.call((opts,))?;
        let res = await_promise(ctx, res)?;
        if let Some(res) = res.as_object() {
          // TODO: Support the remaining Resolver API surface: options/logger/tracer/config and
          // loadConfig inputs, plus priority/meta/canDefer/diagnostics/invalidation result fields.
          let is_excluded: Option<bool> = res.get("isExcluded")?;
          if is_excluded == Some(true) {
            return Ok(DependencyResolution::Excluded);
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
                Arc::new(BufferContent::new_string(code))
              } else {
                Arc::new(FileContent::new(path, options.input_fs.clone()))
              },
              target: dep.target.clone(),
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
    })
  }
}

impl Namer for JsPlugin {
  fn name(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    options: &parcel_core::ParcelOptions,
  ) -> Result<Option<PathId>, parcel_core::DiagnosticList> {
    let bundle_index = bundle_graph
      .bundles
      .iter()
      .position(|candidate| std::ptr::eq(candidate, bundle))
      .expect("Bundle passed to namer must belong to the bundle graph");
    let name = with_call_scope(|scope| {
      let bundles = Arc::new(
        bundle_graph
          .bundles
          .iter()
          .map(|bundle| scope.wrap(bundle))
          .collect::<Vec<_>>(),
      );
      let assets = Arc::new(
        bundle_graph
          .asset_graph
          .assets
          .iter()
          .map(|asset| scope.wrap(asset))
          .collect::<Vec<_>>(),
      );

      with_js_env(options.input_fs.clone(), &options.env, options.cwd, |ctx| {
        let module = load_module(&ctx, &self.path)?;
        let symbol: Object = ctx.globals().get("Symbol")?;
        let symbol_for: Function = symbol.get("for")?;
        let sym: Symbol = symbol_for.call(("parcel-plugin-config",))?;
        let config: Object = module.get::<_, Object>(sym.clone()).or_else(|_| {
          module
            .get::<_, Object>("default")
            .and_then(|o| o.get::<_, Object>(sym))
        })?;
        let name: Function = config.get("name")?;
        let args = Object::new(ctx.clone())?;
        args.set(
          "bundle",
          JsBundle::new(bundle_index, bundles.clone(), assets.clone()),
        )?;
        args.set(
          "bundleGraph",
          JsBundleGraph::new(bundles.clone(), assets.clone()),
        )?;
        args.set("config", self.config_to_js(ctx)?)?;
        let result: rquickjs::Value = name.call((args,))?;
        let result = await_promise(&ctx, result)?;
        Option::<String>::from_js(&ctx, result)
      })
    })?;

    Ok(name.map(|name| bundle.target.dist_dir.join(Path::new(&name))))
  }
}

#[derive(JsLifetime)]
#[rquickjs::class]
struct JsBundle {
  index: usize,
  bundles: Arc<Vec<ScopedRef<Bundle>>>,
  assets: Arc<Vec<ScopedRef<Asset>>>,
}

impl<'js> Trace<'js> for JsBundle {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods(rename_all = "camelCase")]
impl JsBundle {
  #[qjs(get, rename = "type")]
  fn get_type(&self) -> rquickjs::Result<String> {
    self.bundles[self.index].with(|bundle| bundle.ty.extension().to_owned())
  }

  #[qjs(get)]
  fn needs_stable_name(&self) -> rquickjs::Result<bool> {
    self.bundles[self.index].with(|bundle| bundle.flags.contains(BundleFlags::NEEDS_STABLE_NAME))
  }

  #[qjs(get)]
  fn is_entry(&self) -> rquickjs::Result<bool> {
    self.bundles[self.index].with(|bundle| bundle.flags.contains(BundleFlags::ENTRY))
  }

  #[qjs(get)]
  fn bundle_behavior(&self) -> rquickjs::Result<Option<&str>> {
    self.bundles[self.index].with(|bundle| match bundle.bundle_behavior {
      BundleBehavior::None => None,
      BundleBehavior::Inline => Some("inline"),
      BundleBehavior::Isolated => Some("isolated"),
    })
  }

  #[qjs(get)]
  fn target(&self) -> rquickjs::Result<JsTarget> {
    self.bundles[self.index].with(|bundle| JsTarget {
      target: bundle.target.clone(),
    })
  }

  fn get_main_entry(&self) -> rquickjs::Result<Option<JsAsset>> {
    self.bundles[self.index].with(|bundle| {
      bundle
        .main_entry_asset
        .map(|index| self.assets[index.index()].clone())
        .map(JsAsset::borrowed)
    })
  }

  fn get_entry_assets(&self) -> rquickjs::Result<Vec<JsAsset>> {
    self.bundles[self.index].with(|bundle| {
      bundle
        .entry_assets
        .iter()
        .map(|index| self.assets[index.index()].clone())
        .map(JsAsset::borrowed)
        .collect()
    })
  }
}

impl JsBundle {
  fn new(
    index: usize,
    bundles: Arc<Vec<ScopedRef<Bundle>>>,
    assets: Arc<Vec<ScopedRef<Asset>>>,
  ) -> Self {
    Self {
      index,
      bundles,
      assets,
    }
  }
}

#[derive(JsLifetime)]
#[rquickjs::class]
struct JsBundleGraph {
  bundles: Arc<Vec<ScopedRef<Bundle>>>,
  assets: Arc<Vec<ScopedRef<Asset>>>,
}

impl<'js> Trace<'js> for JsBundleGraph {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods(rename_all = "camelCase")]
impl JsBundleGraph {
  fn get_bundles(&self) -> Vec<JsBundle> {
    self
      .bundles
      .iter()
      .enumerate()
      .map(|(index, _)| JsBundle::new(index, self.bundles.clone(), self.assets.clone()))
      .collect()
  }

  fn get_entry_bundles(&self) -> rquickjs::Result<Vec<JsBundle>> {
    let mut result = Vec::new();
    for (index, bundle) in self.bundles.iter().enumerate() {
      if bundle.with(|bundle| bundle.flags.contains(BundleFlags::ENTRY))? {
        result.push(JsBundle::new(
          index,
          self.bundles.clone(),
          self.assets.clone(),
        ));
      }
    }
    Ok(result)
  }

  fn get_referenced_bundles(
    &self,
    bundle: Class<'_, JsBundle>,
    options: rquickjs::function::Opt<Object<'_>>,
  ) -> rquickjs::Result<Vec<JsBundle>> {
    let bundle = bundle.borrow();
    if !Arc::ptr_eq(&self.bundles, &bundle.bundles) {
      return Err(rquickjs::Error::new_from_js_message(
        "Bundle",
        "Bundle",
        "Bundle belongs to a different BundleGraph",
      ));
    }
    let recursive = options
      .0
      .map(|options| options.get::<_, Option<bool>>("recursive"))
      .transpose()?
      .flatten()
      .unwrap_or(false);
    let mut indices =
      bundle.bundles[bundle.index].with(|bundle| bundle.referenced_bundles.clone())?;
    if recursive {
      let mut offset = 0;
      while offset < indices.len() {
        let index = indices[offset];
        let referenced_bundles =
          self.bundles[index].with(|bundle| bundle.referenced_bundles.clone())?;
        for referenced in &referenced_bundles {
          if !indices.contains(referenced) {
            indices.push(*referenced);
          }
        }
        offset += 1;
      }
    }
    Ok(
      indices
        .into_iter()
        .map(|index| JsBundle::new(index, self.bundles.clone(), self.assets.clone()))
        .collect(),
    )
  }
}

impl JsBundleGraph {
  fn new(bundles: Arc<Vec<ScopedRef<Bundle>>>, assets: Arc<Vec<ScopedRef<Asset>>>) -> Self {
    Self { bundles, assets }
  }
}

#[derive(JsLifetime)]
#[rquickjs::class]
struct JsAsset {
  asset: JsAssetValue,
}

#[derive(JsLifetime)]
enum JsAssetValue {
  Owned(Option<Asset>),
  Borrowed(ScopedRef<Asset>),
}

impl<'js> Trace<'js> for JsAsset {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

impl JsAsset {
  fn owned(asset: Asset) -> Self {
    Self {
      asset: JsAssetValue::Owned(Some(asset)),
    }
  }

  fn borrowed(asset: ScopedRef<Asset>) -> Self {
    Self {
      asset: JsAssetValue::Borrowed(asset),
    }
  }

  fn take_owned(&mut self) -> Option<Asset> {
    match &mut self.asset {
      JsAssetValue::Owned(asset) => asset.take(),
      JsAssetValue::Borrowed(_) => None,
    }
  }

  fn with_asset<R>(&self, f: impl for<'a> FnOnce(&'a Asset) -> R) -> rquickjs::Result<R> {
    match &self.asset {
      JsAssetValue::Owned(Some(asset)) => Ok(f(asset)),
      JsAssetValue::Owned(None) => Err(rquickjs::Error::new_from_js_message(
        "asset",
        "available asset",
        "Asset has already been consumed",
      )),
      JsAssetValue::Borrowed(asset) => asset.with(f),
    }
  }

  fn with_asset_mut<R>(&mut self, f: impl FnOnce(&mut Asset) -> R) -> rquickjs::Result<R> {
    match &mut self.asset {
      JsAssetValue::Owned(Some(asset)) => Ok(f(asset)),
      JsAssetValue::Owned(None) => Err(rquickjs::Error::new_from_js_message(
        "asset",
        "available asset",
        "Asset has already been consumed",
      )),
      JsAssetValue::Borrowed(_) => Err(rquickjs::Error::new_from_js_message(
        "read-only asset",
        "mutable asset",
        "Assets exposed to Namer plugins are read-only",
      )),
    }
  }
}

#[methods(rename_all = "camelCase")]
impl JsAsset {
  #[qjs(get)]
  fn url(&self) -> rquickjs::Result<String> {
    self.with_asset(|asset| asset.loc.url.to_string())
  }

  #[qjs(get, rename = "type")]
  fn get_type(&self) -> rquickjs::Result<String> {
    self.with_asset(|asset| asset.ty.extension().to_owned())
  }

  #[qjs(set, rename = "type")]
  fn set_type(&mut self, ty: String) -> rquickjs::Result<()> {
    self.with_asset_mut(|asset| asset.ty = AssetType::from_extension(&ty))
  }

  fn get_buffer<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<TypedArray<'js, u8>> {
    let src = self
      .with_asset(|asset| asset.content.read())?
      .map_err(|e| {
        rquickjs::Error::new_from_js_message("content", "readable content", e.to_string())
      })?;
    TypedArray::new(ctx, src)
  }

  fn get_code(&self) -> rquickjs::Result<String> {
    let src = self
      .with_asset(|asset| asset.content.read())?
      .map_err(|e| {
        rquickjs::Error::new_from_js_message("content", "readable content", e.to_string())
      })?;
    Ok(String::from_utf8_lossy(&src).into_owned())
  }

  fn set_buffer<'js>(&mut self, buf: TypedArray<'js, u8>) -> rquickjs::Result<()> {
    let bytes = buf
      .as_bytes()
      .ok_or_else(|| {
        rquickjs::Error::new_from_js_message(
          "buffer",
          "Uint8Array",
          "Invalid or detached Uint8Array",
        )
      })?
      .to_owned();
    self.with_asset_mut(|asset| asset.content = Arc::new(BufferContent::new(bytes)))
  }

  fn set_code(&mut self, value: String) -> rquickjs::Result<()> {
    self.with_asset_mut(|asset| asset.content = Arc::new(BufferContent::new_string(value)))
  }

  #[qjs(get)]
  fn target(&self) -> rquickjs::Result<JsTarget> {
    self.with_asset(|asset| JsTarget {
      target: asset.target.clone(),
    })
  }

  #[qjs(get)]
  fn is_source(&self) -> rquickjs::Result<bool> {
    self.with_asset(|asset| asset.flags.contains(AssetFlags::IS_SOURCE))
  }

  #[qjs(get)]
  fn side_effects(&self) -> rquickjs::Result<bool> {
    self.with_asset(|asset| asset.flags.contains(AssetFlags::SIDE_EFFECTS))
  }

  #[qjs(get, rename = "isBundleSplittable")]
  fn is_bundle_splittable(&self) -> rquickjs::Result<bool> {
    self.with_asset(|asset| asset.flags.contains(AssetFlags::IS_BUNDLE_SPLITTABLE))
  }

  #[qjs(set, rename = "isBundleSplittable")]
  fn set_is_bundle_splittable(&mut self, value: bool) -> rquickjs::Result<()> {
    self.with_asset_mut(|asset| {
      if value {
        asset.flags.insert(AssetFlags::IS_BUNDLE_SPLITTABLE);
      } else {
        asset.flags.remove(AssetFlags::IS_BUNDLE_SPLITTABLE);
      }
    })
  }

  #[qjs(get, rename = "bundleBehavior")]
  fn bundle_behavior(&self) -> rquickjs::Result<Option<String>> {
    self.with_asset(|asset| match asset.bundle_behavior {
      BundleBehavior::None => None,
      BundleBehavior::Inline => Some("inline".into()),
      BundleBehavior::Isolated => Some("isolated".into()),
    })
  }

  #[qjs(set, rename = "bundleBehavior")]
  fn set_bundle_behavior(&mut self, value: Option<String>) -> rquickjs::Result<()> {
    self.with_asset_mut(|asset| {
      asset.bundle_behavior = match value.as_deref() {
        None | Some("none") => BundleBehavior::None,
        Some("inline") => BundleBehavior::Inline,
        Some("isolated") => BundleBehavior::Isolated,
        _ => BundleBehavior::None,
      }
    })
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
  fn dist_dir(&self) -> String {
    self
      .target
      .dist_dir
      .with_path(|path| path.to_string_lossy().into_owned())
  }

  #[qjs(get)]
  fn public_url(&self) -> &str {
    &self.target.public_url
  }

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
  dep: ScopedRef<parcel_core::Dependency>,
}

impl<'js> Trace<'js> for JsDependency {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods(rename_all = "camelCase")]
impl JsDependency {
  #[qjs(get)]
  pub fn specifier(&self) -> rquickjs::Result<String> {
    self.dep.with(|dep| dep.specifier.to_string())
  }

  #[qjs(get)]
  pub fn specifier_type(&self) -> rquickjs::Result<&'static str> {
    self.dep.with(|dep| match dep.specifier_type {
      SpecifierType::Commonjs => "commonjs",
      SpecifierType::Esm => "esm",
      SpecifierType::Url => "url",
      SpecifierType::Custom => "custom",
    })
  }

  #[qjs(get)]
  pub fn priority(&self) -> rquickjs::Result<&'static str> {
    self.dep.with(|dep| match dep.priority {
      Priority::Sync => "sync",
      Priority::Parallel => "parallel",
      Priority::Lazy => "lazy",
    })
  }

  #[qjs(get)]
  pub fn bundle_behavior(&self) -> rquickjs::Result<Option<&'static str>> {
    self.dep.with(|dep| match dep.bundle_behavior {
      BundleBehavior::None => None,
      BundleBehavior::Inline => Some("inline"),
      BundleBehavior::Isolated => Some("isolated"),
    })
  }

  #[qjs(get)]
  pub fn is_entry(&self) -> rquickjs::Result<bool> {
    self
      .dep
      .with(|dep| dep.flags.contains(DependencyFlags::ENTRY))
  }

  #[qjs(get)]
  pub fn is_optional(&self) -> rquickjs::Result<bool> {
    self
      .dep
      .with(|dep| dep.flags.contains(DependencyFlags::OPTIONAL))
  }

  #[qjs(get)]
  pub fn needs_stable_name(&self) -> rquickjs::Result<bool> {
    self
      .dep
      .with(|dep| dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME))
  }

  #[qjs(get)]
  pub fn target(&self) -> rquickjs::Result<JsTarget> {
    self.dep.with(|dep| JsTarget {
      target: dep.target.clone(),
    })
  }

  #[qjs(get)]
  pub fn resolve_from(&self) -> rquickjs::Result<Option<String>> {
    self
      .dep
      .with(|dep| dep.resolve_from.as_ref().map(|value| value.to_string()))
  }

  #[qjs(get)]
  pub fn loc<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<Option<Object<'js>>> {
    self.dep.with(|dep| {
      let Some(loc) = &dep.loc else {
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
    })?
  }

  #[qjs(get)]
  pub fn package_conditions(&self) -> rquickjs::Result<Vec<&'static str>> {
    self.dep.with(|dep| {
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
      .filter_map(|(flag, name)| dep.conditions.contains(flag).then_some(name))
      .collect()
    })
  }

  #[qjs(get)]
  pub fn range(&self) -> rquickjs::Result<Option<String>> {
    self.dep.with(|dep| dep.range.clone())
  }
}

fn js_location<'js>(ctx: &Ctx<'js>, line: u32, column: u32) -> rquickjs::Result<Object<'js>> {
  let location = Object::new(ctx.clone())?;
  location.set("line", line)?;
  location.set("column", column)?;
  Ok(location)
}
