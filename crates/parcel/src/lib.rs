use std::{collections::HashSet, hash::Hash, path::Path, sync::Arc};

use parcel_core::{
  AssetGraph, AssetNode, AssetType, BufferContent, BuildOptions, Bundle, BundleFlags, BundleGraph,
  Bundler, CPlugin, DefaultBundler, DependencyResolution, DiagnosticList, Namer, Optimizer,
  OutputFormat, Packager, ParcelConfig, PluginFactory, SourceUrl, Transformer,
};
use parcel_css::{CssPackager, CssTransformer, StyleAttrPackager, StyleAttrTransformer};
use parcel_html::{HtmlPackager, HtmlTransformer, SvgPackager, SvgTransformer};
use parcel_image::ImageTransformer;
use parcel_js::{JsPackager, JsTransformer, LibraryPackager};
use parcel_plugin_js::JsPlugin;
use xxhash_rust::xxh3::Xxh3Default;

use crate::resolver::DefaultResolver;

mod resolver;
mod server;

struct DefaultPluginFactory {}

impl PluginFactory for DefaultPluginFactory {
  fn transformer(&self, name: &str, config: Option<serde_json::Value>) -> Arc<dyn Transformer> {
    match name {
      "@parcel/transformer-js" => Arc::new(JsTransformer {}),
      "@parcel/transformer-css" => Arc::new(if let Some(config) = config {
        serde_json::from_value(config).unwrap()
      } else {
        CssTransformer::default()
      }),
      "@parcel/transformer-style-attr" => Arc::new(StyleAttrTransformer {}),
      "@parcel/transformer-html" => Arc::new(HtmlTransformer {}),
      "@parcel/transformer-svg" => Arc::new(SvgTransformer {}),
      "@parcel/transformer-image" => Arc::new(ImageTransformer {}),
      // "@parcel/transformer-less" => Arc::new(CPlugin::new(Path::new(
      //   "/Users/devongovett/Downloads/hermes/plugin.dylib",
      // ))),
      "@parcel/transformer-json" => Arc::new(JsonTransformer {}),
      "@parcel/transformer-toml" => Arc::new(TomlTransformer {}),
      "@parcel/transformer-yaml" => Arc::new(YamlTransformer {}),
      "@parcel/transformer-inline" => Arc::new(InlineTransformer {}),
      "@parcel/transformer-raw" => Arc::new(RawTransformer {}),
      "@parcel/transformer-native" => {
        if let Some(config) = config {
          if let Some(serde_json::Value::String(lib)) = config.get("lib") {
            return Arc::new(CPlugin::new(Path::new(lib)));
          }
        }
        todo!()
      }
      "@parcel/transformer-quickjs" => {
        if let Some(config) = config {
          if let Some(serde_json::Value::String(lib)) = config.get("path") {
            return Arc::new(JsPlugin::new(Path::new(lib)));
          }
        }
        todo!()
      }
      // "@parcel/transformer-test" => Arc::new(parcel_core::WasmPlugin::new(Path::new(
      //   "/Users/devongovett/Downloads/asm-script/test.wasm",
      // ))),
      _ => todo!(),
    }
  }

  fn bundler(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
  ) -> Arc<dyn parcel_core::Bundler> {
    if name == "@parcel/bundler-default" {
      Arc::new(DefaultBundler {})
    } else if name == "@parcel/bundler-library" {
      Arc::new(LibraryBundler {})
    } else {
      todo!()
    }
  }

  fn namer(&self, name: &str, config: Option<serde_json::Value>) -> Arc<dyn Namer> {
    if name == "@parcel/namer-default" {
      Arc::new(DefaultNamer {})
    } else {
      todo!()
    }
  }

  fn optimizer(&self, name: &str, config: Option<serde_json::Value>) -> Arc<dyn Optimizer> {
    match name {
      "@parcel/optimizer-data-url" => Arc::new(DataUrlOptimizer {}),
      _ => todo!(),
    }
  }

  fn packager(&self, name: &str, config: Option<serde_json::Value>) -> Arc<dyn Packager> {
    match name {
      "@parcel/packager-js" => Arc::new(JsPackager {}),
      "@parcel/packager-library" => Arc::new(LibraryPackager {}),
      "@parcel/packager-css" => Arc::new(CssPackager {}),
      "@parcel/packager-style-attr" => Arc::new(StyleAttrPackager {}),
      "@parcel/packager-html" => Arc::new(HtmlPackager {}),
      "@parcel/packager-svg" => Arc::new(SvgPackager {}),
      _ => todo!(),
    }
  }

  fn resolver(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
  ) -> Arc<dyn parcel_core::Resolver> {
    if name == "@parcel/resolver-default" {
      Arc::new(DefaultResolver::new("/".into()))
    } else {
      todo!()
    }
  }

