use std::{
  collections::{HashMap, HashSet},
  sync::Arc,
};

use arena::{NodeData, SerializableHandle, Sink};
use dependencies::collect_dependencies;
use html5ever::tendril::{StrTendril, TendrilSink};
use html5ever::{expanded_name, local_name, namespace_url, ns};
use jsx::{JsxOptions, to_component};
use optimize::optimize;
use oxvg::{ConfigItem, OxvgConfig, SvgUsage};
use package::insert_bundle_references;
use parcel_core::*;
use serde::{Deserialize, Serialize, Serializer};
use swc_core::ecma::codegen::to_code;
use typed_arena::Arena;

pub use markdown::MarkdownTransformer;
pub use package::{BundleReference, InlineBundle};
pub use xml::{XmlTransformer, transform_xml};

mod arena;
mod dependencies;
mod head;
mod jsx;
mod markdown;
mod optimize;
mod oxvg;
mod package;
mod serialize_html;
mod serialize_xml;
mod srcset;
mod xml;

#[derive(Hash, PartialEq, Eq, PartialOrd, Ord, Default, Clone)]
pub struct SerializableTendril(pub StrTendril);

impl serde::Serialize for SerializableTendril {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: Serializer,
  {
    serializer.serialize_str(self.0.as_ref())
  }
}

impl<'de> serde::Deserialize<'de> for SerializableTendril {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let s: String = Deserialize::deserialize(deserializer)?;
    Ok(SerializableTendril(s.into()))
  }
}

pub struct TransformOptions<'a> {
  pub code: Vec<u8>,
  pub url: SourceUrl,
  pub xml: bool,
  pub target: Arc<Target>,
  pub hmr: bool,
  pub options: &'a ParcelOptions,
  /// Custom elements that call macros, as if declared with `<parcel:define name src>`: the
  /// element name, and the macro's URL relative to the document.
  pub macro_imports: Vec<(String, String)>,
}

#[derive(Serialize)]
pub struct TransformResult {
  pub dependencies: Vec<Dependency>,
  /// Symbols imported through `dependencies`, indexed from the first, and exported by SVG
  /// documents.
  pub symbols: AssetSymbols,
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub assets: Vec<Asset>,
  pub errors: Vec<Diagnostic>,
}

pub fn transform_html(options: TransformOptions) -> TransformResult {
  let arena = Arena::new();
  let dom = if options.xml {
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  } else {
    html5ever::driver::parse_document(Sink::new(&arena), html5ever::ParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  };

  let (deps, imports, assets, mut errors) = collect_dependencies(
    &arena,
    &dom,
    options.url.clone(),
    AssetType::Html,
    options.target,
    options.hmr,
    options.options,
    &options.macro_imports,
  );

  let mut vec = Vec::new();
  let res = if options.xml {
    serialize_xml::serialize(&mut vec, dom)
  } else {
    let handle: SerializableHandle = dom.into();
    html5ever::serialize::serialize(
      &mut vec,
      &handle,
      html5ever::serialize::SerializeOpts::default(),
    )
  };
  if let Err(err) = res {
    errors.push(err.into());
  }

  TransformResult {
    code: vec,
    dependencies: deps,
    symbols: AssetSymbols {
      imports,
      ..Default::default()
    },
    assets,
    errors,
  }
}

pub fn transform_svg(options: TransformOptions) -> TransformResult {
  let arena = Arena::new();
  let dom =
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice());
  // Before dependencies are collected, which replaces `url(#id)` references with placeholders.
  let (exports, local_references) = svg_exports(dom);
  let (deps, imports, assets, mut errors) = collect_dependencies(
    &arena,
    &dom,
    options.url.clone(),
    AssetType::Svg,
    options.target,
    options.hmr,
    options.options,
    &[],
  );

  let mut vec = Vec::new();
  if let Err(err) = serialize_xml::serialize(&mut vec, dom) {
    errors.push(err.into());
  }

  TransformResult {
    code: vec,
    dependencies: deps,
    symbols: AssetSymbols {
      imports,
      exports,
      local_references,
      ..Default::default()
    },
    assets,
    errors,
  }
}

