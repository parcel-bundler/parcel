use std::{collections::HashMap, hash::Hash, path::Path, sync::Arc};

use indexmap::{IndexMap, indexmap};
use parcel_core::{
  AssetGraph, AssetNode, BundleFlags, CPlugin, DefaultBundler, DiagnosticList, Namer, Optimizer,
  Packager, ParcelConfig, ParcelOptions, PipelineMap, PipelineNode, Plugin, PluginFactory,
  SourceUrl, Transformer,
};
use parcel_image::ImageTransformer;
use parcel_plugin_js::JsPlugin;
use parcel_resolver::OsFileSystem;
use xxhash_rust::xxh3::Xxh3Default;

use crate::{
  css::{CssPackager, CssTransformer, StyleAttrPackager, StyleAttrTransformer},
  html::{HtmlPackager, HtmlTransformer},
  js::{JsPackager, JsTransformer},
  resolver::DefaultResolver,
  svg::{SvgPackager, SvgTransformer},
};

mod css;
mod html;
mod js;
mod resolver;
mod server;
mod svg;

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
    todo!()
  }

  fn packager(&self, name: &str, config: Option<serde_json::Value>) -> Arc<dyn Packager> {
    match name {
      "@parcel/packager-js" => Arc::new(JsPackager {}),
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

pub fn build() {
  let start = std::time::Instant::now();
  let options = Arc::new(ParcelOptions {
    env: HashMap::new(),
    input_fs: Arc::new(OsFileSystem {}),
    log_level: parcel_core::LogLevel::Verbose,
    mode: parcel_core::BuildMode::Development,
    project_root: SourceUrl::from_path(Path::new(
      "/Users/devongovett/dev/parcel/test",
      // "/Users/devongovett/dev/esbuild/require/parcel2/bench/three/",
    ))
    .unwrap(),
  });

  match parcel_core::build(
    // vec!["/Users/devongovett/dev/esbuild/require/parcel2/bench/three/entry.parcel2.js".into()],
    vec!["/Users/devongovett/dev/parcel/test/index.html".into()],
    options,
    &DefaultPluginFactory {},
  ) {
    Ok(_) => {
      println!("SUCCESS! {:?}", start.elapsed());
    }
    Err(err) => {
      println!("ERROR: {:?}", err);
    }
  }
}

pub fn watch() {
  build();

  let watcher = parcel_watcher::watch(Path::new("/Users/devongovett/dev/parcel/test"));
  while let Ok(events) = watcher.recv() {
    println!("{:?}", events);
    if events
      .iter()
      .any(|e| !e.path.as_os_str().to_str().unwrap().contains("dist"))
    {
      build();
    }
  }
}

pub fn serve() {
  server::serve_dir(Path::new("/Users/devongovett/dev/parcel/test/dist"));
  watch();
}

struct DefaultNamer {}

impl Namer for DefaultNamer {
  fn name(
    &self,
    asset_graph: &AssetGraph,
    bundle: &parcel_core::Bundle,
  ) -> Result<Option<String>, DiagnosticList> {
    if bundle.flags.contains(BundleFlags::NEEDS_STABLE_NAME) {
      if let Some(entry) = bundle.main_entry_asset {
        if let AssetNode::Asset(asset) = &asset_graph.assets[entry] {
          return Ok(Some(format!(
            "test/dist/{}",
            asset
              .loc
              .url
              .to_file_path()
              .unwrap()
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
    Ok(Some(format!(
      "test/dist/{:016x}.{}",
      hash.digest(),
      bundle.ty.extension()
    )))
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
