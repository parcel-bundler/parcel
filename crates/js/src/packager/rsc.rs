//! React Server Components support. This hooks into the packager at two points:
//! dependency resolution, where imports crossing the server/client boundary are
//! replaced with generated reference modules ([`resolve_dependency`]), and entry
//! emission, where server entry bundles get a setup module ([`server_entry`]).

use indexmap::IndexMap;
use parcel_core::*;

use super::{
  RUNTIME_REQUIRE, dependencies::is_async_bundle_dependency, runtime_name,
  synthetic::js_bundle_load_expression,
};
use crate::JsContent;

/// A packager-generated module implementing an RSC boundary or entry.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum RscModule {
  /// Resolves a "use client-entry" import to an empty module so the client
  /// entry does not run on the server.
  Empty { importer: u32, dependency: u32 },
  /// Replaces a server dependency on a client component with a client
  /// reference for each export.
  ClientReference {
    importer: u32,
    dependency: u32,
    runtime: u32,
    exports: Vec<(SymbolName, SymbolResolution)>,
    bundles: Vec<String>,
    css_resources: Vec<String>,
    is_async: bool,
  },
  /// Replaces a "use server" import with a client proxy module that will call
  /// the server (on the client), or wraps the original module to register its
  /// functions as server references (on the server).
  ServerReference {
    importer: u32,
    dependency: u32,
    runtime: u32,
    original: u32,
    exports: Vec<(SymbolName, SymbolResolution)>,
    is_client: bool,
    is_async: bool,
  },
  /// Handles bundle group boundaries to automatically inject resources like CSS.
  /// This is normally handled by the JS runtime, but the resources also need to be
  /// attached to the React tree so they get loaded during SSR as well.
  Resources {
    importer: u32,
    dependency: u32,
    runtime: u32,
    bundle: u32,
    plan: RscResourcePlan,
    is_async: bool,
  },
  /// Server entry setup: initializes AsyncLocalStorage and registers server actions.
  ServerEntry {
    entry: u32,
    runtime: u32,
    actions: Vec<RscServerAction>,
  },
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RscServerAction {
  asset_index: u32,
  bundles: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum RscResourceKind {
  Stylesheet,
  ModulePreload,
  ScriptPreload,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct RscResource {
  kind: RscResourceKind,
  url: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RscResourcePlan {
  original_asset: AssetIndex,
  resources: Vec<RscResource>,
  load_bundles: Vec<u32>,
  client_css: Vec<String>,
  client_entry: Option<AssetIndex>,
  bootstrap_modules: Vec<String>,
}

/// Determines whether a dependency crosses an RSC boundary, and if so, returns
/// the generated module that should replace its resolution.
pub(super) fn resolve_dependency(
  importer_index: AssetIndex,
  dependency_index: usize,
  importer: &Asset,
  dependency: &Dependency,
  resolved_index: u32,
  bundle_index: Option<u32>,
  bundle_graph: &BundleGraph,
) -> Result<Option<RscModule>, DiagnosticList> {
  if importer.target.flags.contains(EnvironmentFlags::IS_LIBRARY)
    || !matches!(
      importer.target.environment,
      Environment::ReactServer | Environment::ReactClient
    )
  {
    return Ok(None);
  }

  // URL and inline dependencies resolve to a URL string or embedded content,
  // so they must never be replaced with a synthetic RSC reference module.
  if dependency.specifier_type == SpecifierType::Url
    || dependency.bundle_behavior == BundleBehavior::Inline
    || bundle_index.is_some_and(|bundle_index| {
      bundle_graph.bundles[bundle_index as usize].bundle_behavior == BundleBehavior::Inline
    })
  {
    return Ok(None);
  }

  let resolved = &bundle_graph.asset_graph.assets[resolved_index as usize];
  let directives = resolved
    .content
    .downcast_ref::<JsContent>()
    .map(|content| content.directives.as_slice())
    .unwrap_or_default();

  if importer.target.environment == Environment::ReactServer
    && directives
      .iter()
      .any(|directive| directive == "use client-entry")
  {
    return Ok(Some(RscModule::Empty {
      importer: importer_index,
      dependency: dependency_index as u32,
    }));
  }

  if importer.target.environment == Environment::ReactServer
    && resolved.target.environment == Environment::ReactClient
    && directives.iter().any(|directive| directive == "use client")
  {
    // Find the bundle containing the importer so we can get the referenced bundles for the entire bundle group.
    // TODO: the importer might not actually be the bundle root (it might also be a shared bundle).
    let bundle_index = bundle_graph
      .bundles
      .iter()
      .position(|bundle| bundle.assets.contains(&importer_index))
      .map(|bundle_index| bundle_index as u32)
      .ok_or_else(|| {
        DiagnosticList::from(Diagnostic::from_message(
          "React client reference asset was not included in a bundle".into(),
        ))
      })?;
    let is_async = dependency.priority == Priority::Lazy;
    // If this is an async boundary, inject CSS. JS for client components is
    // injected by prepareDestinationForModule in React.
    let css_resources = if is_async {
      bundle_graph
        .referenced_bundles(bundle_index as usize)
        .filter_map(|bundle_index| {
          let bundle = &bundle_graph.bundles[bundle_index];
          (bundle.ty == AssetType::Css).then(|| bundle.absolute_url())
        })
        .collect()
    } else {
      Vec::new()
    };
    return Ok(Some(RscModule::ClientReference {
      importer: importer_index,
      dependency: dependency_index as u32,
      runtime: runtime_asset(importer_index, importer, bundle_graph)?,
      exports: bundle_graph
        .asset_graph
        .get_exports(resolved_index, importer.target.environment),
      bundles: client_bundle_names(bundle_graph, bundle_index),
      css_resources,
      is_async,
    }));
  }

  if directives.iter().any(|directive| directive == "use server") {
    let is_client = importer.target.environment == Environment::ReactClient;
    return Ok(Some(RscModule::ServerReference {
      importer: importer_index as u32,
      dependency: dependency_index as u32,
      runtime: runtime_asset(importer_index, importer, bundle_graph)?,
      original: resolved_index,
      exports: if is_client {
        // Only create server references for exports that were actually imported.
        let mut exports = bundle_graph
          .asset_graph
          .get_exports(resolved_index, importer.target.environment);
        exports.retain(|(_, resolution)| resolution.is_used(&bundle_graph.asset_graph));
        exports
      } else {
        Vec::new()
      },
      is_client,
      is_async: dependency.priority == Priority::Lazy,
    }));
  }

  if let Some(bundle_index) = bundle_index {
    let target_bundle = &bundle_graph.bundles[bundle_index as usize];
    let plan = resource_plan(importer, resolved_index, bundle_index, bundle_graph);
    let should_proxy = is_async_bundle_dependency(dependency, target_bundle)
      || !plan.resources.is_empty()
      || (dependency.priority != Priority::Lazy && plan.client_entry.is_some());
    if !should_proxy {
      return Ok(None);
    }

    return Ok(Some(RscModule::Resources {
      importer: importer_index as u32,
      dependency: dependency_index as u32,
      runtime: runtime_asset(importer_index, importer, bundle_graph)?,
      bundle: bundle_index,
      plan,
      is_async: dependency.priority == Priority::Lazy,
    }));
  }

  Ok(None)
}

/// Returns the setup module for a React server entry bundle, if this is one.
pub(super) fn server_entry(
  bundle: &Bundle,
  bundle_graph: &BundleGraph,
  project_root: &PathId,
) -> Result<Option<RscModule>, DiagnosticList> {
  if bundle.flags.contains(BundleFlags::ENTRY)
    && bundle.target.environment == Environment::ReactServer
    && let Some(entry) = bundle.main_entry_asset
  {
    let asset = &bundle_graph.asset_graph.assets[entry as usize];
    Ok(Some(RscModule::ServerEntry {
      entry: entry as u32,
      runtime: runtime_asset(entry, asset, bundle_graph)?,
      actions: server_actions(bundle_graph, project_root),
    }))
  } else {
    Ok(None)
  }
}

fn resource_plan(
  importer: &Asset,
  original_asset: u32,
  bundle_index: u32,
  bundle_graph: &BundleGraph,
) -> RscResourcePlan {
  let mut plan = RscResourcePlan {
    original_asset,
    resources: Vec::new(),
    load_bundles: Vec::new(),
    client_css: Vec::new(),
    client_entry: None,
    bootstrap_modules: Vec::new(),
  };

  for bundle_index in bundle_graph.referenced_bundles(bundle_index as usize) {
    let bundle = &bundle_graph.bundles[bundle_index];
    if bundle.ty == AssetType::Css {
      let url = bundle.absolute_url();
      plan.resources.push(RscResource {
        kind: RscResourceKind::Stylesheet,
        url: url.clone(),
      });
      if importer.target.environment == Environment::ReactClient {
        plan.client_css.push(url);
      }
    } else if bundle.ty == AssetType::Js {
      if bundle.target.environment == importer.target.environment {
        plan.load_bundles.push(bundle_index as u32);
      }
      if bundle.target.environment == Environment::ReactClient {
        let url = bundle.absolute_url();
        plan.bootstrap_modules.push(url.clone());
        if importer.target.environment == Environment::ReactClient {
          // Preload scripts for dynamic imports during SSR.
          // Can't use <script> because there might not be a prelude available yet.
          plan.resources.push(RscResource {
            kind: if bundle.target.output_format == OutputFormat::Esmodule {
              RscResourceKind::ModulePreload
            } else {
              RscResourceKind::ScriptPreload
            },
            url,
          });
        }

        // Find the client entry in this bundle group if any.
        if importer.target.environment == Environment::ReactServer && plan.client_entry.is_none() {
          plan.client_entry = bundle.assets.iter().find_map(|asset_index| {
            let asset = &bundle_graph.asset_graph.assets[*asset_index as usize];
            asset
              .content
              .downcast_ref::<JsContent>()
              .is_some_and(|content| {
                content
                  .directives
                  .iter()
                  .any(|directive| directive == "use client-entry")
              })
              .then_some(*asset_index as u32)
          });
        }
      }
    }
  }

  plan
}

/// Resolves the RSC runtime module injected by the transformer for this asset.
fn runtime_asset(
  importer_index: AssetIndex,
  importer: &Asset,
  bundle_graph: &BundleGraph,
) -> Result<u32, DiagnosticList> {
  let resolution = importer
    .content
    .downcast_ref::<JsContent>()
    .and_then(|content| content.rsc_runtime_dep)
    .map(|dependency_index| {
      bundle_graph.dependency_resolution(importer_index, dependency_index as usize)
    })
    .unwrap_or(BundleGraphDependencyResolution::None);

  match resolution {
    BundleGraphDependencyResolution::Asset(asset_index) => Ok(asset_index),
    BundleGraphDependencyResolution::Bundle(bundle_index) => bundle_graph.bundles
      [bundle_index as usize]
      .main_entry_asset
      .map(|asset_index| asset_index as u32)
      .ok_or_else(|| {
        Diagnostic::from_message("RSC support bundle does not have a main entry asset".into())
          .into()
      }),
    _ => Err(Diagnostic::from_message("Could not resolve RSC runtime asset".into()).into()),
  }
}

fn client_bundle_names(bundle_graph: &BundleGraph, bundle_index: u32) -> Vec<String> {
  bundle_graph
    .referenced_bundles(bundle_index as usize)
    .filter_map(|bundle_index| {
      let bundle = &bundle_graph.bundles[bundle_index];
      (bundle.ty == AssetType::Js && bundle.target.environment == Environment::ReactClient)
        .then(|| bundle.name())
    })
    .collect()
}

fn server_actions(bundle_graph: &BundleGraph, project_root: &PathId) -> Vec<RscServerAction> {
  let mut actions: IndexMap<String, RscServerAction> = IndexMap::new();
  for (asset_index, asset) in bundle_graph.asset_graph.assets.iter().enumerate() {
    let is_server_action = asset
      .content
      .downcast_ref::<JsContent>()
      .is_some_and(|content| {
        content
          .directives
          .iter()
          .any(|directive| directive == "use server")
      });
    if !is_server_action {
      continue;
    }

    let Some(bundle_index) = bundle_graph
      .bundles
      .iter()
      .position(|bundle| bundle.assets.contains(&(asset_index as u32)))
    else {
      continue;
    };
    let names = bundle_graph
      .referenced_bundles(bundle_index)
      .filter_map(|bundle_index| {
        let bundle = &bundle_graph.bundles[bundle_index];
        (bundle.ty == AssetType::Js && bundle.target.environment == Environment::ReactServer)
          .then(|| bundle.name())
      })
      .collect::<Vec<_>>();
    let id = asset.id(project_root);
    if let Some(action) = actions.get_mut(&id) {
      for name in names {
        if !action.bundles.contains(&name) {
          action.bundles.push(name);
        }
      }
    } else {
      actions.insert(
        id,
        RscServerAction {
          asset_index: asset_index as u32,
          bundles: names,
        },
      );
    }
  }
  actions.into_values().collect()
}

impl RscModule {
  pub fn id(&self) -> String {
    match self {
      RscModule::Empty {
        importer,
        dependency,
      } => format!("rsc_e_{}_{}", importer, dependency),
      RscModule::ClientReference {
        importer,
        dependency,
        ..
      } => format!("rsc_c_{}_{}", importer, dependency),
      RscModule::ServerReference {
        importer,
        dependency,
        is_client,
        ..
      } => format!(
        "rsc_s{}_{}_{}",
        if *is_client { "c" } else { "s" },
        importer,
        dependency
      ),
      RscModule::Resources {
        importer,
        dependency,
        ..
      } => format!("rsc_r_{}_{}", importer, dependency),
      RscModule::ServerEntry { entry, .. } => format!("rsc_entry_{}", entry),
    }
  }

  pub(super) fn write<W: std::fmt::Write>(
    &self,
    dest: &mut W,
    should_optimize: bool,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    project_root: &PathId,
  ) -> Result<(), DiagnosticList> {
    match self {
      RscModule::Empty { .. } => Ok(()),
      RscModule::ClientReference {
        runtime,
        exports,
        bundles,
        css_resources,
        is_async,
        ..
      } => write_client_reference(
        dest,
        should_optimize,
        bundle_graph,
        project_root,
        *runtime,
        exports,
        bundles,
        css_resources,
        *is_async,
      ),
      RscModule::ServerReference {
        runtime,
        original,
        exports,
        is_client,
        is_async,
        ..
      } => write_server_reference(
        dest,
        should_optimize,
        bundle_graph,
        project_root,
        *runtime,
        *original,
        exports,
        *is_client,
        *is_async,
      ),
      RscModule::Resources {
        importer,
        dependency,
        runtime,
        bundle: target_bundle,
        plan,
        is_async,
      } => write_resources(
        dest,
        should_optimize,
        bundle_graph,
        bundle,
        project_root,
        *importer,
        *dependency,
        *runtime,
        *target_bundle,
        plan,
        *is_async,
      ),
      RscModule::ServerEntry {
        runtime, actions, ..
      } => write_server_entry(
        dest,
        should_optimize,
        bundle_graph,
        project_root,
        *runtime,
        actions,
      ),
    }
  }
}

fn write_client_reference<W: std::fmt::Write>(
  dest: &mut W,
  should_optimize: bool,
  bundle_graph: &BundleGraph,
  project_root: &PathId,
  runtime: u32,
  exports: &[(SymbolName, SymbolResolution)],
  bundles: &[String],
  css_resources: &[String],
  is_async: bool,
) -> Result<(), DiagnosticList> {
  write_preamble(dest, should_optimize, bundle_graph, project_root, runtime)?;
  let bundles = serde_json::to_string(bundles)?;
  if !css_resources.is_empty() {
    write!(dest, "let $resources=[")?;
    for resource in css_resources {
      write!(
        dest,
        "$rsc.stylesheetResource({}),",
        serde_json::to_string(resource)?
      )?;
    }
    write!(dest, "];\n")?;
  }
  for (export_as, referenced_asset, export_name) in resolved_exports(exports, bundle_graph) {
    let export_as = serde_json::to_string(export_as.as_str())?;
    write!(dest, "exports[{}]=", export_as)?;
    if !css_resources.is_empty() {
      write!(dest, "$rsc.wrapClientReferenceWithResources(")?;
    }
    write!(
      dest,
      "$rsc.createClientReference({},{},{})",
      serde_json::to_string(&referenced_asset.id(project_root))?,
      serde_json::to_string(export_name.as_str())?,
      bundles,
    )?;
    if !css_resources.is_empty() {
      write!(dest, ",$resources)")?;
    }
    write!(dest, ";\n")?;
  }
  write!(dest, "exports.__esModule=true;\n")?;
  if is_async {
    write!(dest, "module.exports=Promise.resolve(exports);\n")?;
  }
  Ok(())
}

fn write_server_reference<W: std::fmt::Write>(
  dest: &mut W,
  should_optimize: bool,
  bundle_graph: &BundleGraph,
  project_root: &PathId,
  runtime: AssetIndex,
  original: AssetIndex,
  exports: &[(SymbolName, SymbolResolution)],
  is_client: bool,
  is_async: bool,
) -> Result<(), DiagnosticList> {
  let require = write_preamble(dest, should_optimize, bundle_graph, project_root, runtime)?;
  if is_client {
    // Dependency on a "use server" module from a client environment.
    // Create a client proxy module that will call the server.
    for (export_as, referenced_asset, export_name) in resolved_exports(exports, bundle_graph) {
      write!(
        dest,
        "exports[{}]=$rsc.createServerReference({},{});\n",
        serde_json::to_string(export_as.as_str())?,
        serde_json::to_string(&referenced_asset.id(project_root))?,
        serde_json::to_string(export_name.as_str())?,
      )?;
    }
  } else {
    // Dependency on a "use server" module from a server environment.
    // Mark each export as a server reference that can be passed to a client component as a prop.
    let original_asset = &bundle_graph.asset_graph.assets[original as usize];
    let original_id = serde_json::to_string(&original_asset.id(project_root))?;
    write!(dest, "let $original={}({});\n", require, original_id)?;
    write!(dest, "for(let key in $original){{\n")?;
    write!(
      dest,
      "Object.defineProperty(exports,key,{{enumerable:true,get:()=>{{\n"
    )?;
    write!(dest, "let value=$original[key];\n")?;
    write!(
      dest,
      "if(typeof value==='function'&&!value.$$typeof){{$rsc.registerServerReference(value,{},key);}}\n",
      original_id,
    )?;
    write!(dest, "return value;}}}});\n}}\n")?;
  }
  write!(dest, "exports.__esModule=true;\n")?;
  if is_async {
    write!(dest, "module.exports=Promise.resolve(exports);\n")?;
  }
  Ok(())
}

fn write_resources<W: std::fmt::Write>(
  dest: &mut W,
  should_optimize: bool,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  project_root: &PathId,
  importer: AssetIndex,
  dependency: u32,
  runtime: AssetIndex,
  target_bundle_index: u32,
  plan: &RscResourcePlan,
  is_async: bool,
) -> Result<(), DiagnosticList> {
  let importer_asset = &bundle_graph.asset_graph.assets[importer as usize];
  let dependency = &importer_asset.dependencies[dependency as usize];
  let target_bundle = &bundle_graph.bundles[target_bundle_index as usize];
  let original_asset = &bundle_graph.asset_graph.assets[plan.original_asset as usize];
  let original_id = serde_json::to_string(&original_asset.id(project_root))?;

  let require = write_preamble(dest, should_optimize, bundle_graph, project_root, runtime)?;

  write!(dest, "let $resources=[")?;
  for resource in &plan.resources {
    let helper = match resource.kind {
      RscResourceKind::Stylesheet => "stylesheetResource",
      RscResourceKind::ModulePreload => "modulePreloadResource",
      RscResourceKind::ScriptPreload => "scriptPreloadResource",
    };
    write!(
      dest,
      "$rsc.{}({}),",
      helper,
      serde_json::to_string(&resource.url)?
    )?;
  }
  write!(dest, "];\n")?;

  // A bootstrap script that loads the client entry, which will be injected into
  // the initial HTML. Only applies to sync bundle group boundaries, i.e. the page.
  let bootstrap_script = plan.client_entry.map(|client_entry| {
    let imports = plan
      .bootstrap_modules
      .iter()
      .map(|url| format!("import({})", serde_json::to_string(url).unwrap()))
      .collect::<Vec<_>>()
      .join(",");
    let entry = bundle_graph.asset_graph.assets[client_entry as usize].id(project_root);
    format!(
      "Promise.all([{}]).then(()=>parcelRequire({}))",
      imports,
      serde_json::to_string(&entry).unwrap()
    )
  });
  if let Some(bootstrap_script) = &bootstrap_script {
    write!(
      dest,
      "let $bootstrapScript={};\n",
      serde_json::to_string(bootstrap_script)?
    )?;
  }

  // Use a proxy to attach resources to all exports. This will be used by the JSX
  // runtime to automatically render CSS at bundle group boundaries.
  if is_async {
    let mut loads = Vec::new();
    let mut css = Vec::new();
    for bundle_index in &plan.load_bundles {
      let load_bundle = &bundle_graph.bundles[*bundle_index as usize];
      loads.push(js_bundle_load_expression(load_bundle, bundle, require));
    }
    for url in &plan.client_css {
      // Start preloading CSS via React.
      write!(
        dest,
        "$rsc.preinit({},{{as:'style',precedence:'default'}});\n",
        serde_json::to_string(url)?
      )?;
      // If the promise is not being loaded by React.lazy, wait for CSS to load.
      // Otherwise, React will suspend on the rendered <link> element in the resources.
      // This allows React to start rendering earlier if the CSS takes longer to load.
      if !dependency.flags.contains(DependencyFlags::REACT_LAZY) {
        css.push(format!("$rsc.waitForCSS({})", serde_json::to_string(url)?));
      }
    }
    write!(dest, "let $promise=Promise.all([{}])", loads.join(","))?;
    if !css.is_empty() {
      write!(dest, ".then(()=>Promise.all([{}]))", css.join(","))?;
    }
    write!(
      dest,
      ".then(()=>{{let $original={}({});return $rsc.createResourcesProxy($original,{},$resources",
      require,
      original_id,
      original_asset.flags.contains(AssetFlags::IS_ESM)
    )?;
    if bootstrap_script.is_some() {
      write!(dest, ",$bootstrapScript")?;
    }
    write!(dest, ");}});\nmodule.exports=$promise;\n")?;
  } else {
    let original = if target_bundle.target.output_format == OutputFormat::Commonjs {
      serde_json::to_string(&target_bundle.relative_specifier(bundle).unwrap())?
    } else {
      original_id
    };
    write!(
      dest,
      "let $original={}({});\nmodule.exports=$rsc.createResourcesProxy($original,{},$resources",
      require,
      original,
      original_asset.flags.contains(AssetFlags::IS_ESM)
    )?;
    if bootstrap_script.is_some() {
      write!(dest, ",$bootstrapScript")?;
    }
    write!(dest, ");\n")?;
  }
  Ok(())
}

fn write_server_entry<W: std::fmt::Write>(
  dest: &mut W,
  should_optimize: bool,
  bundle_graph: &BundleGraph,
  project_root: &PathId,
  runtime: AssetIndex,
  actions: &[RscServerAction],
) -> Result<(), DiagnosticList> {
  write_preamble(dest, should_optimize, bundle_graph, project_root, runtime)?;
  // React needs AsyncLocalStorage defined as a global for the edge environment.
  // Without this, preinit scripts won't be inserted during SSR.
  write!(dest, "$rsc.ensureAsyncLocalStorage();\n")?;
  // Register server actions in the server entry point.
  if !actions.is_empty() {
    write!(dest, "$rsc.registerServerActions({{")?;
    for action in actions {
      let asset = &bundle_graph.asset_graph.assets[action.asset_index as usize];
      write!(
        dest,
        "{}:{},",
        serde_json::to_string(&asset.id(project_root))?,
        serde_json::to_string(&action.bundles)?
      )?;
    }
    write!(dest, "}});\n")?;
  }
  Ok(())
}

/// Requires the RSC runtime module into `$rsc`, returning the require name.
fn write_preamble<W: std::fmt::Write>(
  dest: &mut W,
  should_optimize: bool,
  bundle_graph: &BundleGraph,
  project_root: &PathId,
  runtime: AssetIndex,
) -> Result<&'static str, DiagnosticList> {
  let require = runtime_name(should_optimize, "require", RUNTIME_REQUIRE);
  let runtime_asset = &bundle_graph.asset_graph.assets[runtime as usize];
  write!(
    dest,
    "let $rsc={}({});\n",
    require,
    serde_json::to_string(&runtime_asset.id(project_root))?
  )?;
  Ok(require)
}

fn resolved_exports<'a>(
  exports: &'a [(SymbolName, SymbolResolution)],
  bundle_graph: &'a BundleGraph,
) -> impl Iterator<Item = (&'a SymbolName, &'a Asset, SymbolName)> {
  exports.iter().filter_map(|(export_as, resolution)| {
    let asset_index = resolution.asset_index()?;
    let export_name = resolution.name(&bundle_graph.asset_graph)?;
    Some((
      export_as,
      &bundle_graph.asset_graph.assets[asset_index as usize],
      export_name,
    ))
  })
}