/// The symbols an SVG document exports: the rendered document, and each element by id for
/// references like `sprite.svg#icon`, with the elements each element uses. Scripts may reference
/// or create elements dynamically, so a document with scripts exports nothing, which keeps all of it.
fn svg_exports<'arena>(dom: arena::Ref<'arena>) -> (Vec<LocalSymbol>, Vec<LocalReference>) {
  #[derive(Default)]
  struct Walk {
    /// Each id's export, after the document's at index 0. Like a fragment URL, an id refers to
    /// the first element with it.
    ids: HashMap<String, u32>,
    /// Between exports. Keeping an element keeps its subtree, so it references the elements with
    /// ids nearest below it, and what is referenced in between.
    references: Vec<LocalReference>,
    /// To ids, which may be of elements later in the document.
    id_references: Vec<(u32, String)>,
    has_script: bool,
  }

  fn walk<'arena>(node: arena::Ref<'arena>, mut owner: Option<u32>, state: &mut Walk) {
    if let NodeData::Element { name, attrs, .. } = &node.data {
      state.has_script |= name.expanded() == expanded_name!(svg "script");
      let attrs = attrs.borrow();
      if let Some(id) = attrs.iter().find_map(|attr| {
        (attr.name.expanded() == expanded_name!("", "id") && !attr.value.is_empty())
          .then_some(&attr.value)
      }) && !state.ids.contains_key(id.as_ref())
      {
        let index = state.ids.len() as u32 + 1;
        state.ids.insert(id.to_string(), index);
        if let Some(from) = owner {
          state.references.push(LocalReference { from, to: index });
        }
        owner = Some(index);
      }
      // Only what elements with ids reference matters.
      if let Some(from) = owner {
        oxvg::attribute_references(name, &attrs, |id| state.id_references.push((from, id)));
      }
    }
    let mut child = node.first_child.get();
    while let Some(node) = child {
      walk(node, owner, state);
      child = node.next_sibling.get();
    }
  }

  let mut state = Walk::default();
  walk(dom, None, &mut state);
  if state.has_script {
    return (Vec::new(), Vec::new());
  }

  let Walk {
    ids,
    mut references,
    id_references,
    ..
  } = state;
  for (from, id) in id_references {
    if let Some(&to) = ids.get(id.as_str())
      && to != from
    {
      references.push(LocalReference { from, to });
    }
  }
  references.sort_unstable_by_key(|reference| (reference.from, reference.to));
  references.dedup();

  let mut names = vec![SymbolName::Document; ids.len() + 1];
  for (id, index) in ids {
    names[index as usize] = SymbolName::Name(id.into());
  }
  let exports = names
    .into_iter()
    .map(|exported| LocalSymbol {
      exported,
      requested: false,
      self_referenced: false,
    })
    .collect();
  (exports, references)
}

/// What the files referencing an SVG document use of it, from the symbols they request. An
/// entry is referenced from outside the build, so it keeps all of its elements.
fn svg_usage(asset_graph: &AssetGraph, asset_index: AssetIndex) -> SvgUsage {
  let asset = asset_graph.asset(asset_index);
  let is_entry = asset_graph
    .entries
    .iter()
    .any(|entry| asset_graph.resolved_entry(entry) == Some(asset_index));
  let ids = asset
    .symbols
    .exports
    .iter()
    .filter_map(|export| match &export.exported {
      SymbolName::Name(id) => Some((id.to_string(), export.requested)),
      _ => None,
    });
  if is_entry || asset.symbols.used_namespace {
    return SvgUsage {
      referenced_ids: ids.map(|(id, _)| id).collect(),
      rendered: true,
    };
  }

  let referenced_ids: HashSet<String> = ids
    .filter_map(|(id, requested)| requested.then_some(id))
    .collect();
  let rendered = referenced_ids.is_empty()
    || asset
      .symbols
      .exports
      .iter()
      .any(|export| export.exported == SymbolName::Document && export.requested);
  SvgUsage {
    referenced_ids,
    rendered,
  }
}