  fn config(&self, specifier: &str) -> ParcelConfig {
    todo!()
  }
}

pub fn build(entries: Vec<String>, options: BuildOptions) -> Result<BundleGraph, DiagnosticList> {
  let start = std::time::Instant::now();
  match parcel_core::build(entries, options, &DefaultPluginFactory {}) {
    Ok(g) => {
      println!("SUCCESS! {:?}", start.elapsed());
      Ok(g)
    }
    Err(err) => {
      let mut stderr = std::io::stderr();
      err.report(&mut stderr).unwrap();
      Err(err)
    }
  }
}

pub fn watch(entries: Vec<String>, options: BuildOptions) {
  build(entries.clone(), options.clone());

  let watcher = parcel_watcher::watch(Path::new("/Users/devongovett/dev/parcel/test"));
  while let Ok(events) = watcher.recv() {
    println!("{:?}", events);
    if events
      .iter()
      .any(|e| !e.path.as_os_str().to_str().unwrap().contains("dist"))
    {
      build(entries.clone(), options.clone());
    }
  }
}

pub fn serve(entries: Vec<String>, options: BuildOptions) {
  let server = server::serve_dir(Path::new("/Users/devongovett/dev/parcel/test/dist"));
  build(entries.clone(), options.clone());

  let watcher = parcel_watcher::watch(Path::new("/Users/devongovett/dev/parcel/test"));
  while let Ok(events) = watcher.recv() {
    if events
      .iter()
      .any(|e| !e.path.as_os_str().to_str().unwrap().contains("dist"))
    {
      let result = build(entries.clone(), options.clone());
      match result {
        Ok(graph) => {
          let changed_urls: HashSet<_> = events
            .iter()
            .map(|e| SourceUrl::from_path(e.path.as_path()).unwrap())
            .collect();

          // TODO: also include new assets
          let changed_assets: Vec<_> = graph
            .asset_graph
            .assets
            .iter()
            .enumerate()
            .filter_map(|(index, a)| {
              if let AssetNode::Asset(a) = a {
                if changed_urls.contains(&a.loc.url) {
                  Some((index as u32, a))
                } else {
                  None
                }
              } else {
                None
              }
            })
            .collect();

          if !changed_assets.is_empty() {
            server.emit_hmr_update(changed_assets, &graph);
          }
        }
        Err(_) => {}
      }
    }
  }
}

struct DefaultNamer {}

impl Namer for DefaultNamer {
  fn name(
    &self,
    asset_graph: &AssetGraph,
    bundle: &parcel_core::Bundle,
    _options: &parcel_core::ParcelOptions,
  ) -> Result<Option<String>, DiagnosticList> {
    let mut ext = bundle.ty.extension();
    if bundle.ty == AssetType::Js {
      if bundle.env.output_format == OutputFormat::Esmodule {
        ext = "mjs";
      } else if bundle.env.output_format == OutputFormat::Commonjs {
        ext = "cjs";
      }
    }

    if bundle.flags.contains(BundleFlags::NEEDS_STABLE_NAME) {
      if let Some(entry) = bundle.main_entry_asset {
        if let AssetNode::Asset(asset) = &asset_graph.assets[entry] {
          return Ok(Some(format!(
            "{}",
            asset
              .loc
              .url
              .to_file_path()
              .unwrap()
              .with_extension(ext)
              .file_name()
              .unwrap()
              .to_str()
              .unwrap()
          )));
        }
      }
    }

    let mut hash = Xxh3Default::new();
    bundle.assets.hash(&mut hash);
    Ok(Some(format!("{:016x}.{}", hash.digest(), ext)))
  }
}

struct LibraryBundler {}

impl Bundler for LibraryBundler {
  fn bundle(&self, mut asset_graph: AssetGraph) -> Result<BundleGraph, DiagnosticList> {
    let mut bundles = Vec::<Bundle>::new();

    for (id, asset) in asset_graph.assets.iter_mut().enumerate() {
      if let AssetNode::Asset(asset) = asset {
        bundles.push(Bundle {
          ty: asset.ty.clone(),
          assets: vec![id],
          bundle_behavior: asset.bundle_behavior,
          entry_assets: vec![id],
          env: asset.env.clone(),
          flags: BundleFlags::NEEDS_STABLE_NAME,
          main_entry_asset: Some(id),
          name: None,
          referenced_bundles: Vec::new(),
        });

        for dep in &mut asset.dependencies {
          if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
            dep.resolution = DependencyResolution::Bundle(resolved_asset_index);
          }
        }
      }
    }

    Ok(BundleGraph {
      asset_graph,
      bundles,
    })
  }
}

struct JsonTransformer {}

