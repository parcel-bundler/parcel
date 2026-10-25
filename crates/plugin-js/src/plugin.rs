use std::{
  cell::Cell,
  marker::PhantomData,
  path::Path,
  ptr::NonNull,
  rc::Rc,
  sync::{Arc, atomic::AtomicU8},
};

use parcel_core::{
  Asset, AssetFlags, AssetIndex, AssetRequest, AssetType, BufferContent, Bundle, BundleBehavior,
  BundleFlags, BundleGraph, BundleGraphDependencyResolution, Content, ContentWithSourceMap,
  DependencyFlags, DependencyResolution, Environment, EnvironmentFlags, ExportsCondition,
  FileContent, ImportType, LogMessage, Namer, Optimizer, OutputFormat, PathId, PluginContext,
  Priority, Reporter, ReporterEvent, Resolver, SourceLocation, SourceType, SourceUrl,
  SpecifierType, Target, Transformer,
};
use rquickjs::{
  Array, Class, Coerced, Ctx, FromJs, Function, IntoJs, JsLifetime, Object, Symbol, TypedArray,
  class::{self, Trace},
  methods,
};

use crate::{await_promise, cjs::CjsLoader, with_named_plugin_env, with_origin};

pub struct JsPlugin {
  path: String,
  /// The plugin's name in .parcelrc, which its diagnostics are attributed to.
  origin: String,
  config: Option<serde_json::Value>,
  reporter_methods: ReporterMethods,
}

pub struct ReporterMethods(AtomicU8);

impl ReporterMethods {
  const UNINITIALIZED: u8 = 1 << 0;
  const BUILD_START: u8 = 1 << 1;
  const BUILD_SUCCESS: u8 = 1 << 2;
  const BUILD_FAILURE: u8 = 1 << 3;
  const LOG: u8 = 1 << 4;

  pub fn new() -> Self {
    ReporterMethods(AtomicU8::new(ReporterMethods::UNINITIALIZED))
  }

  pub fn is_empty(&self) -> bool {
    self.0.load(std::sync::atomic::Ordering::Acquire) == 0
  }

  pub fn contains(&self, flag: u8) -> bool {
    (self.0.load(std::sync::atomic::Ordering::Acquire) & flag) != 0
  }

  pub fn set(&self, flags: u8) {
    self.0.store(flags, std::sync::atomic::Ordering::Release);
  }
}

impl ReporterMethods {
  /// The methods looked for, in the order they are reported to a plugin that
  /// exports none of them.
  const NAMES: [&'static str; 4] = ["buildStart", "buildSuccess", "buildFailure", "log"];
}

impl JsPlugin {
  pub fn new(path: PathId, origin: &str, config: Option<serde_json::Value>) -> JsPlugin {
    JsPlugin {
      path: path.with_path(|path| path.to_str().unwrap().to_owned()),
      origin: origin.to_owned(),
      config,
      reporter_methods: ReporterMethods::new(),
    }
  }