/// Appends a transform's dependencies to an asset, with the symbols it imports through them.
fn add_dependencies(asset: &mut Asset, dependencies: Vec<Dependency>, symbols: AssetSymbols) {
  let offset = asset.dependencies.len() as u32;
  let export_offset = asset.symbols.exports.len() as u32;
  asset.dependencies.extend(dependencies);
  asset
    .symbols
    .imports
    .extend(symbols.imports.into_iter().map(|import| {
      ImportedSymbol {
        dep_index: import.dep_index + offset,
        owners: import
          .owners
          .iter()
          .map(|owner| owner + export_offset)
          .collect(),
        ..import
      }
    }));
  asset.symbols.exports.extend(symbols.exports);
  asset
    .symbols
    .local_references
    .extend(
      symbols
        .local_references
        .into_iter()
        .map(|reference| LocalReference {
          from: reference.from + export_offset,
          to: reference.to + export_offset,
        }),
    );
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageOptions {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub xml: bool,
  pub bundles: Vec<BundleReference>,
  pub inline_bundles: HashMap<SerializableTendril, InlineBundle>,
  /// Derived media gate per stylesheet link placeholder: Some sets the media
  /// attribute, None removes it. Keyed by the href placeholder value.
  #[serde(default)]
  pub stylesheet_media: HashMap<SerializableTendril, Option<SerializableTendril>>,
  /// Scripts and stylesheets loaded by each element's bundle, keyed by the
  /// element's placeholder and inserted before that element.
  #[serde(default)]
  pub element_refs: HashMap<SerializableTendril, Vec<BundleReference>>,
  pub import_map: serde_json::Map<String, serde_json::Value>,
  /// JSON the JS runtime reads as the page's manifest: stable bundle keys to final names. It's
  /// prepended to `<head>` as a data block, which Content Security Policies don't block, unlike
  /// inline scripts.
  #[serde(default)]
  pub manifest: Option<String>,
}

#[derive(Serialize)]
pub struct PackageResult {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
}

pub fn package_html(options: PackageOptions) -> Result<PackageResult, ()> {
  let arena = Arena::new();
  let dom = if options.xml {
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  } else {
    html5ever::driver::parse_document(Sink::new(&arena), html5ever::ParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  };

  if !options.xml {
    package::apply_layout(&arena, dom, &options.inline_bundles);
  }

  insert_bundle_references(
    &arena,
    dom,
    options.bundles,
    options.inline_bundles,
    &options.stylesheet_media,
    &options.element_refs,
    &[],
    options.import_map,
    options.manifest,
  );

  let mut vec = Vec::new();
  if options.xml {
    serialize_xml::serialize(&mut vec, dom).map_err(|_| ())?;
  } else {
    html5ever::serialize::serialize(
      &mut vec,
      &SerializableHandle(dom),
      html5ever::serialize::SerializeOpts::default(),
    )
    .map_err(|_| ())?;
  }

  Ok(PackageResult { code: vec })
}

pub fn package_svg(options: PackageOptions) -> Result<PackageResult, ()> {
  let arena = Arena::new();
  let dom =
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice());

  insert_bundle_references(
    &arena,
    dom,
    options.bundles,
    options.inline_bundles,
    &options.stylesheet_media,
    &options.element_refs,
    &[],
    options.import_map,
    options.manifest,
  );

  let mut vec = Vec::new();
  serialize_xml::serialize(&mut vec, dom).map_err(|_| ())?;

  Ok(PackageResult { code: vec })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeHtmlOptions {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub xml: bool,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub config: optimize::OptimizeOptions,
  pub url: SourceUrl,
  #[serde(default)]
  pub project_root: Option<PathId>,
}

fn ok_or_default<'de, T, D>(deserializer: D) -> Result<T, D::Error>
where
  T: serde::Deserialize<'de> + Default,
  D: serde::Deserializer<'de>,
{
  Ok(T::deserialize(deserializer).unwrap_or_default())
}

pub fn optimize_html(options: OptimizeHtmlOptions) -> Result<PackageResult, ()> {
  let arena = Arena::new();
  let dom = if options.xml {
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  } else {
    html5ever::driver::parse_document(Sink::new(&arena), html5ever::ParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  };

  let url = options
    .project_root
    .map(|project_root| options.url.stable_id(&project_root))
    .unwrap_or_else(|| options.url.to_string());
  optimize(&arena, dom, options.config, &url);

  let mut vec: Vec<u8> = Vec::new();
  if options.xml {
    serialize_xml::serialize(&mut vec, dom).map_err(|_| ())?;
  } else {
    serialize_html::serialize(&mut vec, dom, serialize_html::SerializeOpts::default())
      .map_err(|_| ())?;
  }

  Ok(PackageResult { code: vec })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeSvgOptions {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub config: oxvg::OxvgConfig,
  pub url: SourceUrl,
  #[serde(default)]
  pub project_root: Option<PathId>,
  #[serde(skip)]
  pub usage: Option<SvgUsage>,
}

pub fn optimize_svg(options: OptimizeSvgOptions) -> Result<PackageResult, ()> {
  let arena = Arena::new();
  let dom =
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice());

  let url = options
    .project_root
    .map(|project_root| options.url.stable_id(&project_root))
    .unwrap_or_else(|| options.url.to_string());
  optimize::optimize_svg(&arena, dom, &options.config, &url, options.usage.as_ref());

  let mut vec = Vec::new();
  serialize_xml::serialize(&mut vec, dom).map_err(|_| ())?;

  Ok(PackageResult { code: vec })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgReactOptions {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub config: JsxOptions,
  pub url: SourceUrl,
  #[serde(default)]
  pub project_root: Option<PathId>,
}

pub fn svg_react(mut options: SvgReactOptions) -> Result<PackageResult, ()> {
  let arena = Arena::new();
  let dom =
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice());

  if options.config.svgo {
    if options.config.icon.is_some() || !options.config.dimensions {
      options.config.svgo_config.remove_view_box = ConfigItem::Bool(false);
    }

    let url = options
      .project_root
      .map(|project_root| options.url.stable_id(&project_root))
      .unwrap_or_else(|| options.url.to_string());
    optimize::optimize_svg(&arena, dom, &options.config.svgo_config, &url, None);
  }

  swc_core::common::GLOBALS.set(&swc_core::common::Globals::new(), || {
    let program = to_component(dom, &options.config);
    let code = to_code(&program);

    Ok(PackageResult {
      code: code.into_bytes(),
    })
  })
}

/// The `"optimize"` option of @parcel/transformer-html and @parcel/transformer-svg in .parcelrc:
/// false disables minification, and an object sets the minifier's options.
#[derive(Deserialize)]
#[serde(untagged)]
enum OptimizeConfig<T> {
  Enabled(bool),
  Options(T),
}

impl<T: Default> OptimizeConfig<T> {
  fn into_options(self) -> Option<T> {
    match self {
      OptimizeConfig::Enabled(enabled) => enabled.then(T::default),
      OptimizeConfig::Options(options) => Some(options),
    }
  }
}

#[derive(Deserialize)]
pub struct HtmlTransformer {
  #[serde(
    default = "default_html_optimize",
    deserialize_with = "deserialize_html_optimize"
  )]
  optimize: Option<Arc<optimize::OptimizeOptions>>,
  /// Custom elements that call macros in every document, e.g. `{"code-sample": "macros.js#sample"}`,
  /// as if each had a `<parcel:define name="code-sample" src="macros.js#sample">`. Paths are
  /// relative to the config file, and resolved by `resolve_paths`.
  #[serde(default)]
  macros: indexmap::IndexMap<String, String>,
  #[serde(skip)]
  macro_paths: Vec<(String, PathId, Option<String>)>,
  /// The file a server responds with for a directory, e.g. `"index.html"`. Links to pages with
  /// this name are written as their directory (`/docs/` rather than `/docs/index.html`). Off by
  /// default, because such links don't work when opening files directly (file://).
  #[serde(default, rename = "directoryIndex")]
  directory_index: Option<Arc<str>>,
}

impl HtmlTransformer {
  /// Resolves the paths in the config relative to the config file it came from.
  pub fn resolve_paths(mut self, from: PathId) -> Self {
    self.macro_paths = self
      .macros
      .iter()
      .map(|(name, src)| {
        let (file, export) = match src.split_once('#') {
          Some((file, export)) => (file, Some(export.to_owned())),
          None => (src.as_str(), None),
        };
        (
          name.clone(),
          from.resolve(std::path::Path::new(file)),
          export,
        )
      })
      .collect();
    self
  }

  /// The configured macros, with URLs relative to the document at `url`.
  fn macro_imports(&self, url: &SourceUrl) -> Result<Vec<(String, String)>, Diagnostic> {
    if self.macro_paths.is_empty() {
      return Ok(Vec::new());
    }
    let path = url.to_file_path()?;
    Ok(
      self
        .macro_paths
        .iter()
        .map(|(name, file, export)| {
          let mut src = file.relative_url(&path);
          if let Some(export) = export {
            src.push('#');
            src.push_str(export);
          }
          (name.clone(), src)
        })
        .collect(),
    )
  }
}

fn default_html_optimize() -> Option<Arc<optimize::OptimizeOptions>> {
  Some(Default::default())
}

fn deserialize_html_optimize<'de, D>(
  deserializer: D,
) -> Result<Option<Arc<optimize::OptimizeOptions>>, D::Error>
where
  D: serde::Deserializer<'de>,
{
  Ok(
    OptimizeConfig::deserialize(deserializer)?
      .into_options()
      .map(Arc::new),
  )
}

