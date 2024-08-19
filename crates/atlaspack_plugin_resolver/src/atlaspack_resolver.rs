use std::borrow::Cow;
use std::fmt;
use std::fmt::Debug;
use std::hash::Hash;
use std::path::Path;
use std::sync::Arc;

use atlaspack_core::diagnostic_error;
use atlaspack_core::plugin::PluginContext;
use atlaspack_core::plugin::PluginOptions;
use atlaspack_core::plugin::Resolution;
use atlaspack_core::plugin::ResolveContext;
use atlaspack_core::plugin::Resolved;
use atlaspack_core::plugin::ResolvedResolution;
use atlaspack_core::plugin::ResolverPlugin;
use atlaspack_core::types::BuildMode;
use atlaspack_core::types::CodeFrame;
use atlaspack_core::types::CodeHighlight;
use atlaspack_core::types::DiagnosticBuilder;
use atlaspack_core::types::EnvironmentContext;
use atlaspack_core::types::ErrorKind;
use atlaspack_core::types::SpecifierType;
use atlaspack_resolver::Cache;
use atlaspack_resolver::CacheCow;
use atlaspack_resolver::ExportsCondition;
use atlaspack_resolver::Fields;
use atlaspack_resolver::IncludeNodeModules;
use atlaspack_resolver::PackageJsonError;
use atlaspack_resolver::ResolveOptions;
use atlaspack_resolver::Resolver;
use atlaspack_resolver::ResolverError;
use atlaspack_resolver::SpecifierError;

pub struct AtlaspackResolver {
  cache: Cache,
  options: Arc<PluginOptions>,
}

impl Debug for AtlaspackResolver {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "AtlaspackResolver")
  }
}

impl AtlaspackResolver {
  pub fn new(ctx: &PluginContext) -> Self {
    Self {
      cache: Cache::new(ctx.config.fs.clone()),
      options: Arc::clone(&ctx.options),
    }
  }

  fn to_diagnostic_error(&self, specifier: &str, error: ResolverError) -> anyhow::Error {
    let mut diagnostic = DiagnosticBuilder::default();
    let diagnostic_error = match error {
      ResolverError::FileNotFound { from, relative } => {
        // TODO: Add potential files hints
        let file = relative.display();
        let from = from
          .strip_prefix(self.options.project_root.clone())
          .unwrap_or(&from)
          .display();

        diagnostic_error!(diagnostic
          .kind(ErrorKind::NotFound)
          .message(format!("Cannot load file '{file}' in '{from}'")))
      }
      ResolverError::InvalidSpecifier(specifier_error) => {
        diagnostic_error!(diagnostic.message(match specifier_error {
          SpecifierError::EmptySpecifier => format!("Invalid specifier: {specifier}"),
          SpecifierError::InvalidFileUrl => format!("Invalid file url: {specifier}"),
          SpecifierError::InvalidPackageSpecifier =>
            format!("Invalid package specifier: {specifier}"),
          SpecifierError::UrlError(parse_error) => format!("{}: {specifier}", parse_error),
        }))
      }
      ResolverError::IOError(io_error) => {
        diagnostic_error!(diagnostic.message(format!("{}", io_error)))
      }
      ResolverError::JsonError(json_error) => diagnostic_error!(diagnostic
        .code_frames(vec![CodeFrame {
          code_highlights: vec![CodeHighlight::from([json_error.line, json_error.column])],
          ..CodeFrame::from(json_error.file)
        }])
        .message("Error parsing JSON")),
      ResolverError::ModuleEntryNotFound {
        entry_path,
        field,
        module,
        package_path,
      } => {
        let package_dir = package_path.parent().unwrap_or(&package_path);
        let specifier = package_dir.join(entry_path);
        let specifier = specifier.display();

        // TODO: Add alternative files
        diagnostic_error!(diagnostic.kind(ErrorKind::NotFound).message(format!(
          "Could not load '{specifier}' from module '{module}' found in package.json#{field}"
        )))
      }
      ResolverError::ModuleNotFound { module } => {
        // TODO: Add alternative modules
        diagnostic_error!(diagnostic
          .kind(ErrorKind::NotFound)
          .message(format!("Cannot find module '{module}'")))
      }
      ResolverError::ModuleSubpathNotFound {
        module,
        path,
        package_path,
      } => {
        // TODO: Add potential files hints
        let package_dir = package_path.parent().unwrap_or(&package_path);
        let path = path.strip_prefix(package_dir).unwrap_or(&path).display();

        diagnostic_error!(diagnostic
          .kind(ErrorKind::NotFound)
          .message(format!("Cannot load file '{path}' from module {module}")))
      }
      ResolverError::PackageJsonError {
        error,
        module,
        path,
      } => {
        match error {
          PackageJsonError::InvalidPackageTarget => {
            // TODO Exports code highlight
            diagnostic_error!(diagnostic
              .code_frames(vec![CodeFrame::from(path)])
              .message(format!("Invalid package target in the '{module}' package. Targets may not refer to files outside the package.")))
          }
          PackageJsonError::PackagePathNotExported => {
            // TODO Exports code highlight
            diagnostic_error!(diagnostic
              .code_frames(vec![CodeFrame::from(path)])
              .message(format!(
                "Module '{specifier}' is not exported from the '{module}' package"
              )))
          }
          PackageJsonError::ImportNotDefined => {
            // TODO Imports code highlight
            diagnostic_error!(diagnostic
              .code_frames(vec![CodeFrame::from(path)])
              .message(format!(
                "Package import '{specifier}' is not defined in the '{module}' package"
              )))
          }
          PackageJsonError::InvalidSpecifier => {
            diagnostic_error!(diagnostic
              .code_frames(vec![CodeFrame::from(path)])
              .message(format!("Invalid package import specifier {specifier}")))
          }
        }
      }
      ResolverError::PackageJsonNotFound { from } => diagnostic_error!(diagnostic.message(
        format!("Cannot find a package.json above '{}'", from.display())
      )),
      ResolverError::TsConfigExtendsNotFound { error, tsconfig } => {
        let source_diagnostic = self.to_diagnostic_error(specifier, *error);
        let tsconfig = tsconfig.display();

        source_diagnostic.context(diagnostic_error!(
          diagnostic.message(format!("Could not find extended tsconfig {tsconfig}"))
        ))
      }
      ResolverError::UnknownError => {
        diagnostic_error!(diagnostic.message("Encountered unknown error"))
      }
      ResolverError::UnknownScheme { scheme } => {
        diagnostic_error!(diagnostic.message(format!("Unknown url scheme or pipeline {scheme}")))
      }
    };

    diagnostic_error
  }

