use std::{path::Path, sync::Arc};

use parcel_core::{
  Diagnostic, DiagnosticList, FileKind, FileSystem, Namer, Optimizer, ParcelConfig, PathId,
  PluginFactory, Transformer,
};
use parcel_css::{CssTransformer, StyleAttrTransformer};
use parcel_html::{HtmlTransformer, SvgToJsxTransformer, SvgTransformer};
use parcel_image::ImageTransformer;
use parcel_js::JsTransformer;
use parcel_plugin_abi::{
  CPlugin,
  manifest::{PLUGIN_ABI_VERSION, PluginPackage, TARGET},
};
use parcel_plugin_js::JsPlugin;
use parcel_resolver::{Resolution, Specifier, SpecifierType};
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
      resolver: parcel_resolver::Resolver::node(parcel_resolver::PathId::root()),
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
      "@parcel/transformer-js" => Arc::new(if let Some(config) = config {
        serde_json::from_value(config)?
      } else {
        JsTransformer::default()
      }),
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
      _ => match self.resolve_plugin("transformer", name, from, config)? {
        ResolvedPlugin::Native(plugin) => plugin,
        ResolvedPlugin::Js(plugin) => plugin,
      },
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
    config: Option<serde_json::Value>,
    from: PathId,
  ) -> Result<Arc<dyn Namer>, DiagnosticList> {
    match name {
      "@parcel/namer-default" => Ok(Arc::new(DefaultNamer {})),
      _ => Ok(match self.resolve_plugin("namer", name, from, config)? {
        ResolvedPlugin::Native(plugin) => plugin,
        ResolvedPlugin::Js(plugin) => plugin,
      }),
    }
  }

  fn optimizer(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: PathId,
  ) -> Result<Arc<dyn Optimizer>, DiagnosticList> {
    match name {
      "@parcel/optimizer-data-url" => Ok(Arc::new(DataUrlOptimizer {})),
      _ => Ok(
        match self.resolve_plugin("optimizer", name, from, config)? {
          ResolvedPlugin::Native(plugin) => plugin,
          ResolvedPlugin::Js(plugin) => plugin,
        },
      ),
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
      _ => match self.resolve_plugin("resolver", name, from, config)? {
        ResolvedPlugin::Native(plugin) => plugin,
        ResolvedPlugin::Js(plugin) => plugin,
      },
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

/// A plugin implementation loaded from disk, before it is coerced to the plugin
/// trait a particular call site needs. Both variants implement every plugin trait.
enum ResolvedPlugin {
  Native(Arc<CPlugin>),
  Js(Arc<JsPlugin>),
}

impl DefaultPluginFactory {
  /// Resolves a plugin specifier to either a native (shared library) or JavaScript
  /// plugin. `kind` names the plugin type for error messages, e.g. "transformer".
  fn resolve_plugin(
    &self,
    kind: &str,
    name: &str,
    from: PathId,
    config: Option<serde_json::Value>,
  ) -> Result<ResolvedPlugin, DiagnosticList> {
    // Only a bare package specifier can name a native plugin. Its entry point is a
    // shared library recorded in package.json, which module resolution cannot find,
    // so the package is looked up directly instead of being resolved.
    if let Ok((Specifier::Package(module, subpath), _)) =
      Specifier::parse(name, SpecifierType::Esm, self.resolver.flags)
    {
      if subpath.is_empty() {
        if let Some(plugin) = self.resolve_native_plugin(&module, from, config.as_ref())? {
          return Ok(ResolvedPlugin::Native(plugin));
        }
      }
    }

    let not_found = || -> DiagnosticList {
      Diagnostic::from_message(format!("Could not find {} {}", kind, name)).into()
    };

    let Ok(resolved) = self
      .resolver
      .resolve(name, from, SpecifierType::Esm, &*self.fs)
    else {
      return Err(not_found());
    };

    let Resolution::Path(path) = resolved.resolution else {
      return Err(not_found());
    };

    match path.extension().map(|s| s.as_bytes()) {
      // A path to a shared library, e.g. one a plugin author built locally.
      Some(b"so" | b"dylib" | b"dll") => Ok(ResolvedPlugin::Native(Arc::new(CPlugin::new(
        path,
        config.as_ref(),
      )?))),
      _ => Ok(ResolvedPlugin::Js(Arc::new(JsPlugin::new(path, config)))),
    }
  }

  /// Loads the shared library of a native plugin package.
  ///
  /// Returns `Ok(None)` when `module` is not a native plugin — it may not exist at
  /// all, or be an ordinary JavaScript plugin — so that the caller falls back to
  /// resolving it as a module. Once a package is known to be native, every further
  /// failure is reported, since no fallback could succeed.
  fn resolve_native_plugin(
    &self,
    module: &str,
    from: PathId,
    config: Option<&serde_json::Value>,
  ) -> Result<Option<Arc<CPlugin>>, DiagnosticList> {
    let Some((dir, package)) = self.read_plugin_package(module, from) else {
      return Ok(None);
    };

    if !package.is_native_plugin() {
      return Ok(None);
    }

    if package.parcel.abi != Some(PLUGIN_ABI_VERSION) {
      let abi = package.parcel.abi.map_or_else(
        || "an unknown ABI".to_string(),
        |abi| format!("ABI {}", abi),
      );
      return Err(
        Diagnostic::from_message(format!(
          "{} was built for {}, but this version of Parcel supports ABI {}",
          module, abi, PLUGIN_ABI_VERSION
        ))
        .into(),
      );
    }

    let Some(artifact) = package.artifact() else {
      return Err(
        Diagnostic::from_message(format!(
          "{} does not support {}. It supports: {}",
          module,
          TARGET,
          package
            .parcel
            .artifacts
            .keys()
            .cloned()
            .collect::<Vec<_>>()
            .join(", ")
        ))
        .into(),
      );
    };

    // An artifact is either a package to install per platform, or a path relative to
    // the plugin itself — simpler for a plugin small enough to ship every platform
    // in one package.
    let path = match Specifier::parse(artifact, SpecifierType::Esm, self.resolver.flags) {
      Ok((Specifier::Relative(library), _)) => {
        let path = dir.join(&library);
        if !self.fs.kind(path).contains(FileKind::IS_FILE) {
          return Err(
            Diagnostic::from_message(format!(
              "{} declares {} as its library for {}, but that file does not exist",
              module, artifact, TARGET
            ))
            .into(),
          );
        }
        path
      }
      _ => self.resolve_artifact_package(module, artifact, dir)?,
    };

    Ok(Some(Arc::new(CPlugin::new(path, config)?)))
  }

  /// Resolves the library of a platform-specific artifact package.
  fn resolve_artifact_package(
    &self,
    module: &str,
    artifact: &str,
    plugin_dir: PathId,
  ) -> Result<PathId, DiagnosticList> {
    // Resolved from the plugin's own package.json so that the artifact package is
    // found whether the package manager hoisted it or nested it under the plugin.
    let Some((dir, package)) = self.read_plugin_package(artifact, plugin_dir.child("package.json"))
    else {
      return Err(
        Diagnostic::from_message(format!(
          "{} is installed, but its binary for {} is not. Install {}, which npm may have skipped as an optional dependency.",
          module, TARGET, artifact
        ))
        .into(),
      );
    };

    let Some(library) = &package.parcel.library else {
      return Err(
        Diagnostic::from_message(format!(
          "{} does not specify a \"parcel\".\"library\" to load",
          artifact
        ))
        .into(),
      );
    };

    Ok(dir.join(Path::new(library)))
  }

  /// Reads the plugin metadata of a package in node_modules, if it has any.
  ///
  /// A package.json that does not parse is treated as "not a plugin package" rather
  /// than as an error: the `parcel` key is shared with unrelated configuration, and
  /// resolving the specifier as a module reports its own diagnostics.
  fn read_plugin_package(&self, module: &str, from: PathId) -> Option<(PathId, PluginPackage)> {
    let dir = self
      .resolver
      .resolve_package_dir(module, from, &*self.fs)
      .ok()?;
    let contents = self.fs.read_to_string(dir.child("package.json")).ok()?;
    let package = PluginPackage::parse(&contents).ok()?;
    Some((dir, package))
  }
}