impl Default for HtmlTransformer {
  fn default() -> Self {
    HtmlTransformer {
      optimize: default_html_optimize(),
      macros: Default::default(),
      macro_paths: Vec::new(),
      directory_index: None,
    }
  }
}

impl Transformer for HtmlTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    ctx: &parcel_core::PluginContext,
  ) -> Result<Asset, DiagnosticList> {
    asset.target = Target::normalize(&asset.target, &asset.ty);
    let code = asset.content.read()?;
    let res = transform_html(TransformOptions {
      code,
      url: asset.loc.url.clone(),
      xml: asset.ty == AssetType::Xhtml,
      // Pages without module scripts get one, so that they include the HMR runtime and reload.
      hmr: ctx.options.hmr.is_some() && asset.target.environment.is_browser(),
      target: asset.target.clone(),
      options: ctx.options,
      macro_imports: self.macro_imports(&asset.loc.url)?,
    });

    if !res.errors.is_empty() {
      return Err(DiagnosticList(res.errors));
    }

    asset.bundle_behavior = BundleBehavior::Isolated;
    asset.content = Arc::new(HtmlContent {
      code: res.code,
      url: asset.loc.url.clone(),
      optimize: self.optimize.clone(),
      directory_index: self.directory_index.clone(),
    });
    add_dependencies(&mut asset, res.dependencies, res.symbols);

    Ok(asset)
  }
}

#[derive(Debug)]
pub struct HtmlContent {
  code: Vec<u8>,
  url: SourceUrl,
  optimize: Option<Arc<optimize::OptimizeOptions>>,
  directory_index: Option<Arc<str>>,
}

impl Content for HtmlContent {
  fn estimate_size(&self) -> Result<usize, Diagnostic> {
    Ok(self.code.len())
  }

  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(self.code.clone())
  }

  fn ty(&self) -> ContentType {
    parcel_core::content_type!("HtmlContent")
  }

  fn bundle_dependencies(&self, bundle_graph: &BundleGraph, bundle: &Bundle) -> Vec<usize> {
    let mut dependencies = prepare_to_package_dependencies(bundle_graph, bundle);
    dependencies.extend(manifest_dependencies(bundle_graph, bundle));
    dependencies
  }

  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<std::sync::Arc<dyn Content>, DiagnosticList> {
    assert_eq!(bundle.assets.len(), 1);

    let (code, bundles, inline_bundles, stylesheet_media, element_refs) = prepare_to_package(
      bundle_graph,
      bundle,
      get_inline_bundle_content,
      self.directory_index.as_deref(),
    )?;

    let res = package_html(PackageOptions {
      code,
      xml: bundle.ty == AssetType::Xhtml,
      bundles,
      inline_bundles,
      stylesheet_media,
      element_refs,
      import_map: Default::default(),
      manifest: manifest_json(bundle_graph, bundle)?,
    })
    .unwrap();

    let code = match &self.optimize {
      Some(config)
        if bundle
          .target
          .flags
          .contains(EnvironmentFlags::SHOULD_OPTIMIZE) =>
      {
        optimize_html(OptimizeHtmlOptions {
          code: res.code,
          xml: bundle.ty == AssetType::Xhtml,
          config: (**config).clone(),
          url: self.url.clone(),
          project_root: Some(options.project_root),
        })
        .unwrap()
        .code
      }
      _ => res.code,
    };

    Ok(Arc::new(BufferContent::new(code)))
  }
}