  pub fn resolve_simple<S: AsRef<str>>(_from: &Path, _specifier: S) {
    todo!()
  }

  fn resolve_builtin(&self, ctx: &ResolveContext, builtin: String) -> anyhow::Result<Resolved> {
    let dep = &ctx.dependency;
    if dep.env.context.is_node() {
      return Ok(Resolved {
        invalidations: Vec::new(),
        resolution: Resolution::Excluded,
      });
    }

    if dep.env.is_library && should_include_node_module(&dep.env.include_node_modules, &builtin) {
      return Ok(Resolved {
        invalidations: Vec::new(),
        resolution: Resolution::Excluded,
      });
    }

    let browser_module = match builtin.as_str() {
      "assert" => "assert/",
      "buffer" => "buffer/",
      "console" => "console-browserify",
      "constants" => "constants-browserify",
      "crypto" => "crypto-browserify",
      "domain" => "domain-browser",
      "events" => "events/",
      "http" => "stream-http",
      "https" => "https-browserify",
      "os" => "os-browserify",
      "path" => "path-browserify",
      "process" => "process/",
      "punycode" => "punycode/",
      "querystring" => "querystring-es3",
      "stream" => "stream-browserify",
      "string_decoder" => "string_decoder",
      "sys" => "util/",
      "timers" => "timers-browserify",
      "tty" => "tty-browserify",
      "url" => "url/",
      "util" => "util/",
      "vm" => "vm-browserify",
      "zlib" => "browserify-zlib",
      _ => {
        return Ok(Resolved {
          invalidations: Vec::new(),
          resolution: Resolution::Excluded,
        })
      }
    };

    self.resolve(ResolveContext {
      // TODO: Can we get rid of the clones?
      dependency: Arc::clone(&ctx.dependency),
      pipeline: ctx.pipeline.clone(),
      specifier: browser_module.to_owned(),
    })
  }
}

impl Hash for AtlaspackResolver {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    env!("CARGO_PKG_VERSION").hash(state);
    self.options.mode.hash(state);
    self.options.project_root.hash(state);
  }
}

