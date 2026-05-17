use std::{path::Path, sync::Arc};

use parcel_core::{
  CPlugin, DefaultBundler, Diagnostic, DiagnosticList, FileSystem, Namer, Optimizer, Packager,
  ParcelConfig, PluginFactory, Transformer,
};
use parcel_css::{CssPackager, CssTransformer, StyleAttrPackager, StyleAttrTransformer};
use parcel_html::{
  HtmlPackager, HtmlTransformer, SvgPackager, SvgToJsxTransformer, SvgTransformer,
};
use parcel_image::ImageTransformer;
use parcel_js::{JsPackager, JsTransformer, LibraryPackager};
use parcel_plugin_js::JsPlugin;
use parcel_resolver::Resolution;

use crate::{
  data_url::DataUrlOptimizer, glob_resolver::GlobResolver, inline::InlineTransformer,
  json::JsonTransformer, library_bundler::LibraryBundler, namer::DefaultNamer, raw::RawTransformer,
  resolver::DefaultResolver, toml::TomlTransformer, yaml::YamlTransformer,
};

pub struct DefaultPluginFactory {
  resolver: parcel_resolver::Resolver<'static>,
}

impl DefaultPluginFactory {
  pub fn new(fs: Arc<dyn FileSystem>) -> Self {
    DefaultPluginFactory {
      resolver: parcel_resolver::Resolver::node(Path::new("/"), parcel_resolver::Cache::new(fs)),
    }
  }
}

impl PluginFactory for DefaultPluginFactory {
  fn transformer(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: &Path,
  ) -> Result<Arc<dyn Transformer>, DiagnosticList> {
    Ok(match name {
      "@parcel/transformer-js" => Arc::new(JsTransformer {}),
      "@parcel/transformer-css" => Arc::new(if let Some(config) = config {
        serde_json::from_value(config)?
      } else {
        CssTransformer::default()
      }),
      "@parcel/transformer-style-attr" => Arc::new(StyleAttrTransformer {}),
      "@parcel/transformer-html" => Arc::new(HtmlTransformer {}),
      "@parcel/transformer-svg" => Arc::new(SvgTransformer {}),
      "@parcel/transformer-svg-jsx" => Arc::new(SvgToJsxTransformer {
        config: config.map_or_else(
          || Ok(Default::default()),
          |config| serde_json::from_value(config),
        )?,
      }),
      "@parcel/transformer-image" => Arc::new(ImageTransformer {}),
      "@parcel/transformer-json" => Arc::new(JsonTransformer {}),
      "@parcel/transformer-toml" => Arc::new(TomlTransformer {}),
      "@parcel/transformer-yaml" => Arc::new(YamlTransformer {}),
      "@parcel/transformer-inline" => Arc::new(InlineTransformer {}),
      "@parcel/transformer-raw" => Arc::new(RawTransformer {}),
      "@parcel/transformer-native" => {
        if let Some(config) = config {
          if let Some(serde_json::Value::String(lib)) = config.get("lib") {
            return Ok(Arc::new(CPlugin::new(Path::new(lib))));
          }
        }
        todo!()
      }
      "@parcel/transformer-quickjs" => {
        if let Some(config) = config {
          if let Some(serde_json::Value::String(lib)) = config.get("path") {
            return Ok(Arc::new(JsPlugin::new(Path::new(lib))));
          }
        }
        todo!()
      }
      _ => {
        // TODO: possibly support exports conditions for platform (e.g. darwin, linux, x64, arm64, etc.)
        let resolved = self
          .resolver
          .resolve(name, from, parcel_resolver::SpecifierType::Esm);
        match resolved.result {
          Ok(resolution) => match resolution.resolution {
            Resolution::Path(path) => match path.extension().map(|s| s.as_encoded_bytes()) {
              Some(b"so" | b"dylib" | b"dll") => {
                return Ok(Arc::new(CPlugin::new(&path)));
              }
              _ => {
                return Ok(Arc::new(JsPlugin::new(&path)));
              }
            },
            _ => {}
          },
          _ => {}
        }

        return Err(
          Diagnostic::from_message(format!("Could not find transformer {}", name)).into(),
        );
      }
    })
  }

  fn bundler(
    &self,
    name: &str,
    _config: Option<serde_json::Value>,
    _from: &Path,
  ) -> Result<Arc<dyn parcel_core::Bundler>, DiagnosticList> {
    if name == "@parcel/bundler-default" {
      Ok(Arc::new(DefaultBundler {}))
    } else if name == "@parcel/bundler-library" {
      Ok(Arc::new(LibraryBundler {}))
    } else {
      Err(Diagnostic::from_message(format!("Could not find bundler {}", name)).into())
    }
  }

  fn namer(
    &self,
    name: &str,
    _config: Option<serde_json::Value>,
    _from: &Path,
  ) -> Result<Arc<dyn Namer>, DiagnosticList> {
    if name == "@parcel/namer-default" {
      Ok(Arc::new(DefaultNamer {}))
    } else {
      Err(Diagnostic::from_message(format!("Could not find namer {}", name)).into())
    }
  }

  fn optimizer(
    &self,
    name: &str,
    _config: Option<serde_json::Value>,
    _from: &Path,
  ) -> Result<Arc<dyn Optimizer>, DiagnosticList> {
    match name {
      "@parcel/optimizer-data-url" => Ok(Arc::new(DataUrlOptimizer {})),
      _ => {
        return Err(Diagnostic::from_message(format!("Could not find optimizer {}", name)).into());
      }
    }
  }

  fn packager(
    &self,
    name: &str,
    _config: Option<serde_json::Value>,
    _from: &Path,
  ) -> Result<Arc<dyn Packager>, DiagnosticList> {
    Ok(match name {
      "@parcel/packager-js" => Arc::new(JsPackager {}),
      "@parcel/packager-library" => Arc::new(LibraryPackager {}),
      "@parcel/packager-css" => Arc::new(CssPackager {}),
      "@parcel/packager-style-attr" => Arc::new(StyleAttrPackager {}),
      "@parcel/packager-html" => Arc::new(HtmlPackager {}),
      "@parcel/packager-svg" => Arc::new(SvgPackager {}),
      _ => {
        return Err(Diagnostic::from_message(format!("Could not find packager {}", name)).into());
      }
    })
  }

  fn resolver(
    &self,
    name: &str,
    _config: Option<serde_json::Value>,
    _from: &Path,
  ) -> Result<Arc<dyn parcel_core::Resolver>, DiagnosticList> {
    Ok(match name {
      "@parcel/resolver-default" => Arc::new(DefaultResolver::new("/".into())),
      "@parcel/resolver-glob" => Arc::new(GlobResolver {}),
      _ => {
        return Err(Diagnostic::from_message(format!("Could not find resolver {}", name)).into());
      }
    })
  }

  fn config(&self, specifier: &str, from: &Path) -> Result<ParcelConfig, DiagnosticList> {
    if specifier == "@parcel/config-default" {
      return ParcelConfig::from_json(Path::new(""), include_bytes!("default-config.json"), self);
    }

    let resolved = self
      .resolver
      .resolve(specifier, from, parcel_resolver::SpecifierType::Esm);
    match resolved.result {
      Ok(resolution) => match resolution.resolution {
        Resolution::Path(path) => {
          return ParcelConfig::read(&*self.resolver.cache().fs, &path, self);
        }
        _ => {}
      },
      _ => {}
    }

    return Err(
      Diagnostic::from_message(format!("Could not find extended config {}", specifier)).into(),
    );
  }
}