/// Bundles `prepare_to_package` accesses: each dependency's target (by URL, or its inline
/// content), and the bundles each target references, transitively (injected as scripts and
/// stylesheets).
fn prepare_to_package_dependencies(bundle_graph: &BundleGraph, bundle: &Bundle) -> Vec<usize> {
  let mut dependencies = Vec::new();
  for target in bundle_graph.bundle_dependency_targets(bundle) {
    dependencies.extend(bundle_graph.referenced_bundles(target));
  }
  dependencies
}

/// JS context roots this page loads that rely on it for their manifest (see
/// `BundleGraph::is_page_hosted`).
fn hosted_roots<'a>(bundle_graph: &'a BundleGraph, bundle: &'a Bundle) -> Vec<&'a Bundle> {
  let mut roots: Vec<&Bundle> = Vec::new();
  for target in bundle_graph.bundle_dependency_targets(bundle) {
    let target = &bundle_graph.bundles[target];
    if target.is_context_root()
      && bundle_graph.is_page_hosted(target)
      && !roots.iter().any(|root| root.id == target.id)
    {
      roots.push(target);
    }
  }
  roots
}

/// Bundles the page's manifest maps to their final names.
fn manifest_dependencies(bundle_graph: &BundleGraph, bundle: &Bundle) -> Vec<usize> {
  hosted_roots(bundle_graph, bundle)
    .into_iter()
    .flat_map(|root| bundle_graph.context_closure(root).iter().copied())
    .collect()
}

/// The final names of content hashed bundles loaded by the page's scripts, by stable key, as JSON
/// for the runtime. Pages hold it rather than their scripts, so a script's own name doesn't depend
/// on everything it loads.
fn manifest_json(
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
) -> Result<Option<String>, DiagnosticList> {
  let mut entries: Vec<(String, String)> = manifest_dependencies(bundle_graph, bundle)
    .into_iter()
    .map(|index| &bundle_graph.bundles[index])
    .filter(|target| target.has_final_path())
    .map(|target| (target.stable_key(), target.name()))
    .filter(|(stable_key, name)| stable_key != name)
    .collect();
  if entries.is_empty() {
    return Ok(None);
  }
  entries.sort_unstable();
  entries.dedup();
  let map: serde_json::Map<String, serde_json::Value> = entries
    .into_iter()
    .map(|(stable_key, name)| (stable_key, name.into()))
    .collect();
  // `</` would end the script element. `<\/` is the same string in JSON.
  let json = serde_json::to_string(&map).map_err(Diagnostic::from)?;
  Ok(Some(json.replace("</", "<\\/")))
}

/// The URL `from` references `target` by. Pages are also served at other URLs, e.g. client-side
/// routes, and feed readers resolve against the feed's location, so both use absolute URLs, unless
/// a page's public URL is relative. Other documents, e.g. SVG images, resolve against themselves.
fn reference_url(target: &Bundle, from: &Bundle) -> String {
  let page = matches!(from.ty, AssetType::Html | AssetType::Xhtml);
  if from.ty.is_xml() || (page && !target.target.has_relative_public_url()) {
    target.absolute_url()
  } else {
    target.relative_url(from).unwrap()
  }
}

/// Construct a reference once for both document-wide and element-local insertion.
fn bundle_reference(
  graph: &BundleGraph,
  target: &Bundle,
  from: &Bundle,
) -> Option<BundleReference> {
  let url = || SerializableTendril(reference_url(target, from).into());
  match target.ty {
    AssetType::Js => Some(BundleReference::Script {
      src: url(),
      module: target.target.output_format == OutputFormat::Esmodule,
    }),
    AssetType::Css => Some(BundleReference::StyleSheet {
      href: url(),
      media: graph
        .common_style_media(target)
        .map(|media| SerializableTendril(media.into())),
    }),
    _ => None,
  }
}

/// Writes a link to a page named `directory_index` as its directory: `docs/index.html` becomes
/// `docs/`, and `index.html` (in the same directory) becomes `./`.
fn strip_directory_index(url: &mut String, directory_index: &str) {
  if url == directory_index {
    *url = "./".into();
  } else if url.ends_with(directory_index)
    && url[..url.len() - directory_index.len()].ends_with('/')
  {
    url.truncate(url.len() - directory_index.len());
  }
}

