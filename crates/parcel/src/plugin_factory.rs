use std::{
  path::Path,
  sync::{Arc, Mutex},
};

use parcel_core::{
  AssetType, CodeFrame, CodeHighlight, Diagnostic, DiagnosticList, DiagnosticSeverity, FileKind,
  FileSystem, JsonSourceLocationType, Namer, Optimizer, ParcelConfig, PathId, PluginFactory,
  Reporter, SourceUrl, Transformer, json_source_location,
};
use parcel_css::{CssTransformer, StyleAttrTransformer};
use parcel_html::{HtmlTransformer, SvgToJsxTransformer, SvgTransformer, XmlTransformer};
use parcel_image::ImageTransformer;
use parcel_js::JsTransformer;
use parcel_plugin_abi::{
  CPlugin, PARCEL_ABI_VERSION,
  manifest::{PluginPackage, TARGET},
};
use parcel_plugin_js::JsPlugin;
use parcel_resolver::{Resolution, Specifier, SpecifierType};
use parcel_tailwind::TailwindTransformer;

use crate::{
  bundler::DefaultBundler, data_url::DataUrlOptimizer, glob_resolver::GlobResolver,
  inline::InlineTransformer, json::JsonTransformer, jsonld::JsonLdTransformer,
  library_bundler::LibraryBundler, namer::DefaultNamer, raw::RawTransformer,
  resolver::DefaultResolver, toml::TomlTransformer, webmanifest::WebManifestTransformer,
  yaml::YamlTransformer,
};

/// The version of Parcel that plugins' `engines.parcel` ranges are checked against.
///
/// Release builds are given the version they are published as. Any other build
/// counts as the earliest 3.0.0 prerelease, so it accepts plugins that accept
/// every Parcel 3 prerelease, as `^3.0.0-0` does.
pub const PARCEL_VERSION: &str = match option_env!("PARCEL_VERSION") {
  Some(version) if !version.is_empty() => version,
  _ => "3.0.0-0",
};

pub struct DefaultPluginFactory {
  resolver: parcel_resolver::Resolver<'static>,
  fs: Arc<dyn FileSystem>,
  warnings: Mutex<Vec<Diagnostic>>,
}