  fn with_env<F, R>(
    &self,
    options: &parcel_core::ParcelOptions,
    f: F,
  ) -> Result<R, parcel_core::DiagnosticList>
  where
    F: FnOnce(&Ctx) -> rquickjs::Result<R>,
  {
    with_named_plugin_env(options, Some(&self.origin), f)
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
      let graph = Rc::new(scope.wrap_graph(bundle_graph, options));

      self.with_env(options, |ctx| {
        let config = plugin_config(ctx, &self.path)?;
        let optimize: Function = config.get("optimize")?;
        let args = Object::new(ctx.clone())?;
        args.set("bundle", JsBundle::new(bundle_index, graph.clone()))?;
        args.set("bundleGraph", JsBundleGraph::new(graph.clone()))?;
        args.set("contents", TypedArray::new(ctx.clone(), contents)?)?;
        if let Some(source_map) = source_map {
          args.set("map", TypedArray::new(ctx.clone(), source_map)?)?;
        } else {
          args.set("map", rquickjs::Value::new_null(ctx.clone()))?;
        }
        args.set("config", self.config_to_js(ctx)?)?;
        args.set(
          "options",
          JsOptions {
            options: scope.wrap(options),
          },
        )?;

        let result: rquickjs::Value = optimize.call((args,))?;
        let result = await_promise(ctx, result)?;
        let result = result.into_object().ok_or_else(|| {
          rquickjs::Error::new_from_js_message("optimizer result", "object", "Expected an object")
        })?;
        let contents: TypedArray<u8> = result.get("contents")?;
        // SAFETY: copied immediately, before any JS runs.
        let contents = unsafe { contents.as_bytes() }
          .ok_or_else(|| {
            rquickjs::Error::new_from_js_message("contents", "Uint8Array", "Invalid Uint8Array")
          })?
          .to_vec();
        let map: rquickjs::Value = result.get("map")?;
        if map.is_null() || map.is_undefined() {
          Ok(Arc::new(BufferContent::new(contents)) as Arc<dyn Content>)
        } else {
          let map = TypedArray::<u8>::from_js(ctx, map)?;
          // SAFETY: copied immediately, before any JS runs.
          let map = unsafe { map.as_bytes() }
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

/// Loads the plugin and returns the object it registered under
/// `Symbol.for('parcel-plugin-config')` — the one holding `transform`,
/// `resolve`, `name`, `optimize` or `report` — from the module itself or from
/// its default export.
fn plugin_config<'js>(ctx: &Ctx<'js>, path: &str) -> rquickjs::Result<Object<'js>> {
  let module = load_module(ctx, path)?;
  let symbol: Object = ctx.globals().get("Symbol")?;
  let symbol_for: Function = symbol.get("for")?;
  let sym: Symbol = symbol_for.call(("parcel-plugin-config",))?;
  module.get::<_, Object>(sym.clone()).or_else(|_| {
    module
      .get::<_, Object>("default")
      .and_then(|o| o.get::<_, Object>(sym))
  })
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

impl<'scope> CallScope<'scope> {
  fn wrap_graph<'g>(
    &self,
    graph: &'scope BundleGraph<'g>,
    options: &'scope parcel_core::ParcelOptions,
  ) -> ScopedGraph {
    ScopedGraph {
      graph: ScopedRef {
        // The graph's lifetime is erased here, and restored as a higher-ranked lifetime by
        // ScopedGraph::with, so no reference into the graph can escape as 'static.
        ptr: NonNull::from(graph).cast::<BundleGraph<'static>>(),
        alive: self.alive.clone(),
      },
      options: self.wrap(options),
    }
  }
}

impl<'scope> CallScope<'scope> {
  fn wrap_context<'c>(&self, context: &'scope PluginContext<'c>) -> ScopedContext {
    ScopedContext(ScopedRef {
      // As with wrap_graph: the context's lifetime is erased here and restored as a higher-ranked
      // lifetime by ScopedContext::with.
      ptr: NonNull::from(context).cast::<PluginContext<'static>>(),
      alive: self.alive.clone(),
    })
  }
}

/// The context of the transform or resolve call a JS plugin is running in, for the `resolve`
/// function it is handed.
struct ScopedContext(ScopedRef<PluginContext<'static>>);

impl ScopedContext {
  fn with<R>(&self, f: impl for<'a, 'c> FnOnce(&'a PluginContext<'c>) -> R) -> rquickjs::Result<R> {
    self.0.with(|context| f(context))
  }
}

/// A bundle graph shared by the bundles, assets and dependencies exposed from one plugin call.
/// Values from the same graph share one `Rc`, which identifies the graph they belong to.
struct ScopedGraph {
  graph: ScopedRef<BundleGraph<'static>>,
  /// The options of the build the graph belongs to.
  options: ScopedRef<parcel_core::ParcelOptions>,
}

unsafe impl<'js> JsLifetime<'js> for ScopedGraph {
  type Changed<'to> = ScopedGraph;
}

impl ScopedGraph {
  fn with<R>(&self, f: impl for<'a, 'g> FnOnce(&'a BundleGraph<'g>) -> R) -> rquickjs::Result<R> {
    self.graph.with(|graph| f(graph))
  }
}

fn same_graph(
  a: &Rc<ScopedGraph>,
  b: &Rc<ScopedGraph>,
  what: &'static str,
) -> rquickjs::Result<()> {
  if Rc::ptr_eq(a, b) {
    Ok(())
  } else {
    Err(rquickjs::Error::new_from_js_message(
      what,
      what,
      format!("{what} belongs to a different BundleGraph"),
    ))
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
    context: &PluginContext,
  ) -> std::result::Result<Asset, parcel_core::DiagnosticList> {
    let options = context.options;
    with_call_scope(|scope| {
      let asset = self.with_env(options, |ctx| {
        let config = plugin_config(&ctx, &self.path)?;
        let transform: Function = config.get("transform")?;
        // Dependencies resolved through `resolve` are imported by this asset, for its target.
        let target = asset.target.clone();
        let asset = JsAsset::owned(asset);
        let value = asset.into_js(&ctx)?;
        let opts = Object::new(ctx.clone())?;
        opts.set("asset", value.clone())?;
        opts.set("config", self.config_to_js(ctx)?)?;
        opts.set(
          "options",
          JsOptions {
            options: scope.wrap(options),
          },
        )?;
        let context = scope.wrap_context(context);
        opts.set(
          "resolve",
          Function::new(ctx.clone(), move |ctx, from, specifier, options| {
            resolve(ctx, from, specifier, options, &context, &target)
          }),
        )?;
        let res: rquickjs::Value = transform.call((opts,))?;
        await_promise(ctx, res)?;
        let obj = Class::<JsAsset>::from_js(&ctx, value)?;
        let js_asset = &mut *obj.borrow_mut();
        let asset = js_asset.take_owned().expect("Asset already taken");
        Ok(asset)
      })?;

      Ok(asset)
    })
  }
}

/// The `resolve(from, specifier, options)` function handed to a JS transformer: resolves with the
/// configured resolver plugins, exactly as a dependency the transformer added would be.
fn resolve<'js>(
  ctx: Ctx<'js>,
  from: String,
  specifier: String,
  options: rquickjs::function::Opt<Object<'js>>,
  context: &ScopedContext,
  target: &Arc<Target>,
) -> rquickjs::Result<rquickjs::Promise<'js>> {
  let mut specifier_type = SpecifierType::Esm;
  let mut conditions = ExportsCondition::empty();
  let mut custom_conditions = Vec::new();
  if let Some(options) = options.0 {
    specifier_type = dependency_enum(&ctx, &options, "specifierType", SpecifierType::Esm)?;
    if let Ok(package_conditions) = options.get::<_, Array>("packageConditions") {
      for cond in package_conditions.iter() {
        let cond: String = cond?;
        if let Ok(cond) = ExportsCondition::try_from(cond.as_str()) {
          conditions |= cond;
        } else {
          custom_conditions.push(cond);
        }
      }
    }
  }

  let dep = parcel_core::Dependency {
    specifier: specifier.as_str().into(),
    specifier_type,
    priority: Priority::Sync,
    bundle_behavior: BundleBehavior::None,
    import_type: ImportType::JavaScript,
    flags: DependencyFlags::empty(),
    concurrent_group: 0,
    target: target.clone(),
    loc: None,
    placeholder: None,
    resolve_from: Some(SourceUrl::from_path(&PathId::new(Path::new(&from)))),
    range: None,
    conditions,
    custom_conditions: custom_conditions.into(),
    resolution: DependencyResolution::None,
  };

  let (promise, resolve, reject) = rquickjs::Promise::new(&ctx)?;
  match context.with(|context| context.resolve(&dep))? {
    Ok(DependencyResolution::Deferred(req)) if req.loc.url.to_file_path().is_ok() => {
      let path = req.loc.url.to_file_path().unwrap();
      let _: rquickjs::Value =
        resolve.call((path.to_path_buf().to_string_lossy().into_owned(),))?;
    }
    Ok(_) => {
      let _: rquickjs::Value = reject.call((rquickjs::Exception::from_message(
        ctx,
        &format!("Could not resolve '{specifier}' to a file"),
      )?,))?;
    }
    Err(diagnostics) => {
      let message = diagnostics
        .0
        .iter()
        .map(|d| d.message.as_str())
        .collect::<Vec<_>>()
        .join("\n");
      let _: rquickjs::Value = reject.call((rquickjs::Exception::from_message(ctx, &message)?,))?;
    }
  }
  Ok(promise)
}

impl Resolver for JsPlugin {
  fn resolve(
    &self,
    dep: &parcel_core::Dependency,
    specifier: &str,
    pipeline: Option<&str>,
    ctx: &parcel_core::PluginContext,
  ) -> Result<parcel_core::DependencyResolution, parcel_core::DiagnosticList> {
    let options = ctx.options;
    with_call_scope(|scope| {
      self.with_env(options, |ctx| {
        let config = plugin_config(&ctx, &self.path)?;
        let resolve: Function = config.get("resolve")?;
        let js_dep = JsDependency {
          dep: JsDependencyValue::Borrowed(scope.wrap(dep)),
        };
        let opts = Object::new(ctx.clone())?;
        opts.set("dependency", js_dep)?;
        opts.set("specifier", specifier)?;
        opts.set("pipeline", pipeline)?;
        opts.set("config", self.config_to_js(ctx)?)?;
        opts.set(
          "options",
          JsOptions {
            options: scope.wrap(options),
          },
        )?;

        let res: rquickjs::Value = resolve.call((opts,))?;
        let res = await_promise(ctx, res)?;
        if let Some(res) = res.as_object() {
          // TODO: Support diagnostics and invalidation result fields.
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
              unique_key: None,
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
      let graph = Rc::new(scope.wrap_graph(bundle_graph, options));

      self.with_env(options, |ctx| {
        let config = plugin_config(&ctx, &self.path)?;
        let name: Function = config.get("name")?;
        let args = Object::new(ctx.clone())?;
        args.set("bundle", JsBundle::new(bundle_index, graph.clone()))?;
        args.set("bundleGraph", JsBundleGraph::new(graph.clone()))?;
        args.set("config", self.config_to_js(ctx)?)?;
        args.set(
          "options",
          JsOptions {
            options: scope.wrap(options),
          },
        )?;
        let result: rquickjs::Value = name.call((args,))?;
        let result = await_promise(&ctx, result)?;
        Option::<String>::from_js(&ctx, result)
      })
    })?;

    Ok(name.map(|name| bundle.target.dist_dir.join(Path::new(&name))))
  }
}

impl JsPlugin {
  /// The reporter methods this plugin exports, resolved once and cached.
  fn reporter_methods(
    &self,
    options: &parcel_core::ParcelOptions,
  ) -> Result<&ReporterMethods, parcel_core::DiagnosticList> {
    if !self
      .reporter_methods
      .contains(ReporterMethods::UNINITIALIZED)
    {
      return Ok(&self.reporter_methods);
    }

    let methods = self.with_env(options, |ctx| {
      let config = plugin_config(ctx, &self.path)?;
      let exports = |name: &str| -> rquickjs::Result<bool> {
        Ok(
          config
            .get::<_, rquickjs::Value>(name)?
            .as_function()
            .is_some(),
        )
      };
      let mut flags: u8 = 0;
      if exports("buildStart")? {
        flags |= ReporterMethods::BUILD_START;
      }
      if exports("buildSuccess")? {
        flags |= ReporterMethods::BUILD_SUCCESS;
      }
      if exports("buildFailure")? {
        flags |= ReporterMethods::BUILD_FAILURE;
      }
      if exports("log")? {
        flags |= ReporterMethods::LOG;
      }
      Ok(flags)
    })?;

    self.reporter_methods.set(methods);

    if self.reporter_methods.is_empty() {
      // Reported once: the cached empty set makes every later event a no-op,
      // rather than repeating this for every event of every build.
      return Err(with_origin(
        parcel_core::Diagnostic::from_message(format!(
          "{} is configured as a reporter but exports none of {}",
          self.path,
          ReporterMethods::NAMES.join(", ")
        ))
        .into(),
        &self.origin,
      ));
    }

    Ok(&self.reporter_methods)
  }
}

impl Reporter for JsPlugin {
  fn report(
    &self,
    event: &ReporterEvent,
    options: &parcel_core::ParcelOptions,
  ) -> Result<(), parcel_core::DiagnosticList> {
    let methods = self.reporter_methods(options)?;

    // Checked before anything is marshalled: building a `buildSuccess` payload
    // means wrapping every bundle and asset in the graph, which is wasted on a
    // plugin that only implements `buildFailure`.
    let method = match event {
      ReporterEvent::BuildStart => methods
        .contains(ReporterMethods::BUILD_START)
        .then_some("buildStart"),
      ReporterEvent::BuildSuccess(_) => methods
        .contains(ReporterMethods::BUILD_SUCCESS)
        .then_some("buildSuccess"),
      ReporterEvent::BuildFailure { .. } => methods
        .contains(ReporterMethods::BUILD_FAILURE)
        .then_some("buildFailure"),
      ReporterEvent::Log(_) => methods.contains(ReporterMethods::LOG).then_some("log"),
      // An event added after this build of Parcel.
      _ => None,
    };
    let Some(method) = method else {
      return Ok(());
    };

    with_call_scope(|scope| {
      // Only a successful build carries a graph to expose.
      let graph = match event {
        ReporterEvent::BuildSuccess(success) => {
          Some(Rc::new(scope.wrap_graph(&success.bundle_graph, options)))
        }
        _ => None,
      };

      self.with_env(options, |ctx| {
        let args = Object::new(ctx.clone())?;
        args.set(
          "options",
          JsOptions {
            options: scope.wrap(options),
          },
        )?;
        match event {
          ReporterEvent::BuildStart => {}

          ReporterEvent::BuildSuccess(success) => {
            let graph = graph
              .as_ref()
              .expect("a buildSuccess event always wraps its graph");
            args.set("bundleGraph", JsBundleGraph::new(graph.clone()))?;
            args.set("buildTime", success.build_time.as_secs_f64() * 1000.0)?;
            args.set(
              "changedAssets",
              success
                .changed_assets
                .iter()
                .map(|&index| JsAsset::from_graph(graph.clone(), index))
                .collect::<Vec<_>>(),
            )?;
          }

          ReporterEvent::BuildFailure { diagnostics } => {
            args.set("diagnostics", diagnostics_to_js(ctx, &diagnostics.0)?)?;
          }

          ReporterEvent::Log(log) => {
            args.set("level", log.level.as_str())?;
            match log.message {
              LogMessage::Text(text) => args.set("message", text)?,
              LogMessage::Diagnostics(diagnostics) => {
                args.set("diagnostics", diagnostics_to_js(ctx, diagnostics)?)?
              }
            }
          }

          // Ruled out above, where the method for this event was resolved.
          _ => return Ok(()),
        }

        args.set("config", self.config_to_js(ctx)?)?;

        let config = plugin_config(ctx, &self.path)?;
        let report: Function = config.get(method)?;
        let result: rquickjs::Value = report.call((args,))?;
        await_promise(ctx, result)?;
        Ok(())
      })
    })
  }
}

/// Converts diagnostics to plain JavaScript objects, in the shape their
/// `serde` representation already defines.
fn diagnostics_to_js<'js>(
  ctx: &Ctx<'js>,
  diagnostics: &[parcel_core::Diagnostic],
) -> rquickjs::Result<rquickjs::Value<'js>> {
  let json = serde_json::to_string(diagnostics).map_err(|error| {
    rquickjs::Error::new_from_js_message("diagnostics", "JSON", error.to_string())
  })?;
  ctx.json_parse(json)
}

fn json_to_js<'js>(
  ctx: &Ctx<'js>,
  value: &impl serde::Serialize,
) -> rquickjs::Result<rquickjs::Value<'js>> {
  let json = serde_json::to_vec(value)
    .map_err(|error| rquickjs::Error::new_from_js_message("value", "JSON", error.to_string()))?;
  ctx.json_parse(json)
}

fn source_map_to_bytes<'js>(
  ctx: &Ctx<'js>,
  map: rquickjs::function::Opt<rquickjs::Value<'js>>,
) -> rquickjs::Result<Option<Vec<u8>>> {
  let Some(map) = map.0.filter(|map| !map.is_null() && !map.is_undefined()) else {
    return Ok(None);
  };
  if !map.is_object() || map.is_array() {
    return Err(rquickjs::Exception::throw_type(
      ctx,
      "Source map must be a JSON object",
    ));
  }
  let json = ctx
    .json_stringify(map)?
    .ok_or_else(|| rquickjs::Exception::throw_type(ctx, "Source map must be a JSON object"))?;
  Ok(Some(json.to_string()?.into_bytes()))
}