impl ResolverPlugin for AtlaspackResolver {
  fn resolve(&self, ctx: ResolveContext) -> anyhow::Result<Resolved> {
    let mut resolver = Resolver::atlaspack(
      Cow::Borrowed(&self.options.project_root),
      CacheCow::Borrowed(&self.cache),
    );

    resolver.conditions.set(
      ExportsCondition::BROWSER,
      ctx.dependency.env.context.is_browser(),
    );
    resolver.conditions.set(
      ExportsCondition::WORKER,
      ctx.dependency.env.context.is_worker(),
    );
    resolver.conditions.set(
      ExportsCondition::WORKLET,
      ctx.dependency.env.context == EnvironmentContext::Worklet,
    );
    resolver.conditions.set(
      ExportsCondition::ELECTRON,
      ctx.dependency.env.context.is_electron(),
    );
    resolver
      .conditions
      .set(ExportsCondition::NODE, ctx.dependency.env.context.is_node());
    resolver.conditions.set(
      ExportsCondition::PRODUCTION,
      self.options.mode == BuildMode::Production,
    );
    resolver.conditions.set(
      ExportsCondition::DEVELOPMENT,
      self.options.mode == BuildMode::Development,
    );

    resolver.entries = Fields::MAIN | Fields::MODULE | Fields::SOURCE;
    if ctx.dependency.env.context.is_browser() {
      resolver.entries |= Fields::BROWSER;
    }

    resolver.include_node_modules = Cow::Borrowed(&ctx.dependency.env.include_node_modules);

    let resolve_options = ResolveOptions {
      conditions: ctx.dependency.package_conditions,
      custom_conditions: vec![],
      // TODO: Do we need custom condition?
      // custom_conditions: dep.custom_package_conditions.clone(),
    };

    let resolve_from = ctx
      .dependency
      .resolve_from
      .as_ref()
      .or(ctx.dependency.source_path.as_ref())
      .as_ref()
      .map(|p| Cow::Borrowed(p.as_path()))
      .unwrap_or_else(|| Cow::Owned(self.options.project_root.join("index")));

    let mut res = resolver.resolve_with_options(
      &ctx.specifier,
      &resolve_from,
      match ctx.dependency.specifier_type {
        SpecifierType::CommonJS => atlaspack_resolver::SpecifierType::Cjs,
        SpecifierType::Esm => atlaspack_resolver::SpecifierType::Esm,
        SpecifierType::Url => atlaspack_resolver::SpecifierType::Url,
        // TODO: what should specifier custom map to?
        SpecifierType::Custom => atlaspack_resolver::SpecifierType::Esm,
      },
      resolve_options,
    );

    let side_effects = if let Ok((atlaspack_resolver::Resolution::Path(p), _)) = &res.result {
      match resolver.resolve_side_effects(p, &res.invalidations) {
        Ok(side_effects) => side_effects,
        Err(err) => {
          res.result = Err(err);
          true
        }
      }
    } else {
      true
    };

    // TODO: Handle invalidations

    let resolution = res
      .result
      .map_err(|err| self.to_diagnostic_error(&ctx.specifier, err))?;

    match resolution {
      (atlaspack_resolver::Resolution::Path(path), _invalidations) => Ok(Resolved {
        invalidations: Vec::new(),
        resolution: Resolution::Resolved(ResolvedResolution {
          file_path: path,
          side_effects,
          ..ResolvedResolution::default()
        }),
      }),
      (atlaspack_resolver::Resolution::Builtin(builtin), _invalidations) => {
        self.resolve_builtin(&ctx, builtin)
      }
      (atlaspack_resolver::Resolution::Empty, _invalidations) => Ok(Resolved {
        invalidations: Vec::new(),
        resolution: Resolution::Resolved(ResolvedResolution {
          file_path: self
            .options
            .project_root
            .join("packages/utils/node-resolver-core/src/_empty.js"),
          side_effects,
          ..ResolvedResolution::default()
        }),
      }),
      (atlaspack_resolver::Resolution::External, _invalidations) => {
        if let Some(_source_path) = &ctx.dependency.source_path {
          if ctx.dependency.env.is_library && ctx.dependency.specifier_type != SpecifierType::Url {
            todo!("check excluded dependency for libraries");
          }
        }

        Ok(Resolved {
          invalidations: Vec::new(),
          resolution: Resolution::Excluded,
        })
      }
      (atlaspack_resolver::Resolution::Global(global), _invalidations) => Ok(Resolved {
        invalidations: Vec::new(),
        resolution: Resolution::Resolved(ResolvedResolution {
          code: Some(format!("module.exports={};", global)),
          file_path: format!("{}.js", global).into(),
          side_effects,
          ..ResolvedResolution::default()
        }),
      }),
    }
  }
}

fn should_include_node_module(include_node_modules: &IncludeNodeModules, name: &str) -> bool {
  match include_node_modules {
    IncludeNodeModules::Bool(b) => *b,
    IncludeNodeModules::Array(arr) => {
      let Ok((module, _)) = atlaspack_resolver::parse_package_specifier(name) else {
        return true;
      };

      arr.iter().any(|m| m.as_str() == module)
    }
    IncludeNodeModules::Map(map) => {
      let Ok((module, _)) = atlaspack_resolver::parse_package_specifier(name) else {
        return true;
      };

      map.contains_key(module)
    }
  }
}