impl DefaultPluginFactory {
  pub fn new(fs: Arc<dyn FileSystem>) -> Self {
    DefaultPluginFactory {
      resolver: parcel_resolver::Resolver::node(parcel_resolver::PathId::root()),
      fs,
      warnings: Mutex::new(Vec::new()),
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
      "@parcel/transformer-html" => Arc::new(if let Some(config) = config {
        serde_json::from_value(config)?
      } else {
        HtmlTransformer::default()
      }),
      "@parcel/transformer-xml" => Arc::new(XmlTransformer {}),
      "@parcel/transformer-svg" => Arc::new(if let Some(config) = config {
        serde_json::from_value::<SvgTransformer>(config)?
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
      "@parcel/transformer-jsonld" => Arc::new(JsonLdTransformer {}),
      "@parcel/transformer-webmanifest" => Arc::new(WebManifestTransformer {}),
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

  fn reporter(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: PathId,
  ) -> Result<Arc<dyn Reporter>, DiagnosticList> {
    Ok(match self.resolve_plugin("reporter", name, from, config)? {
      ResolvedPlugin::Native(plugin) => plugin,
      ResolvedPlugin::Js(plugin) => plugin,
    })
  }

  fn config(&self, specifier: &str, from: PathId) -> Result<ParcelConfig, DiagnosticList> {
    if specifier == "@parcel/config-default" {
      return ParcelConfig::from_json(PathId::root(), include_bytes!("default-config.json"), self);
    }

    if let Ok((Specifier::Package(module, _), _)) =
      Specifier::parse(specifier, SpecifierType::Esm, self.resolver.flags)
    {
      if let Some((dir, package)) = self.read_plugin_package(&module, from) {
        self.check_engines(PackageKind::Config, specifier, dir, &package)?;
      }
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

  fn take_warnings(&self) -> Vec<Diagnostic> {
    std::mem::take(&mut *self.warnings.lock().unwrap())
  }
}

#[derive(Clone, Copy, PartialEq)]
enum PackageKind {
  Plugin,
  Config,
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
    // Plugins installed as packages declare the Parcel versions they support. Only
    // a bare package specifier can name a native plugin: its entry point is a shared
    // library recorded in package.json, which module resolution cannot find, so the
    // package is looked up directly instead of being resolved.
    if let Ok((Specifier::Package(module, subpath), _)) =
      Specifier::parse(name, SpecifierType::Esm, self.resolver.flags)
    {
      if let Some((dir, package)) = self.read_plugin_package(&module, from) {
        self.check_engines(PackageKind::Plugin, name, dir, &package)?;
        if subpath.is_empty() && package.is_native_plugin() {
          return Ok(ResolvedPlugin::Native(self.load_native_plugin(
            &module,
            dir,
            &package,
            config.as_ref(),
          )?));
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
        name,
        config.as_ref(),
      )?))),
      _ => Ok(ResolvedPlugin::Js(Arc::new(JsPlugin::new(
        path, name, config,
      )))),
    }
  }

  /// Checks a package's `engines.parcel` range against this version of Parcel.
  ///
  /// A range that is not satisfied, or not valid, is an error. A plugin with no
  /// range at all is only warned about, as in Parcel 2: nothing is known to be
  /// wrong with it. Config packages were never checked by Parcel 2, so a missing
  /// range is not worth a warning for them.
  fn check_engines(
    &self,
    kind: PackageKind,
    name: &str,
    dir: PathId,
    package: &PluginPackage,
  ) -> Result<(), DiagnosticList> {
    let kind_name = match kind {
      PackageKind::Plugin => "plugin",
      PackageKind::Config => "config",
    };

    let Some(range) = &package.engines.parcel else {
      if kind == PackageKind::Plugin {
        let mut warnings = self.warnings.lock().unwrap();
        let message = format!(
          "The plugin \"{}\" needs to specify a `package.json#engines.parcel` field with the supported Parcel version range.",
          name
        );
        // A plugin may be named in more than one pipeline.
        if !warnings.iter().any(|warning| warning.message == message) {
          warnings.push(Diagnostic {
            origin: Some("@parcel/core".into()),
            severity: DiagnosticSeverity::Warning,
            ..Diagnostic::from_message(message)
          });
        }
      }
      return Ok(());
    };

    if satisfies(PARCEL_VERSION, range) {
      return Ok(());
    }

    let mut diagnostic = Diagnostic {
      origin: Some("@parcel/core".into()),
      ..Diagnostic::from_message(format!(
        "The {} \"{}\" is not compatible with the current version of Parcel. Requires \"{}\" but the current version is \"{}\".",
        kind_name, name, range, PARCEL_VERSION
      ))
    };
    diagnostic
      .code_frames
      .extend(self.package_json_code_frame(dir, "/engines/parcel"));
    Err(diagnostic.into())
  }

  /// A code frame highlighting the value at `pointer` in a package's package.json.
  fn package_json_code_frame(&self, dir: PathId, pointer: &str) -> Option<CodeFrame> {
    let path = dir.child("package.json");
    let code = self.fs.read_to_string(path).ok()?;
    let (start, end) =
      json_source_location(&code, pointer, JsonSourceLocationType::Value).ok()??;
    Some(CodeFrame {
      code: Some(code),
      url: Some(SourceUrl::from_path(&path)),
      language: Some(AssetType::Json),
      code_highlights: vec![CodeHighlight::from_json(start, end, None)],
    })
  }

  /// Loads the shared library of a native plugin package. Every failure is
  /// reported, since no fallback to resolving it as a module could succeed.
  fn load_native_plugin(
    &self,
    module: &str,
    dir: PathId,
    package: &PluginPackage,
    config: Option<&serde_json::Value>,
  ) -> Result<Arc<CPlugin>, DiagnosticList> {
    if package.parcel.abi != Some(PARCEL_ABI_VERSION) {
      let abi = package.parcel.abi.map_or_else(
        || "an unknown ABI".to_string(),
        |abi| format!("ABI {}", abi),
      );
      return Err(
        Diagnostic {
          origin: Some("@parcel/core".into()),
          hints: vec![format!(
            "Install a version of {} that supports ABI {}, or rebuild it against the SDK matching this version of Parcel.",
            module, PARCEL_ABI_VERSION
          )],
          code_frames: self
            .package_json_code_frame(dir, "/parcel/abi")
            .into_iter()
            .collect(),
          ..Diagnostic::from_message(format!(
            "{} was built for {}, but this version of Parcel supports ABI {}",
            module, abi, PARCEL_ABI_VERSION
          ))
        }
        .into(),
      );
    }

    // A locally built library wins over the published artifacts outright. The key
    // does not survive publishing, so a package that has it is a working tree, and
    // treating it as a fallback would only muddy the "artifact not installed"
    // diagnostic below.
    if let Some(library) = package.dev_library() {
      let path = dir.join(Path::new(&library));
      if !self.fs.kind(path).contains(FileKind::IS_FILE) {
        return Err(
          Diagnostic::from_message(format!(
            "{} declares `parcel.devLibrary` {:?}, but {:?} does not exist. Build the plugin first.",
            module,
            package.parcel.dev_library.as_deref().unwrap_or_default(),
            path
          ))
          .into(),
        );
      }
      return Ok(Arc::new(CPlugin::new(path, module, config)?));
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

    Ok(Arc::new(CPlugin::new(path, module, config)?))
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
    let dir = self.fs.canonicalize(dir).ok()?;
    let contents = self.fs.read_to_string(dir.child("package.json")).ok()?;
    let package = PluginPackage::parse(&contents).ok()?;
    Some((dir, package))
  }
}

/// Whether `version` satisfies the npm semver `range`. As in npm, a prerelease
/// version only satisfies a range that names a prerelease of the same release, so
/// `^3.0.0-0` accepts 3.0.0-alpha.1 but `^3.0.0` and `3.x` do not.
fn satisfies(version: &str, range: &str) -> bool {
  let Ok(version) = node_semver::Version::parse(version) else {
    return false;
  };
  node_semver::Range::parse(range).is_ok_and(|range| range.satisfies(&version))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn checks_engines_ranges_like_npm() {
    assert!(satisfies(PARCEL_VERSION, "^3.0.0-0"));
    for version in ["3.0.0-alpha.1", "3.0.0-beta.2", "3.0.0", "3.4.1"] {
      assert!(satisfies(version, "^3.0.0-0"), "{version}");
      assert!(satisfies(version, ">= 3.0.0-0"), "{version}");
      assert!(!satisfies(version, "2.x"), "{version}");
      assert!(!satisfies(version, "^2.0.0"), "{version}");
    }
    assert!(!satisfies("3.0.0-alpha.1", "^3.0.0"));
    assert!(!satisfies("3.0.0-alpha.1", "3.x"));
    assert!(satisfies("3.0.0", "3.x"));
    assert!(satisfies("3.0.0-alpha.2", "^3.0.0-alpha.1"));
    assert!(!satisfies("3.0.0-alpha.1", "^3.0.0-alpha.2"));
    assert!(!satisfies("3.0.0", "not a range"));
  }
}
