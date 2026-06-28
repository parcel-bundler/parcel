use std::{path::Path, sync::Arc};

use parcel_core::{
  Diagnostic, DiagnosticList, FileSystem, Namer, Optimizer, ParcelConfig, PathId, PluginFactory,
  Transformer,
};
use parcel_css::{CssTransformer, StyleAttrTransformer};
use parcel_html::{HtmlTransformer, SvgToJsxTransformer, SvgTransformer};
use parcel_image::ImageTransformer;
use parcel_js::JsTransformer;
use parcel_plugin_abi::CPlugin;
use parcel_plugin_js::JsPlugin;
use parcel_resolver::Resolution;
use parcel_tailwind::TailwindTransformer;

use crate::{
  bundler::DefaultBundler, data_url::DataUrlOptimizer, glob_resolver::GlobResolver,
  inline::InlineTransformer, json::JsonTransformer, library_bundler::LibraryBundler,
  namer::DefaultNamer, raw::RawTransformer, resolver::DefaultResolver, toml::TomlTransformer,
  yaml::YamlTransformer,
};

pub struct DefaultPluginFactory {
  resolver: parcel_resolver::Resolver<'static>,
  fs: Arc<dyn FileSystem>,
}

impl DefaultPluginFactory {
  pub fn new(fs: Arc<dyn FileSystem>) -> Self {
    DefaultPluginFactory {
      resolver: parcel_resolver::Resolver::node(
        parcel_resolver::PathId::root(),
        parcel_resolver::Cache::new(),
      ),
      fs,
    }
  }
}

impl PluginFactory for DefaultPluginFactory {
  fn transformer(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: PathId,
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
      "@parcel/transformer-svg" => Arc::new(if let Some(config) = config {
        SvgTransformer {
          config: serde_json::from_value(config)?,
        }
      } else {
        SvgTransformer::default()
      }),
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
      "@parcel/transformer-tailwind" => Arc::new(TailwindTransformer {}),
      "@parcel/transformer-inline" => Arc::new(InlineTransformer {}),
      "@parcel/transformer-raw" => Arc::new(RawTransformer {}),
      "@parcel/transformer-native" => {
        if let Some(config) = config {
          if let Some(serde_json::Value::String(lib)) = config.get("lib") {
            return Ok(Arc::new(CPlugin::new(
              PathId::new(Path::new(lib)),
              Some(&config),
            )?));
          }
        }
        return Err(
          Diagnostic::from_message(format!("Could not find transformer {}", name)).into(),
        );
      }
      _ => {
        // TODO: possibly support exports conditions for platform (e.g. darwin, linux, x64, arm64, etc.)
        let resolved =
          self
            .resolver
            .resolve(name, from, parcel_resolver::SpecifierType::Esm, &*self.fs);
        match resolved {
          Ok(resolution) => match resolution.resolution {
            Resolution::Path(path) => match path.extension().map(|s| s.as_bytes()) {
              Some(b"so" | b"dylib" | b"dll") => {
                return Ok(Arc::new(CPlugin::new(path, config.as_ref())?));
              }
              _ => {
                return Ok(Arc::new(JsPlugin::new(path)));
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
    config: Option<serde_json::Value>,
    _from: PathId,
  ) -> Result<Arc<dyn parcel_core::Bundler>, DiagnosticList> {
    if name == "@parcel/bundler-default" {
      Ok(Arc::new(if let Some(config) = config {
        serde_json::from_value(config)?
      } else {
        DefaultBundler::default()
      }))
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
    _from: PathId,
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
    _from: PathId,
  ) -> Result<Arc<dyn Optimizer>, DiagnosticList> {
    match name {
      "@parcel/optimizer-data-url" => Ok(Arc::new(DataUrlOptimizer {})),
      _ => {
        return Err(Diagnostic::from_message(format!("Could not find optimizer {}", name)).into());
      }
    }
  }

  fn resolver(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: PathId,
  ) -> Result<Arc<dyn parcel_core::Resolver>, DiagnosticList> {
    Ok(match name {
      "@parcel/resolver-default" => Arc::new(DefaultResolver::new("/".into())),
      "@parcel/resolver-glob" => Arc::new(GlobResolver {}),
      "@parcel/resolver-native" => {
        if let Some(config) = config {
          if let Some(serde_json::Value::String(lib)) = config.get("lib") {
            return Ok(Arc::new(CPlugin::new(
              PathId::new(Path::new(lib)),
              Some(&config),
            )?));
          }
        }
        return Err(Diagnostic::from_message(format!("Could not find resolver {}", name)).into());
      }
      _ => {
        let resolved =
          self
            .resolver
            .resolve(name, from, parcel_resolver::SpecifierType::Esm, &*self.fs);
        match resolved {
          Ok(resolution) => match resolution.resolution {
            parcel_resolver::Resolution::Path(path)
              if matches!(
                path.extension().map(|s| s.as_bytes()),
                Some(b"so" | b"dylib" | b"dll")
              ) =>
            {
              return Ok(Arc::new(CPlugin::new(path, config.as_ref())?));
            }
            _ => {}
          },
          _ => {}
        }
        return Err(Diagnostic::from_message(format!("Could not find resolver {}", name)).into());
      }
    })
  }

  fn config(&self, specifier: &str, from: PathId) -> Result<ParcelConfig, DiagnosticList> {
    if specifier == "@parcel/config-default" {
      return ParcelConfig::from_json(PathId::root(), include_bytes!("default-config.json"), self);
    }

    let resolved = self.resolver.resolve(
      specifier,
      from,
      parcel_resolver::SpecifierType::Esm,
      &*self.fs,
    );
    match resolved {
      Ok(resolution) => match resolution.resolution {
        Resolution::Path(path) => {
          return ParcelConfig::read(&*self.fs, path, self);
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