fn dependency_enum<'js, T: serde::de::DeserializeOwned>(
  ctx: &Ctx<'js>,
  options: &Object<'js>,
  name: &str,
  default: T,
) -> rquickjs::Result<T> {
  let Some(value) = options.get::<_, Option<String>>(name)? else {
    return Ok(default);
  };
  serde_json::from_value(serde_json::Value::String(value.clone()))
    .map_err(|_| rquickjs::Exception::throw_type(ctx, &format!("Invalid {name}: {value}")))
}

fn source_url(ctx: &Ctx<'_>, value: &str) -> rquickjs::Result<SourceUrl> {
  if Path::new(value).is_absolute() {
    Ok(SourceUrl::from_path(&PathId::new(Path::new(value))))
  } else {
    SourceUrl::parse(value).map_err(|error| rquickjs::Exception::throw_type(ctx, &error.message))
  }
}

fn dependency_from_js<'js>(
  ctx: &Ctx<'js>,
  options: &Object<'js>,
  asset: &Asset,
  url: bool,
) -> rquickjs::Result<parcel_core::Dependency> {
  let mut specifier: String = options.get("specifier")?;
  if let Some(pipeline) = options.get::<_, Option<String>>("pipeline")? {
    specifier = format!("{pipeline}:{specifier}");
  }
  let mut flags = DependencyFlags::empty();
  for (name, flag) in [
    ("isEntry", DependencyFlags::ENTRY),
    ("isOptional", DependencyFlags::OPTIONAL),
    ("needsStableName", DependencyFlags::NEEDS_STABLE_NAME),
    ("sideEffects", DependencyFlags::SIDE_EFFECTS),
  ] {
    flags.set(flag, options.get::<_, Option<bool>>(name)?.unwrap_or(false));
  }
  let target = match options.get::<_, Option<Class<JsTarget>>>("target")? {
    Some(target) => target.borrow().target.clone(),
    None => asset.target.clone(),
  };
  let mut conditions = ExportsCondition::empty();
  if let Some(values) = options.get::<_, Option<Vec<String>>>("packageConditions")? {
    for value in values {
      conditions |= ExportsCondition::try_from(value.as_str()).map_err(|_| {
        rquickjs::Exception::throw_type(ctx, &format!("Unsupported package condition: {value}"))
      })?;
    }
  }
  let loc = if let Some(loc) = options.get::<_, Option<Object>>("loc")? {
    let url = match loc
      .get::<_, Option<String>>("url")?
      .or(loc.get::<_, Option<String>>("filePath")?)
    {
      Some(url) => source_url(ctx, &url)?,
      None => asset.loc.url.clone(),
    };
    let location = |name| -> rquickjs::Result<parcel_core::Location> {
      let value: Object = loc.get(name)?;
      Ok(parcel_core::Location {
        line: value.get("line")?,
        column: value.get("column")?,
      })
    };
    Some(SourceLocation {
      url,
      start: location("start")?,
      end: location("end")?,
    })
  } else {
    None
  };
  let import_type = match options.get::<_, Option<String>>("importType")?.as_deref() {
    None if url => ImportType::Url,
    None | Some("javascript") => ImportType::JavaScript,
    Some("url") => ImportType::Url,
    Some("stylesheet") => ImportType::StyleSheet,
    Some("text") => ImportType::Text,
    Some("bytes") => ImportType::Bytes,
    Some(value) => {
      return Err(rquickjs::Exception::throw_type(
        ctx,
        &format!("Invalid importType: {value}"),
      ));
    }
  };
  let mut dep = parcel_core::Dependency {
    specifier: specifier.into_boxed_str(),
    specifier_type: dependency_enum(
      ctx,
      options,
      "specifierType",
      if url {
        SpecifierType::Url
      } else {
        SpecifierType::Esm
      },
    )?,
    priority: dependency_enum(
      ctx,
      options,
      "priority",
      if url { Priority::Lazy } else { Priority::Sync },
    )?,
    bundle_behavior: dependency_enum(ctx, options, "bundleBehavior", BundleBehavior::None)?,
    import_type,
    flags,
    concurrent_group: 0,
    custom_conditions: Default::default(),
    target,
    loc,
    placeholder: None,
    resolve_from: Some(match options.get::<_, Option<String>>("resolveFrom")? {
      Some(from) => source_url(ctx, &from)?,
      None => asset.loc.url.clone(),
    }),
    range: options.get::<_, Option<String>>("range")?.map(Into::into),
    conditions,
    resolution: DependencyResolution::None,
  };
  dep.set_placeholder();
  Ok(dep)
}

