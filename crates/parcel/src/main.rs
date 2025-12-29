use std::{collections::HashMap, hash::Hash, path::Path, sync::Arc};

use indexmap::indexmap;
use parcel_core::{
  AssetGraph, BundleFlags, DefaultBundler, Namer, Packager, ParcelConfig, ParcelOptions,
  PipelineMap, PipelineNode, Plugin, SourceUrl, Transformer, build,
};
use parcel_image::ImageTransformer;
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
mod svg;

pub fn main() {
  let config = ParcelConfig {
    resolvers: vec![Plugin {
      package_name: "@parcel/resolver-default".into(),
      key_path: Some("/resolvers".into()),
      plugin: Arc::new(DefaultResolver::new("/".into())),
    }],
    transformers: PipelineMap(indexmap! {
      "*.{js,mjs,jsm,jsx,es6,ts,tsx,mdx}".into() => vec![PipelineNode::Plugin(Plugin::<dyn Transformer> {
        package_name: "@parcel/transformer-js".into(),
        key_path: None,
        plugin: Arc::new(JsTransformer {})
      })],
      "*.css".into() => vec![PipelineNode::Plugin(Plugin::<dyn Transformer> {
        package_name: "@parcel/transformer-css".into(),
        key_path: None,
        plugin: Arc::new(CssTransformer {})
      })],
      "*.style".into() => vec![PipelineNode::Plugin(Plugin::<dyn Transformer> {
        package_name: "@parcel/transformer-css".into(),
        key_path: None,
        plugin: Arc::new(StyleAttrTransformer {})
      })],
      "*.{html,xhtml}".into() => vec![PipelineNode::Plugin(Plugin::<dyn Transformer> {
        package_name: "@parcel/transformer-html".into(),
        key_path: None,
        plugin: Arc::new(HtmlTransformer {})
      })],
      "*.svg".into() => vec![PipelineNode::Plugin(Plugin::<dyn Transformer> {
        package_name: "@parcel/transformer-svg".into(),
        key_path: None,
        plugin: Arc::new(SvgTransformer {})
      })],
      "*.{png,jpeg,jpg,gif,webp,tiff,bmp,ico,avif}".into() => vec![PipelineNode::Plugin(Plugin::<dyn Transformer> {
        package_name: "@parcel/transformer-image".into(),
        key_path: None,
        plugin: Arc::new(ImageTransformer {})
      })],
    }),
    bundler: Plugin {
      package_name: "@parcel/bundler-default".into(),
      key_path: Some("/bundler".into()),
      plugin: Arc::new(DefaultBundler {}),
    },
    namers: vec![Plugin {
      package_name: "@parcel/namer-default".into(),
      key_path: None,
      plugin: Arc::new(DefaultNamer {}),
    }],
    runtimes: Default::default(),
    packagers: indexmap! {
      "js".into() => Plugin::<dyn Packager> {
        package_name: "@parcel/packager-js".into(),
        key_path: None,
        plugin: Arc::new(JsPackager {}),
      },
      "css".into() => Plugin::<dyn Packager> {
        package_name: "@parcel/packager-css".into(),
        key_path: None,
        plugin: Arc::new(CssPackager {}),
      },
      "style".into() => Plugin::<dyn Packager> {
        package_name: "@parcel/packager-css".into(),
        key_path: None,
        plugin: Arc::new(StyleAttrPackager {}),
      },
      "html".into() => Plugin::<dyn Packager> {
        package_name: "@parcel/packager-html".into(),
        key_path: None,
        plugin: Arc::new(HtmlPackager {}),
      },
      "xhtml".into() => Plugin::<dyn Packager> {
        package_name: "@parcel/packager-html".into(),
        key_path: None,
        plugin: Arc::new(HtmlPackager {}),
      },
      "svg".into() => Plugin::<dyn Packager> {
        package_name: "@parcel/packager-svg".into(),
        key_path: None,
        plugin: Arc::new(SvgPackager {}),
      }
    },
    optimizers: Default::default(),
    validators: Default::default(),
    compressors: Default::default(),
    reporters: Default::default(),
  };

  let options = Arc::new(ParcelOptions {
    env: HashMap::new(),
    input_fs: Arc::new(OsFileSystem {}),
    log_level: parcel_core::LogLevel::Verbose,
    mode: parcel_core::BuildMode::Development,
    project_root: SourceUrl::from_path(Path::new(
      "/Users/devongovett/dev/parcel/test", // "/Users/devongovett/dev/esbuild/require/parcel2/bench/three/",
    ))
    .unwrap(),
  });

  match build(
    // vec!["/Users/devongovett/dev/esbuild/require/parcel2/bench/three/entry.parcel2.js".into()],
    vec!["/Users/devongovett/dev/parcel/test/index.html".into()],
    Arc::new(config),
    options,
  ) {
    Ok(_) => {
      println!("SUCCESS!");
    }
    Err(_) => {
      println!("ERROR");
    }
  }
}

struct DefaultNamer {}

impl Namer for DefaultNamer {
  fn name(
    &self,
    asset_graph: &AssetGraph,
    bundle: &parcel_core::Bundle,
  ) -> Result<Option<String>, Vec<parcel_core::Diagnostic>> {
    if bundle.flags.contains(BundleFlags::NEEDS_STABLE_NAME) {
      if let Some(entry) = bundle.main_entry_asset {
        if let Some(asset) = &asset_graph.assets[entry] {
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