fn prepare_to_package(
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  directory_index: Option<&str>,
) -> Result<
  (
    Vec<u8>,
    Vec<BundleReference>,
    HashMap<SerializableTendril, InlineBundle>,
    HashMap<SerializableTendril, Option<SerializableTendril>>,
    HashMap<SerializableTendril, Vec<BundleReference>>,
  ),
  DiagnosticList,
> {
  let asset = &bundle_graph.asset_graph.asset(bundle.assets[0]);

  let code = asset.content.read()?;

  let mut inline_bundles = HashMap::new();
  let mut stylesheet_media = HashMap::new();
  let mut element_refs: HashMap<SerializableTendril, Vec<BundleReference>> = HashMap::new();
  // Preserve reference order: stylesheet link order is cascade order.
  let mut referenced_bundles = Vec::<usize>::new();
  let positional_styles = matches!(
    bundle.ty,
    AssetType::Html | AssetType::Xhtml | AssetType::Svg
  );
  let xml = bundle.ty.is_xml();
  for (dep_index, dep) in asset.dependencies.iter().enumerate() {
    match bundle_graph.dependency_resolution(bundle.assets[0], dep_index) {
      BundleGraphDependencyResolution::Bundle {
        bundle_index: b, ..
      } => {
        let referenced_bundle = &bundle_graph.bundles[b as usize];
        // The target can be inline even when the dependency isn't (e.g. a `data-url:` pipeline),
        // and inline bundles are never written, so there is no URL to reference.
        let is_inline = dep.bundle_behavior == BundleBehavior::Inline
          || referenced_bundle.bundle_behavior == BundleBehavior::Inline;
        let contents = if is_inline {
          get_inline_bundle_content(b as usize)?
            .read_string()?
            .into_owned()
        } else {
          let mut url = reference_url(referenced_bundle, bundle);
          // Only pages are navigated to, so other bundles keep their file names.
          if let Some(directory_index) = directory_index
            && matches!(referenced_bundle.ty, AssetType::Html | AssetType::Xhtml)
          {
            strip_directory_index(&mut url, directory_index);
          }
          url.push_str(dep.url_suffix().unwrap_or_default());
          url
        };

        inline_bundles.insert(
          SerializableTendril((*dep.placeholder.clone().unwrap()).into()),
          InlineBundle {
            contents: SerializableTendril(contents.into()),
            module: referenced_bundle.target.output_format == OutputFormat::Esmodule,
          },
        );

        // Re-derive the media attribute of stylesheet links from the resolved
        // bundle. Correctness comes from each asset's own condition wrapping;
        // the attribute is a fetch-priority hint that must gate the whole file.
        if referenced_bundle.ty == AssetType::Css && !is_inline {
          stylesheet_media.insert(
            SerializableTendril((*dep.placeholder.clone().unwrap()).into()),
            bundle_graph
              .common_style_media(referenced_bundle)
              .map(|media| SerializableTendril(media.into())),
          );
        }

        let mut refs = Vec::new();
        // Bundles don't import their siblings, so the document loads their
        // references. HTML and SVG styles follow the element's cascade position;
        // feed content loads scripts and styles within each fragment.
        let loads_references =
          !xml || matches!(referenced_bundle.ty, AssetType::Js | AssetType::Css);
        if loads_references {
          for reference in bundle_graph.referenced_bundles(b as usize).skip(1) {
            let target = &bundle_graph.bundles[reference];
            if target.bundle_behavior == BundleBehavior::Inline {
              continue;
            }
            if xml || (positional_styles && target.ty == AssetType::Css) {
              // First occurrence wins page-wide for HTML. XML keeps references
              // for every consumer, which the packager deduplicates per fragment.
              if xml || !referenced_bundles.contains(&reference) {
                if !xml {
                  referenced_bundles.push(reference);
                }
                if let Some(reference) = bundle_reference(bundle_graph, target, bundle) {
                  refs.push(reference);
                }
              }
            } else if !referenced_bundles.contains(&reference) {
              referenced_bundles.push(reference);
            }
          }
        }
        if !refs.is_empty() {
          element_refs.insert(
            SerializableTendril((*dep.placeholder.clone().unwrap()).into()),
            refs,
          );
        }
      }
      // A link to the document itself (e.g. in navigation shared by every page) resolves to its
      // own asset rather than a bundle. It's written as the document's URL, which differs from the
      // specifier when the namer moves the document (e.g. docs.md to docs/index.html). A hashed name
      // isn't known until the content is, so those links keep the specifier.
      BundleGraphDependencyResolution::Asset(a)
        if a == bundle.assets[0]
          && matches!(bundle.ty, AssetType::Html | AssetType::Xhtml)
          && !bundle.may_be_content_hashed() =>
      {
        let mut url = reference_url(bundle, bundle);
        if let Some(directory_index) = directory_index {
          strip_directory_index(&mut url, directory_index);
        }
        url.push_str(dep.url_suffix().unwrap_or_default());
        inline_bundles.insert(
          SerializableTendril((*dep.placeholder.clone().unwrap()).into()),
          InlineBundle {
            contents: SerializableTendril(url.into()),
            module: false,
          },
        );
      }
      _ => {
        inline_bundles.insert(
          SerializableTendril((*dep.placeholder.clone().unwrap()).into()),
          InlineBundle {
            contents: SerializableTendril((*dep.specifier.clone()).into()),
            module: false,
          },
        );
      }
    }
  }

  let bundles = referenced_bundles
    .into_iter()
    .filter_map(|reference| {
      let referenced_bundle = &bundle_graph.bundles[reference];
      if positional_styles && referenced_bundle.ty == AssetType::Css {
        return None;
      }
      bundle_reference(bundle_graph, referenced_bundle, bundle)
    })
    .collect();

  Ok((
    code,
    bundles,
    inline_bundles,
    stylesheet_media,
    element_refs,
  ))
}