#[derive(JsLifetime)]
#[rquickjs::class]
struct JsBundle {
  index: usize,
  graph: Rc<ScopedGraph>,
}

impl<'js> Trace<'js> for JsBundle {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods(rename_all = "camelCase")]
impl JsBundle {
  #[qjs(get, rename = "type")]
  fn get_type(&self) -> rquickjs::Result<String> {
    self.with_bundle(|bundle| bundle.ty.extension().to_owned())
  }

  #[qjs(get)]
  fn needs_stable_name(&self) -> rquickjs::Result<bool> {
    self.with_bundle(|bundle| bundle.flags.contains(BundleFlags::NEEDS_STABLE_NAME))
  }

  /// The string a namer must include exactly once in the file name of a bundle that may be
  /// content hashed.
  #[qjs(get)]
  fn hash_reference(&self) -> rquickjs::Result<String> {
    self.with_bundle(|bundle| bundle.hash_reference())
  }

  #[qjs(get)]
  fn is_entry(&self) -> rquickjs::Result<bool> {
    self.with_bundle(|bundle| bundle.flags.contains(BundleFlags::ENTRY))
  }

  #[qjs(get)]
  fn bundle_behavior(&self) -> rquickjs::Result<Option<&str>> {
    self.with_bundle(|bundle| match bundle.bundle_behavior {
      BundleBehavior::None => None,
      BundleBehavior::Inline => Some("inline"),
      BundleBehavior::Isolated => Some("isolated"),
    })
  }

