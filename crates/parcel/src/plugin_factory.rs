use std::{path::Path, sync::Arc};

use parcel_core::{
  CPlugin, DefaultBundler, Namer, Optimizer, Packager, ParcelConfig, PluginFactory, Transformer,
};
use parcel_css::{CssPackager, CssTransformer, StyleAttrPackager, StyleAttrTransformer};
use parcel_html::{
  HtmlPackager, HtmlTransformer, SvgPackager, SvgToJsxTransformer, SvgTransformer,
};
use parcel_image::ImageTransformer;
use parcel_js::{JsPackager, JsTransformer, LibraryPackager};
use parcel_plugin_js::JsPlugin;

use crate::{
  data_url::DataUrlOptimizer, glob_resolver::GlobResolver, inline::InlineTransformer,
  json::JsonTransformer, library_bundler::LibraryBundler, namer::DefaultNamer, raw::RawTransformer,
  resolver::DefaultResolver, toml::TomlTransformer, yaml::YamlTransformer,
};

pub struct DefaultPluginFactory {}

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
      "@parcel/transformer-svg-jsx" => Arc::new(SvgToJsxTransformer {
        config: config.map_or_else(
          || Default::default(),
          |config| serde_json::from_value(config).unwrap(),
        ),
      }),
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
    match name {
      "@parcel/resolver-default" => Arc::new(DefaultResolver::new("/".into())),
      "@parcel/resolver-glob" => Arc::new(GlobResolver {}),
      _ => todo!(),
    }
  }

  fn config(&self, specifier: &str) -> ParcelConfig {
    todo!()
  }
}