#[derive(Deserialize)]
pub struct SvgTransformer {
  /// None when optimization is disabled.
  #[serde(
    rename = "optimize",
    default = "default_svg_optimize",
    deserialize_with = "deserialize_svg_optimize"
  )]
  pub config: Option<OxvgConfig>,
}

fn default_svg_optimize() -> Option<OxvgConfig> {
  Some(Default::default())
}

fn deserialize_svg_optimize<'de, D>(deserializer: D) -> Result<Option<OxvgConfig>, D::Error>
where
  D: serde::Deserializer<'de>,
{
  Ok(OptimizeConfig::deserialize(deserializer)?.into_options())
}

impl Default for SvgTransformer {
  fn default() -> Self {
    SvgTransformer {
      config: default_svg_optimize(),
    }
  }
}

impl Transformer for SvgTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    ctx: &parcel_core::PluginContext,
  ) -> Result<Asset, DiagnosticList> {
    asset.target = Target::normalize(&asset.target, &asset.ty);
    let code = asset.content.read()?;
    let res = transform_svg(TransformOptions {
      code,
      url: asset.loc.url.clone(),
      xml: false,
      target: asset.target.clone(),
      hmr: false,
      options: ctx.options,
      macro_imports: Vec::new(),
    });

    asset.bundle_behavior = BundleBehavior::Isolated;
    asset.content = Arc::new(SvgContent {
      code: res.code,
      config: self.config.clone(),
      url: asset.loc.url.clone(),
    });
    add_dependencies(&mut asset, res.dependencies, res.symbols);
    // Its element ids are all known, unless scripts may create more.
    asset.flags.set(
      AssetFlags::STATIC_EXPORTS,
      !asset.symbols.exports.is_empty(),
    );

    Ok(asset)
  }
}

pub struct SvgToJsxTransformer {
  pub config: JsxOptions,
}

impl Transformer for SvgToJsxTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    ctx: &parcel_core::PluginContext,
  ) -> Result<Asset, DiagnosticList> {
    let options = ctx.options;
    let code = asset.content.read()?;
    let mut config = self.config.clone();
    if matches!(config.svgo_config.prefix_ids, ConfigItem::None) {
      config.svgo_config.prefix_ids = ConfigItem::Bool(true);
    }

    let res = svg_react(SvgReactOptions {
      code,
      config,
      url: asset.loc.url.clone(),
      project_root: Some(options.project_root),
    })
    .unwrap();
    // TODO: avoid re-parse by storing JS ast.
    asset.content = Arc::new(BufferContent::new(res.code));
    asset.ty = AssetType::Jsx;
    asset.flags |= AssetFlags::AUTOMATIC_JSX_RUNTIME;
    Ok(asset)
  }
}

#[derive(Debug)]
pub struct SvgContent {
  code: Vec<u8>,
  config: Option<OxvgConfig>,
  url: SourceUrl,
}

impl Content for SvgContent {
  fn estimate_size(&self) -> Result<usize, Diagnostic> {
    Ok(self.code.len())
  }

  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(self.code.clone())
  }

  fn ty(&self) -> ContentType {
    parcel_core::content_type!("SvgContent")
  }

  fn bundle_dependencies(&self, bundle_graph: &BundleGraph, bundle: &Bundle) -> Vec<usize> {
    prepare_to_package_dependencies(bundle_graph, bundle)
  }

  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<std::sync::Arc<dyn Content>, DiagnosticList> {
    assert_eq!(bundle.assets.len(), 1);

    let (code, bundles, inline_bundles, stylesheet_media, element_refs) =
      prepare_to_package(bundle_graph, bundle, get_inline_bundle_content, None)?;

    let res = package_svg(PackageOptions {
      code,
      xml: false,
      bundles,
      inline_bundles,
      stylesheet_media,
      element_refs,
      import_map: Default::default(),
      manifest: None,
    })
    .unwrap();

    let code = match &self.config {
      Some(config)
        if bundle
          .target
          .flags
          .contains(EnvironmentFlags::SHOULD_OPTIMIZE) =>
      {
        optimize_svg(OptimizeSvgOptions {
          code: res.code,
          config: config.clone(),
          url: self.url.clone(),
          project_root: Some(options.project_root),
          usage: Some(svg_usage(&bundle_graph.asset_graph, bundle.assets[0])),
        })
        .unwrap()
        .code
      }
      _ => res.code,
    };

    Ok(Arc::new(BufferContent::new(code)))
  }
}

#[cfg(test)]
mod tests {
  use crate::transform_html;