  #[qjs(get)]
  fn target(&self) -> rquickjs::Result<JsTarget> {
    self.with_bundle(|bundle| JsTarget {
      target: bundle.target.clone(),
    })
  }

  /// The path the bundle is written to, once it is known.
  #[qjs(get)]
  fn file_path<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<rquickjs::Value<'js>> {
    let path = self.graph.options.with(|options| {
      self.with_bundle(|bundle| {
        bundle
          .output_path(options)
          .map(|path| path.to_path_buf().to_string_lossy().into_owned())
      })
    })??;
    or_null(&ctx, path)
  }

  /// The bundle's name relative to its target's dist directory, once it can be read.
  #[qjs(get)]
  fn name<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<rquickjs::Value<'js>> {
    let name = self.with_bundle(|bundle| {
      // Until it is named, a bundle has no path to take a name from.
      (bundle.is_name_available() && (bundle.has_final_path() || bundle.dist_path.is_some()))
        .then(|| bundle.name())
    })?;
    or_null(&ctx, name)
  }

  fn get_main_entry(&self) -> rquickjs::Result<Option<JsAsset>> {
    self.with_bundle(|bundle| {
      bundle
        .main_entry_asset
        .map(|index| JsAsset::from_graph(self.graph.clone(), index))
    })
  }

  fn get_entry_assets(&self) -> rquickjs::Result<Vec<JsAsset>> {
    self.with_bundle(|bundle| {
      bundle
        .entry_assets
        .iter()
        .map(|&index| JsAsset::from_graph(self.graph.clone(), index))
        .collect()
    })
  }

  fn has_asset(&self, asset: Class<'_, JsAsset>) -> rquickjs::Result<bool> {
    let asset = asset.borrow();
    let JsAssetValue::Graph { graph, index } = &asset.asset else {
      return Err(rquickjs::Error::new_from_js_message(
        "Asset",
        "Asset",
        "Asset belongs to a different BundleGraph",
      ));
    };
    same_graph(&self.graph, graph, "Asset")?;
    self.with_bundle(|bundle| bundle.assets.contains(index))
  }
}

impl JsBundle {
  fn new(index: usize, graph: Rc<ScopedGraph>) -> Self {
    Self { index, graph }
  }

  fn with_bundle<R>(&self, f: impl for<'a> FnOnce(&'a Bundle) -> R) -> rquickjs::Result<R> {
    self.graph.with(|graph| f(&graph.bundles[self.index]))
  }
}

#[derive(JsLifetime)]
#[rquickjs::class]
struct JsBundleGraph {
  graph: Rc<ScopedGraph>,
}

impl<'js> Trace<'js> for JsBundleGraph {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods(rename_all = "camelCase")]
impl JsBundleGraph {
  fn get_bundles(&self) -> rquickjs::Result<Vec<JsBundle>> {
    let len = self.graph.with(|graph| graph.bundles.len())?;
    Ok(self.bundles(0..len))
  }

