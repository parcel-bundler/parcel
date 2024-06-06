use std::borrow::Cow;
use std::path::Path;
use std::path::PathBuf;

use parcel_core::plugin::PluginContext;
use parcel_core::plugin::Resolution;
use parcel_core::plugin::ResolveContext;
use parcel_core::plugin::ResolverPlugin;
use parcel_core::types::BuildMode;
use parcel_core::types::EnvironmentContext;
use parcel_core::types::JSONObject;
use parcel_core::types::SpecifierType;
use parcel_resolver::Cache;
use parcel_resolver::CacheCow;
use parcel_resolver::ExportsCondition;
use parcel_resolver::Fields;
use parcel_resolver::IncludeNodeModules;
use parcel_resolver::ResolveOptions;
use parcel_resolver::Resolver;

#[derive(Debug)]
pub struct ParcelResolver {
  cache: Cache,
  // TODO: These should probably be references instead?
  project_root: PathBuf,
  mode: BuildMode,
}

impl ParcelResolver {
  pub fn new(ctx: &PluginContext) -> Self {
    Self {
      cache: Cache::new(ctx.config.fs.clone()),
      project_root: ctx.config.project_root.clone(),
      mode: ctx.options.mode.clone(),
    }
  }

  pub fn resolve_simple<S: AsRef<str>>(_from: &Path, _specifier: S) {
    todo!()
  }

  fn resolve_builtin(&self, ctx: &ResolveContext, builtin: String) -> anyhow::Result<Resolution> {
    let dep = &ctx.dependency;
    if dep.env.context.is_node() {
      return Ok(excluded_resolution());
    }

    if dep.env.is_library && should_include_node_module(&dep.env.include_node_modules, &builtin) {
      return Ok(excluded_resolution());
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
      _ => return Ok(excluded_resolution()),
    };

    self.resolve(&ResolveContext {
      // TODO: Can we get rid of the clones?
      dependency: ctx.dependency.clone(),
      pipeline: ctx.pipeline.clone(),
      specifier: browser_module.to_owned(),
    })
  }
}