impl Transformer for JsonTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _options: &parcel_core::ParcelOptions,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    let content = asset.content.read()?;
    let code = std::str::from_utf8(&content)?;
    // let json: serde_json::Value = json5::from_str(code)?;
    let js = format!("module.exports = {};\n", code);

    asset.ty = AssetType::Js;
    asset.content = Arc::new(BufferContent::new(js.into_bytes()));
    Ok(asset)
  }
}

struct TomlTransformer {}

impl Transformer for TomlTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _options: &parcel_core::ParcelOptions,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    let content = asset.content.read()?;
    let code = std::str::from_utf8(&content)?;
    let parsed: serde_json::Value = toml::from_str(code).unwrap();
    let json = serde_json::to_string(&parsed).unwrap();
    let js = format!("module.exports = {};\n", json);

    asset.ty = AssetType::Js;
    asset.content = Arc::new(BufferContent::new(js.into_bytes()));
    Ok(asset)
  }
}

struct YamlTransformer {}

impl Transformer for YamlTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _options: &parcel_core::ParcelOptions,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    let content = asset.content.read()?;
    let code = std::str::from_utf8(&content)?;
    let parsed: serde_json::Value = serde_yaml_ng::from_str(code).unwrap();
    let json = serde_json::to_string(&parsed).unwrap();
    let js = format!("module.exports = {};\n", json);

    asset.ty = AssetType::Js;
    asset.content = Arc::new(BufferContent::new(js.into_bytes()));
    Ok(asset)
  }
}

struct InlineTransformer {}

impl Transformer for InlineTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _options: &parcel_core::ParcelOptions,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    asset.bundle_behavior = parcel_core::BundleBehavior::Inline;
    Ok(asset)
  }
}

struct DataUrlOptimizer {}

impl Optimizer for DataUrlOptimizer {
  fn optimize(
    &self,
    _bundle_graph: &BundleGraph,
    bundle: &Bundle,
    contents: Arc<dyn parcel_core::Content>,
  ) -> Result<Arc<dyn parcel_core::Content>, DiagnosticList> {
    let base64 = base64_url::encode(&contents.read()?);
    let url = format!("data:{};base64,{}", bundle.ty.mime(), base64);
    Ok(Arc::new(BufferContent::new(url.into_bytes())))
  }
}

struct RawTransformer {}

impl Transformer for RawTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _options: &parcel_core::ParcelOptions,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    asset.bundle_behavior = parcel_core::BundleBehavior::Isolated;
    Ok(asset)
  }
}

// let config = ParcelConfig {
//   resolvers: vec![Arc::new(DefaultResolver::new("/".into()))],
//   transformers: PipelineMap(vec![
//     (
//       "*.{js,mjs,jsm,jsx,es6,ts,tsx,mdx}".into(),
//       vec![PipelineNode::Plugin(Arc::new(JsTransformer {}))],
//     ),
//     (
//       "*.module.css".into(),
//       vec![PipelineNode::Plugin(Arc::new(CssTransformer {
//         css_modules: Some(lightningcss::css_modules::Config {
//           dashed_idents: true,
//           ..Default::default()
//         }),
//       }))],
//     ),
//     (
//       "*.css".into(),
//       vec![PipelineNode::Plugin(Arc::new(CssTransformer {
//         css_modules: None,
//       }))],
//     ),
//     (
//       "*.style".into(),
//       vec![PipelineNode::Plugin(Arc::new(StyleAttrTransformer {}))],
//     ),
//     (
//       "*.{html,xhtml}".into(),
//       vec![PipelineNode::Plugin(Arc::new(HtmlTransformer {}))],
//     ),
//     (
//       "*.svg".into(),
//       vec![PipelineNode::Plugin(Arc::new(SvgTransformer {}))],
//     ),
//     (
//       "*.{png,jpeg,jpg,gif,webp,tiff,bmp,ico,avif}".into(),
//       vec![PipelineNode::Plugin(Arc::new(ImageTransformer {}))],
//     ),
//     (
//       "*.less".into(),
//       vec![PipelineNode::Plugin(Arc::new(CPlugin::new(Path::new(
//         "/Users/devongovett/Downloads/hermes/plugin.dylib",
//       ))))],
//     ),
//   ]),
//   bundler: Arc::new(DefaultBundler {}),
//   namers: vec![Arc::new(DefaultNamer {})],
//   runtimes: Default::default(),
//   packagers: indexmap! {
//     "js".into() => Arc::new(JsPackager {}) as Arc<dyn Packager>,
//     "css".into() => Arc::new(CssPackager {}),
//     "style".into() => Arc::new(StyleAttrPackager {}),
//     "html".into() => Arc::new(HtmlPackager {}),
//     "xhtml".into() => Arc::new(HtmlPackager {}),
//     "svg".into() => Arc::new(SvgPackager {})
//   },
//   optimizers: Default::default(),
//   validators: Default::default(),
//   compressors: Default::default(),
//   reporters: Default::default(),
// };