  fn get_entry_bundles(&self) -> rquickjs::Result<Vec<JsBundle>> {
    let indices = self.graph.with(|graph| {
      graph
        .bundles
        .iter()
        .enumerate()
        .filter(|(_, bundle)| bundle.flags.contains(BundleFlags::ENTRY))
        .map(|(index, _)| index)
        .collect::<Vec<_>>()
    })?;
    Ok(self.bundles(indices))
  }

  fn get_referenced_bundles(
    &self,
    bundle: Class<'_, JsBundle>,
    options: rquickjs::function::Opt<Object<'_>>,
  ) -> rquickjs::Result<Vec<JsBundle>> {
    let index = self.bundle_index(&bundle)?;
    let recursive = options
      .0
      .map(|options| options.get::<_, Option<bool>>("recursive"))
      .transpose()?
      .flatten()
      .unwrap_or(false);
    let indices = self.graph.with(|graph| {
      if recursive {
        // The closure starts with the bundle itself.
        graph.referenced_bundles(index).skip(1).collect()
      } else {
        graph.bundles[index].referenced_bundles.clone()
      }
    })?;
    Ok(self.bundles(indices))
  }

  /// Bundles that code in `bundle`'s execution context may load, not including `bundle`.
  fn get_bundles_in_bundle_group(
    &self,
    bundle: Class<'_, JsBundle>,
  ) -> rquickjs::Result<Vec<JsBundle>> {
    let index = self.bundle_index(&bundle)?;
    let indices = self
      .graph
      .with(|graph| graph.context_closure(&graph.bundles[index]).to_vec())?;
    Ok(self.bundles(indices))
  }

  /// Bundles that dependencies of `bundle`'s assets resolve to: lazy, isolated, inline and URL
  /// references.
  fn get_bundle_dependencies(
    &self,
    bundle: Class<'_, JsBundle>,
  ) -> rquickjs::Result<Vec<JsBundle>> {
    let index = self.bundle_index(&bundle)?;
    let indices = self.graph.with(|graph| {
      let mut indices = Vec::new();
      for target in graph.bundle_dependency_targets(&graph.bundles[index]) {
        if !indices.contains(&target) {
          indices.push(target);
        }
      }
      indices
    })?;
    Ok(self.bundles(indices))
  }

  /// The asset that `dependency` resolved to, if any.
  fn get_resolved_asset(
    &self,
    dependency: Class<'_, JsDependency>,
  ) -> rquickjs::Result<Option<JsAsset>> {
    let dependency = dependency.borrow();
    self.dependency_id(&dependency)?;
    let index = dependency.with_dependency(|dep| {
      self.graph.with(|graph| {
        graph
          .asset_graph
          .resolved_asset(dep)
          .map(|(index, _)| index)
      })
    })??;
    Ok(index.map(|index| JsAsset::from_graph(self.graph.clone(), index)))
  }

  /// The bundle that `dependency` references, if it resolves to a different bundle.
  fn get_referenced_bundle(
    &self,
    dependency: Class<'_, JsDependency>,
  ) -> rquickjs::Result<Option<JsBundle>> {
    let (asset, index) = self.dependency_id(&dependency.borrow())?;
    let resolution = self
      .graph
      .with(|graph| graph.dependency_resolution(asset, index))?;
    Ok(match resolution {
      BundleGraphDependencyResolution::Bundle { bundle_index, .. } => {
        Some(JsBundle::new(bundle_index as usize, self.graph.clone()))
      }
      _ => None,
    })
  }
}

impl JsBundleGraph {
  fn new(graph: Rc<ScopedGraph>) -> Self {
    Self { graph }
  }

  fn bundles(&self, indices: impl IntoIterator<Item = usize>) -> Vec<JsBundle> {
    indices
      .into_iter()
      .map(|index| JsBundle::new(index, self.graph.clone()))
      .collect()
  }

  fn bundle_index(&self, bundle: &Class<'_, JsBundle>) -> rquickjs::Result<usize> {
    let bundle = bundle.borrow();
    same_graph(&self.graph, &bundle.graph, "Bundle")?;
    Ok(bundle.index)
  }