impl ResolverPlugin for ParcelResolver {
  fn resolve(&self, ctx: &ResolveContext) -> anyhow::Result<Resolution> {
    let ResolveContext {
      specifier,
      dependency: dep,
      pipeline: _pipeline,
    } = ctx;
    let mut resolver = Resolver::parcel(
      Cow::Borrowed(&self.project_root),
      CacheCow::Borrowed(&self.cache),
    );

    resolver
      .conditions
      .set(ExportsCondition::BROWSER, dep.env.context.is_browser());
    resolver
      .conditions
      .set(ExportsCondition::WORKER, dep.env.context.is_worker());
    resolver.conditions.set(
      ExportsCondition::WORKLET,
      dep.env.context == EnvironmentContext::Worklet,
    );
    resolver
      .conditions
      .set(ExportsCondition::ELECTRON, dep.env.context.is_electron());
    resolver
      .conditions
      .set(ExportsCondition::NODE, dep.env.context.is_node());
    resolver.conditions.set(
      ExportsCondition::PRODUCTION,
      self.mode == BuildMode::Production,
    );
    resolver.conditions.set(
      ExportsCondition::DEVELOPMENT,
      self.mode == BuildMode::Development,
    );

    resolver.entries = Fields::MAIN | Fields::MODULE | Fields::SOURCE;
    if dep.env.context.is_browser() {
      resolver.entries |= Fields::BROWSER;
    }

    resolver.include_node_modules = Cow::Borrowed(&dep.env.include_node_modules);

    let resolver_options = ResolveOptions {
      conditions: dep.package_conditions,
      custom_conditions: vec![],
      // TODO: Do we need custom condition?
      // custom_conditions: dep.custom_package_conditions.clone(),
    };

    let resolve_from = dep
      .resolve_from
      .as_ref()
      .or(dep.source_path.as_ref())
      .as_ref()
      .map(|p| Cow::Borrowed(p.as_path()))
      .unwrap_or_else(|| Cow::Owned(self.project_root.join("index")));

    let mut res = resolver.resolve_with_options(
      specifier,
      &resolve_from,
      match dep.specifier_type {
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
      (parcel_resolver::Resolution::Path(path), _invalidations) => Ok(Resolution {
        file_path: path,
        side_effects,
        can_defer: false,
        code: None,
        is_excluded: false,
        meta: JSONObject::default(),
        pipeline: None,
        priority: None,
        query: None,
      }),
      (parcel_resolver::Resolution::Builtin(builtin), _invalidations) => {
        self.resolve_builtin(ctx, builtin)
      }
      (parcel_resolver::Resolution::Empty, _invalidations) => Ok(Resolution {
        file_path: self
          .project_root
          .join("packages/utils/node-resolver-core/src/_empty.js"),
        side_effects,
        can_defer: false,
        code: None,
        is_excluded: false,
        meta: JSONObject::default(),
        pipeline: None,
        priority: None,
        query: None,
      }),
      (parcel_resolver::Resolution::External, _invalidations) => {
        if let Some(_source_path) = &dep.source_path {
          if dep.env.is_library && dep.specifier_type != SpecifierType::Url {
            todo!("check excluded dependency for libraries");
          }
        }

        Ok(excluded_resolution())
      }
      (parcel_resolver::Resolution::Global(global), _invalidations) => Ok(Resolution {
        file_path: format!("{}.js", global).into(),
        // TODO: Should this be a string or bytes?
        code: Some(format!("module.exports={};", global)),
        pipeline: None,
        side_effects,
        can_defer: false,
        is_excluded: false,
        meta: JSONObject::default(),
        priority: None,
        query: None,
      }),
    }
  }
}

fn excluded_resolution() -> Resolution {
  Resolution {
    is_excluded: true,
    // TODO: Make resolution type an enum and remove the below fields
    file_path: PathBuf::new(),
    side_effects: true,
    can_defer: false,
    code: None,
    meta: None,
    pipeline: None,
    priority: None,
    query: None,
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
    plugin::{PluginConfig, PluginLogger, PluginOptions},
    types::{BundleBehavior, Dependency, Environment, JSONObject, Priority},
  };
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;
  use std::sync::Arc;

  #[test]
  fn test_resolver() {
    let fs = Arc::new(InMemoryFileSystem::default());
    fs.write_file(&PathBuf::from("/foo/index.js"), "contents".to_string());
    fs.write_file(&PathBuf::from("/foo/something.js"), "contents".to_string());

    let plugin_context = PluginContext {
      config: PluginConfig::new(fs, PathBuf::from("/foo"), PathBuf::default()),
      options: PluginOptions::default(),
      logger: PluginLogger::default(),
    };
    let resolver = ParcelResolver::new(&plugin_context);

    let specifier = String::from("./something.js");
    let ctx = ResolveContext {
      specifier: specifier.clone(),
      dependency: Dependency {
        resolve_from: Some(PathBuf::from("/foo/index.js")),
        env: Environment::default(),
        bundle_behavior: BundleBehavior::default(),
        is_entry: false,
        is_optional: false,
        loc: None,
        meta: JSONObject::default(),
        needs_stable_name: false,
        package_conditions: ExportsCondition::default(),
        pipeline: None,
        priority: Priority::default(),
        range: None,
        source_asset_id: None,
        source_path: None,
        specifier,
        specifier_type: SpecifierType::default(),
        symbols: vec![],
        target: None,
      },
      pipeline: None,
    };
    let result = resolver.resolve(&ctx).map_err(|err| err.to_string());

    assert_eq!(
      result,
      Ok(Resolution {
        file_path: PathBuf::from("/foo/something.js"),
        can_defer: false,
        code: None,
        is_excluded: false,
        meta: None,
        pipeline: None,
        priority: None,
        side_effects: true,
        query: None
      })
    )
  }
}
