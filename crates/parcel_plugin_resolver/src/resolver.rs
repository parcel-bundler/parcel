use std::borrow::Cow;
use std::fmt;
use std::fmt::Debug;
use std::hash::Hash;
use std::path::Path;
use std::sync::Arc;

use parcel_core::plugin::PluginContext;
use parcel_core::plugin::PluginOptions;
use parcel_core::plugin::Resolution;
use parcel_core::plugin::ResolveContext;
use parcel_core::plugin::Resolved;
use parcel_core::plugin::ResolvedResolution;
use parcel_core::plugin::ResolverPlugin;
use parcel_core::types::BuildMode;
use parcel_core::types::EnvironmentContext;
use parcel_core::types::SpecifierType;
use parcel_resolver::Cache;
use parcel_resolver::CacheCow;
use parcel_resolver::ExportsCondition;
use parcel_resolver::Fields;
use parcel_resolver::IncludeNodeModules;
use parcel_resolver::ResolveOptions;
use parcel_resolver::Resolver;

pub struct ParcelResolver {
  cache: Cache,
  options: Arc<PluginOptions>,
}

impl Debug for ParcelResolver {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "ParcelResolver")
  }
}

impl ParcelResolver {
  pub fn new(ctx: &PluginContext) -> Self {
    Self {
      cache: Cache::new(ctx.config.fs.clone()),
      options: Arc::clone(&ctx.options),
    }
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

impl Hash for ParcelResolver {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    env!("CARGO_PKG_VERSION").hash(state);
    self.options.mode.hash(state);
    self.options.project_root.hash(state);
  }
}

impl ResolverPlugin for ParcelResolver {
  fn resolve(&self, ctx: ResolveContext) -> anyhow::Result<Resolved> {
    let mut resolver = Resolver::parcel(
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

    let resolver_options = ResolveOptions {
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
        SpecifierType::CommonJS => parcel_resolver::SpecifierType::Cjs,
        SpecifierType::Esm => parcel_resolver::SpecifierType::Esm,
        SpecifierType::Url => parcel_resolver::SpecifierType::Url,
        // TODO: what should specifier custom map to?
        SpecifierType::Custom => parcel_resolver::SpecifierType::Esm,
      },
      resolver_options,
    );

    let side_effects = if let Ok((parcel_resolver::Resolution::Path(p), _)) = &res.result {
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

    // TODO: Create diagnostics from errors
    // TODO: Handle invalidations

    match res.result? {
      (parcel_resolver::Resolution::Path(path), _invalidations) => Ok(Resolved {
        invalidations: Vec::new(),
        resolution: Resolution::Resolved(ResolvedResolution {
          file_path: path,
          side_effects,
          ..ResolvedResolution::default()
        }),
      }),
      (parcel_resolver::Resolution::Builtin(builtin), _invalidations) => {
        self.resolve_builtin(&ctx, builtin)
      }
      (parcel_resolver::Resolution::Empty, _invalidations) => Ok(Resolved {
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
      (parcel_resolver::Resolution::External, _invalidations) => {
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
      (parcel_resolver::Resolution::Global(global), _invalidations) => Ok(Resolved {
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
      let Ok((module, _)) = parcel_resolver::parse_package_specifier(name) else {
        return true;
      };

      arr.iter().any(|m| m.as_str() == module)
    }
    IncludeNodeModules::Map(map) => {
      let Ok((module, _)) = parcel_resolver::parse_package_specifier(name) else {
        return true;
      };

      map.contains_key(module)
    }
  }
}

#[cfg(test)]
mod test {
  use super::*;
  use parcel_core::{
    config_loader::ConfigLoader,
    plugin::{PluginLogger, PluginOptions},
    types::Dependency,
  };
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;
  use std::{path::PathBuf, sync::Arc};

  #[test]
  fn test_resolver() {
    let fs = Arc::new(InMemoryFileSystem::default());

    fs.write_file(Path::new("/foo/index.js"), "contents".to_string());
    fs.write_file(Path::new("/foo/something.js"), "contents".to_string());

    let plugin_context = PluginContext {
      config: Arc::new(ConfigLoader {
        fs,
        project_root: PathBuf::default(),
        search_path: PathBuf::from("/foo"),
      }),
      options: Arc::new(PluginOptions::default()),
      logger: PluginLogger::default(),
    };

    let resolver = ParcelResolver::new(&plugin_context);
    let specifier = String::from("./something.js");

    let ctx = ResolveContext {
      specifier: specifier.clone(),
      dependency: Arc::new(Dependency {
        resolve_from: Some(PathBuf::from("/foo/index.js")),
        specifier,
        ..Dependency::default()
      }),
      pipeline: None,
    };

    let result = resolver.resolve(ctx).map_err(|err| err.to_string());

    assert_eq!(
      result,
      Ok(Resolved {
        invalidations: Vec::new(),
        resolution: Resolution::Resolved(ResolvedResolution {
          can_defer: false,
          code: None,
          file_path: PathBuf::from("/foo/something.js"),
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