  fn dependency_id(&self, dependency: &JsDependency) -> rquickjs::Result<(AssetIndex, usize)> {
    match &dependency.dep {
      JsDependencyValue::Graph {
        graph,
        asset,
        index,
      } => {
        same_graph(&self.graph, graph, "Dependency")?;
        Ok((*asset, *index))
      }
      _ => Err(rquickjs::Error::new_from_js_message(
        "Dependency",
        "Dependency",
        "Dependency belongs to a different BundleGraph",
      )),
    }
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
  Graph {
    graph: Rc<ScopedGraph>,
    index: AssetIndex,
  },
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

  fn from_graph(graph: Rc<ScopedGraph>, index: AssetIndex) -> Self {
    Self {
      asset: JsAssetValue::Graph { graph, index },
    }
  }

  fn take_owned(&mut self) -> Option<Asset> {
    match &mut self.asset {
      JsAssetValue::Owned(asset) => asset.take(),
      JsAssetValue::Graph { .. } => None,
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
      JsAssetValue::Graph { graph, index } => {
        graph.with(|graph| f(&graph.asset_graph.assets[index.index()]))
      }
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
      JsAssetValue::Graph { .. } => Err(rquickjs::Error::new_from_js_message(
        "read-only asset",
        "mutable asset",
        "Assets in a bundle graph are read-only",
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

  #[qjs(get)]
  fn file_path(&self) -> rquickjs::Result<String> {
    self.with_asset(|asset| {
      asset
        .loc
        .url
        .to_file_path()
        .unwrap()
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
    })
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

  fn get_map<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<rquickjs::Value<'js>> {
    let map = self.with_asset(|asset| {
      asset
        .content
        .downcast_ref::<ContentWithSourceMap>()
        .map(|content| content.source_map().to_vec())
    })?;
    match map {
      Some(map) => ctx.json_parse(map),
      None => Ok(rquickjs::Value::new_null(ctx)),
    }
  }

  fn set_buffer<'js>(
    &mut self,
    ctx: Ctx<'js>,
    buf: TypedArray<'js, u8>,
    map: rquickjs::function::Opt<rquickjs::Value<'js>>,
  ) -> rquickjs::Result<()> {
    // SAFETY: copied immediately, before any JS runs.
    let bytes = unsafe { buf.as_bytes() }
      .ok_or_else(|| {
        rquickjs::Error::new_from_js_message(
          "buffer",
          "Uint8Array",
          "Invalid or detached Uint8Array",
        )
      })?
      .to_owned();
    let map = source_map_to_bytes(&ctx, map)?;
    self.with_asset_mut(|asset| {
      asset.content = match map {
        Some(map) => Arc::new(ContentWithSourceMap::new(bytes, map)),
        None => Arc::new(BufferContent::new(bytes)),
      };
    })
  }

  fn set_code<'js>(
    &mut self,
    ctx: Ctx<'js>,
    value: String,
    map: rquickjs::function::Opt<rquickjs::Value<'js>>,
  ) -> rquickjs::Result<()> {
    let map = source_map_to_bytes(&ctx, map)?;
    self.with_asset_mut(|asset| {
      asset.content = match map {
        Some(map) => Arc::new(ContentWithSourceMap::new_string(value, map)),
        None => Arc::new(BufferContent::new_string(value)),
      };
    })
  }

  fn get_dependencies(&self) -> rquickjs::Result<Vec<JsDependency>> {
    if let JsAssetValue::Graph { graph, index } = &self.asset {
      let len = self.with_asset(|asset| asset.dependencies.len())?;
      return Ok(
        (0..len)
          .map(|dependency| JsDependency {
            dep: JsDependencyValue::Graph {
              graph: graph.clone(),
              asset: *index,
              index: dependency,
            },
          })
          .collect(),
      );
    }

    // Snapshots cannot be invalidated by a later addDependency reallocating the vector.
    self.with_asset(|asset| {
      asset
        .dependencies
        .iter()
        .cloned()
        .map(|dep| JsDependency {
          dep: JsDependencyValue::Owned(Arc::new(dep)),
        })
        .collect()
    })
  }

  /// Returns a placeholder that can be embedded in transformed content.
  fn add_dependency<'js>(
    &mut self,
    ctx: Ctx<'js>,
    options: Object<'js>,
  ) -> rquickjs::Result<String> {
    let dep = self.with_asset(|asset| dependency_from_js(&ctx, &options, asset, false))??;
    self.with_asset_mut(|asset| {
      let placeholder = dep.placeholder.as_ref().unwrap().to_string();
      asset.dependencies.push(dep);
      placeholder
    })
  }

  #[qjs(rename = "addURLDependency")]
  fn add_url_dependency<'js>(
    &mut self,
    ctx: Ctx<'js>,
    url: String,
    options: rquickjs::function::Opt<Object<'js>>,
  ) -> rquickjs::Result<String> {
    // Copy the options so frozen objects and caller-owned objects are left intact.
    let opts = Object::new(ctx.clone())?;
    if let Some(options) = options.0 {
      for property in options.props::<String, rquickjs::Value>() {
        let (key, value) = property?;
        opts.set(key, value)?;
      }
    }
    opts.set("specifier", url)?;
    let dep = self.with_asset(|asset| dependency_from_js(&ctx, &opts, asset, true))??;
    self.with_asset_mut(|asset| {
      let placeholder = dep.placeholder.as_ref().unwrap().to_string();
      asset.dependencies.push(dep);
      placeholder
    })
  }

  #[qjs(get)]
  fn unique_key(&self) -> rquickjs::Result<Option<String>> {
    self.with_asset(|asset| asset.unique_key.as_ref().map(|key| key.to_string()))
  }

  #[qjs(set, rename = "uniqueKey")]
  fn set_unique_key(&mut self, value: Option<String>) -> rquickjs::Result<()> {
    self.with_asset_mut(|asset| {
      if asset.unique_key.is_some() {
        return Err(rquickjs::Error::new_from_js_message(
          "uniqueKey",
          "unset uniqueKey",
          "Cannot change an asset's uniqueKey after it has been set",
        ));
      }
      asset.unique_key = value.map(Into::into);
      Ok(())
    })?
  }

  #[qjs(get)]
  fn pipeline(&self) -> rquickjs::Result<Option<String>> {
    self.with_asset(|asset| asset.pipeline.as_ref().map(|pipeline| pipeline.to_string()))
  }

  #[qjs(set, rename = "pipeline")]
  fn set_pipeline(&mut self, value: Option<String>) -> rquickjs::Result<()> {
    self.with_asset_mut(|asset| asset.pipeline = value.map(Into::into))
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

  #[qjs(set, rename = "sideEffects")]
  fn set_side_effects(&mut self, value: bool) -> rquickjs::Result<()> {
    self.with_asset_mut(|asset| asset.flags.set(AssetFlags::SIDE_EFFECTS, value))
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
  fn engines<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<rquickjs::Value<'js>> {
    json_to_js(&ctx, &self.target.engines)
  }

  #[qjs(get)]
  fn include_node_modules<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<rquickjs::Value<'js>> {
    json_to_js(&ctx, &self.target.include_node_modules)
  }

  #[qjs(get)]
  fn source_map<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<rquickjs::Value<'js>> {
    json_to_js(&ctx, &self.target.source_map)
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

  fn is_worklet(&self) -> bool {
    self.target.environment.is_worklet()
  }

  fn is_server(&self) -> bool {
    self.target.environment.is_server()
  }
}

#[derive(JsLifetime)]
#[rquickjs::class]
pub struct JsDependency {
  dep: JsDependencyValue,
}

#[derive(JsLifetime)]
enum JsDependencyValue {
  Borrowed(ScopedRef<parcel_core::Dependency>),
  Owned(Arc<parcel_core::Dependency>),
  /// A dependency of an asset in a bundle graph.
  Graph {
    graph: Rc<ScopedGraph>,
    asset: AssetIndex,
    index: usize,
  },
}

impl JsDependency {
  fn with_dependency<R>(
    &self,
    f: impl for<'a> FnOnce(&'a parcel_core::Dependency) -> R,
  ) -> rquickjs::Result<R> {
    match &self.dep {
      JsDependencyValue::Borrowed(dep) => dep.with(f),
      JsDependencyValue::Owned(dep) => Ok(f(dep)),
      JsDependencyValue::Graph {
        graph,
        asset,
        index,
      } => graph.with(|graph| f(&graph.asset_graph.assets[asset.index()].dependencies[*index])),
    }
  }
}