#[cfg(test)]
mod test {
  use super::*;
  use atlaspack_core::{
    config_loader::ConfigLoader,
    plugin::PluginLogger,
    types::{Dependency, Diagnostic, ErrorKind},
  };
  use atlaspack_filesystem::in_memory_file_system::InMemoryFileSystem;
  use std::path::PathBuf;

  fn plugin_context(fs: InMemoryFileSystem) -> PluginContext {
    PluginContext {
      config: Arc::new(ConfigLoader {
        fs: Arc::new(fs),
        project_root: PathBuf::default(),
        search_path: PathBuf::default(),
      }),
      file_system: Arc::new(InMemoryFileSystem::default()),
      logger: PluginLogger::default(),
      options: Arc::new(PluginOptions::default()),
    }
  }

  fn resolve_context(specifier: &str) -> ResolveContext {
    ResolveContext {
      dependency: Arc::new(Dependency {
        specifier: specifier.into(),
        ..Dependency::default()
      }),
      pipeline: None,
      specifier: specifier.into(),
    }
  }

  #[test]
  fn returns_module_not_found_error_diagnostic() {
    let plugin_context = plugin_context(InMemoryFileSystem::default());
    let resolver = AtlaspackResolver::new(&plugin_context);
    let ctx = resolve_context("foo.js");

    let err = resolver
      .resolve(ctx)
      .expect_err("Expected resolution to fail")
      .downcast::<Diagnostic>()
      .expect("Expected error to be a diagnostic");

    assert_eq!(
      err,
      Diagnostic {
        code_frames: Vec::new(),
        documentation_url: None,
        kind: ErrorKind::NotFound,
        hints: Vec::new(),
        message: String::from("Cannot find module 'foo.js'"),
        origin: Some(String::from(
          "atlaspack_plugin_resolver::atlaspack_resolver"
        ))
      }
    );
  }

  #[test]
  fn returns_package_json_error_diagnostic() {
    let fs = InMemoryFileSystem::default();
    let package_path = Path::new("node_modules").join("foo").join("package.json");

    fs.write_file(
      &package_path,
      String::from(r#"{ "name": "foo", "exports": {} }"#),
    );

    let plugin_context = plugin_context(fs);
    let resolver = AtlaspackResolver::new(&plugin_context);
    let ctx = resolve_context("foo/bar");

    let err = resolver
      .resolve(ctx)
      .expect_err("Expected resolution to fail")
      .downcast::<Diagnostic>()
      .expect("Expected error to be a diagnostic");

    assert_eq!(
      err,
      Diagnostic {
        code_frames: vec![CodeFrame::from(package_path)],
        documentation_url: None,
        hints: Vec::new(),
        kind: ErrorKind::Unknown,
        message: String::from("Module 'foo/bar' is not exported from the 'foo' package"),
        origin: Some(String::from(
          "atlaspack_plugin_resolver::atlaspack_resolver"
        ))
      }
    );
  }

  #[test]
  fn returns_resolution() {
    let fs = Arc::new(InMemoryFileSystem::default());

    fs.write_file(Path::new("/foo/index.js"), String::default());
    fs.write_file(Path::new("/foo/something.js"), String::default());

    let plugin_context = PluginContext {
      config: Arc::new(ConfigLoader {
        fs,
        project_root: PathBuf::default(),
        search_path: PathBuf::from("/foo"),
      }),
      file_system: Arc::new(InMemoryFileSystem::default()),
      logger: PluginLogger::default(),
      options: Arc::new(PluginOptions::default()),
    };

    let resolver = AtlaspackResolver::new(&plugin_context);
    let specifier = String::from("./something.js");

    let ctx = ResolveContext {
      dependency: Arc::new(Dependency {
        resolve_from: Some(PathBuf::from("/foo/index.js")),
        specifier: specifier.clone(),
        ..Dependency::default()
      }),
      pipeline: None,
      specifier,
    };

    let result = resolver.resolve(ctx).map_err(|err| err.to_string());

    #[cfg(target_os = "windows")]
    let file_path = PathBuf::from("C:/foo/something.js");
    #[cfg(not(target_os = "windows"))]
    let file_path = PathBuf::from("/foo/something.js");
    assert_eq!(
      result,
      Ok(Resolved {
        invalidations: Vec::new(),
        resolution: Resolution::Resolved(ResolvedResolution {
          can_defer: false,
          code: None,
          file_path,
          meta: None,
          pipeline: None,
          priority: None,
          query: None,
          side_effects: true,
        })
      })
    )
  }
}