  #[test]
  fn test_transform() {
    let url = parcel_core::SourceUrl::from_path(&parcel_core::PathId::new(
      &std::env::current_dir().unwrap().join("foo.html"),
    ));
    let res = transform_html(crate::TransformOptions {
      code: "<html><body><template><div>test</div><span>hi</span></template></body></html>".into(),
      url: url.clone(),
      xml: false,
      target: Default::default(),
      hmr: false,
      options: &Default::default(),
      macro_imports: Vec::new(),
    });

    assert_eq!(
      std::str::from_utf8(&res.code).unwrap(),
      "<html><head></head><body><template><div>test</div><span>hi</span></template></body></html>"
    );
  }

  #[test]
  fn svg_elements_reference_the_elements_they_use() {
    let res = crate::transform_svg(crate::TransformOptions {
      code: br##"<svg xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="fade"><stop offset="0"/></linearGradient></defs>
        <symbol id="home"><path fill="url(#fade)"/></symbol>
        <symbol id="badge"><g><use href="#dot"/></g></symbol>
        <g id="dot" style="fill: url(#fade)"><circle r="4"/></g>
        <symbol id="other"><use href="other.svg#x"/></symbol>
      </svg>"##
        .to_vec(),
      url: parcel_core::SourceUrl::parse("file:///sprite.svg").unwrap(),
      xml: true,
      target: Default::default(),
      hmr: false,
      options: &Default::default(),
      macro_imports: Vec::new(),
    });

    let symbols = &res.symbols;
    let name = |index: u32| symbols.exports[index as usize].exported.as_str();
    let references: Vec<_> = symbols
      .local_references
      .iter()
      .map(|reference| (name(reference.from), name(reference.to)))
      .collect();
    assert_eq!(
      references,
      [("home", "fade"), ("badge", "dot"), ("dot", "fade")]
    );
  }

  #[test]
  fn svg_elements_reference_the_elements_with_ids_inside_them() {
    let res = crate::transform_svg(crate::TransformOptions {
      code: br##"<svg xmlns="http://www.w3.org/2000/svg">
        <linearGradient id="fade"><stop offset="0"/></linearGradient>
        <symbol id="outer"><g id="inner"><path fill="url(#fade)"/></g></symbol>
        <g id="fade"><use href="#outer"/></g>
      </svg>"##
        .to_vec(),
      url: parcel_core::SourceUrl::parse("file:///sprite.svg").unwrap(),
      xml: true,
      target: Default::default(),
      hmr: false,
      options: &Default::default(),
      macro_imports: Vec::new(),
    });

    let symbols = &res.symbols;
    let name = |index: u32| symbols.exports[index as usize].exported.as_str();
    let references: Vec<_> = symbols
      .local_references
      .iter()
      .map(|reference| (name(reference.from), name(reference.to)))
      .collect();
    // `outer` keeps `inner`, and with it the gradient. The second element with the `fade` id isn't
    // the one `url(#fade)` refers to, so it isn't an export, and its reference is the document's.
    assert_eq!(references, [("outer", "inner"), ("inner", "fade")]);
    assert_eq!(
      symbols.exports[0].exported,
      parcel_core::SymbolName::Document
    );
    assert_eq!(
      symbols.exports[1..]
        .iter()
        .map(|export| export.exported.as_str())
        .collect::<Vec<_>>(),
      ["fade", "outer", "inner"]
    );
  }

  #[test]
  fn manifest_is_a_data_block_before_every_script() {
    let res = crate::package_html(crate::PackageOptions {
      code: b"<html><head><script src=\"app.js\"></script></head><body></body></html>".to_vec(),
      xml: false,
      bundles: Vec::new(),
      inline_bundles: Default::default(),
      stylesheet_media: Default::default(),
      element_refs: Default::default(),
      import_map: Default::default(),
      manifest: Some(r#"{"a-0123456789abcdef.js":"a-abcdefgh.js","x":"<\/script>"}"#.into()),
    })
    .unwrap();

    // Content Security Policies block inline scripts, but not data blocks.
    assert_eq!(
      std::str::from_utf8(&res.code).unwrap(),
      r#"<html><head><script type="application/json" data-parcel-manifest="">{"a-0123456789abcdef.js":"a-abcdefgh.js","x":"<\/script>"}</script><script src="app.js"></script></head><body></body></html>"#
    );
  }
}

#[cfg(test)]
mod directory_index_tests {
  use super::strip_directory_index;

  #[test]
  fn strips_directory_index() {
    let strip = |url: &str| {
      let mut url = url.to_string();
      strip_directory_index(&mut url, "index.html");
      url
    };
    assert_eq!(strip("/index.html"), "/");
    assert_eq!(strip("/docs/index.html"), "/docs/");
    assert_eq!(strip("../docs/index.html"), "../docs/");
    assert_eq!(strip("index.html"), "./");
    assert_eq!(
      strip("https://example.com/a/index.html"),
      "https://example.com/a/"
    );
    assert_eq!(strip("/docs/myindex.html"), "/docs/myindex.html");
    assert_eq!(strip("/about.html"), "/about.html");
  }
}