impl<'js> Trace<'js> for JsDependency {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods(rename_all = "camelCase")]
impl JsDependency {
  #[qjs(get)]
  pub fn placeholder(&self) -> rquickjs::Result<Option<String>> {
    self.with_dependency(|dep| {
      dep
        .placeholder
        .as_ref()
        .map(|placeholder| placeholder.to_string())
    })
  }

  #[qjs(get)]
  pub fn import_type(&self) -> rquickjs::Result<&'static str> {
    self.with_dependency(|dep| match dep.import_type {
      ImportType::JavaScript => "javascript",
      ImportType::StyleSheet => "stylesheet",
      ImportType::Url => "url",
      ImportType::Text => "text",
      ImportType::Bytes => "bytes",
    })
  }

  #[qjs(get)]
  pub fn specifier(&self) -> rquickjs::Result<String> {
    self.with_dependency(|dep| dep.specifier.to_string())
  }

  #[qjs(get)]
  pub fn specifier_type(&self) -> rquickjs::Result<&'static str> {
    self.with_dependency(|dep| match dep.specifier_type {
      SpecifierType::Commonjs => "commonjs",
      SpecifierType::Esm => "esm",
      SpecifierType::Url => "url",
      SpecifierType::Custom => "custom",
    })
  }

  #[qjs(get)]
  pub fn priority(&self) -> rquickjs::Result<&'static str> {
    self.with_dependency(|dep| match dep.priority {
      Priority::Sync => "sync",
      Priority::Parallel => "parallel",
      Priority::Lazy => "lazy",
    })
  }

  #[qjs(get)]
  pub fn bundle_behavior(&self) -> rquickjs::Result<Option<&'static str>> {
    self.with_dependency(|dep| match dep.bundle_behavior {
      BundleBehavior::None => None,
      BundleBehavior::Inline => Some("inline"),
      BundleBehavior::Isolated => Some("isolated"),
    })
  }

  #[qjs(get)]
  pub fn is_entry(&self) -> rquickjs::Result<bool> {
    self.with_dependency(|dep| dep.flags.contains(DependencyFlags::ENTRY))
  }

  #[qjs(get)]
  pub fn is_optional(&self) -> rquickjs::Result<bool> {
    self.with_dependency(|dep| dep.flags.contains(DependencyFlags::OPTIONAL))
  }

  #[qjs(get)]
  pub fn needs_stable_name(&self) -> rquickjs::Result<bool> {
    self.with_dependency(|dep| dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME))
  }

  #[qjs(get)]
  pub fn side_effects(&self) -> rquickjs::Result<bool> {
    self.with_dependency(|dep| dep.flags.contains(DependencyFlags::SIDE_EFFECTS))
  }

  #[qjs(get)]
  pub fn target(&self) -> rquickjs::Result<JsTarget> {
    self.with_dependency(|dep| JsTarget {
      target: dep.target.clone(),
    })
  }

  #[qjs(get)]
  pub fn resolve_from(&self) -> rquickjs::Result<Option<String>> {
    self.with_dependency(|dep| dep.resolve_from.as_ref().map(|value| value.to_string()))
  }

  #[qjs(get)]
  pub fn loc<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<Option<Object<'js>>> {
    self.with_dependency(|dep| {
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
    self.with_dependency(|dep| {
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
    self.with_dependency(|dep| dep.range.as_ref().map(|r| (**r).to_string()))
  }
}

#[derive(JsLifetime)]
#[rquickjs::class]
pub struct JsOptions {
  options: ScopedRef<parcel_core::ParcelOptions>,
}

impl<'js> Trace<'js> for JsOptions {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods(rename_all = "camelCase")]
impl JsOptions {
  #[qjs(get)]
  pub fn mode(&self) -> rquickjs::Result<String> {
    self.options.with(|options| match &options.mode {
      parcel_core::BuildMode::Development => "development".into(),
      parcel_core::BuildMode::Production => "production".into(),
      parcel_core::BuildMode::Other(mode) => mode.clone(),
    })
  }

  #[qjs(get)]
  pub fn env<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<rquickjs::Value<'js>> {
    self
      .options
      .with(|options| json_to_js(&ctx, &options.env))?
  }

  #[qjs(get)]
  pub fn log_level(&self) -> rquickjs::Result<&'static str> {
    self.options.with(|options| options.log_level.as_str())
  }

  #[qjs(get)]
  pub fn hmr_options<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<Option<Object<'js>>> {
    self.options.with(|options| {
      let Some(hmr) = &options.hmr else {
        return Ok(None);
      };
      let result = Object::new(ctx)?;
      result.set("host", hmr.host.as_ref())?;
      result.set("port", hmr.port)?;
      Ok(Some(result))
    })?
  }

  #[qjs(get)]
  pub fn project_root(&self) -> rquickjs::Result<String> {
    self.options.with(|options| {
      options
        .project_root
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
    })
  }
}

fn or_null<'js>(ctx: &Ctx<'js>, value: Option<String>) -> rquickjs::Result<rquickjs::Value<'js>> {
  match value {
    Some(value) => value.into_js(ctx),
    None => Ok(rquickjs::Value::new_null(ctx.clone())),
  }
}

fn js_location<'js>(ctx: &Ctx<'js>, line: u32, column: u32) -> rquickjs::Result<Object<'js>> {
  let location = Object::new(ctx.clone())?;
  location.set("line", line)?;
  location.set("column", column)?;
  Ok(location)
}
