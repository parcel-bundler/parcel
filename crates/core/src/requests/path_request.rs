use std::{
  borrow::Cow,
  path::{Path, PathBuf},
};

use crate::{
  environment::{EnvironmentContext, EnvironmentFlags},
  intern::Interned,
  parcel_config::PluginNode,
  request_tracker::{Request, RequestResult},
  types::{BuildMode, Dependency, ParcelOptions, SpecifierType},
};
use parcel_resolver::{
  parse_scheme, Cache, CacheCow, ExportsCondition, Fields, IncludeNodeModules, OsFileSystem,
  Resolution, ResolveOptions,
};

// TODO: find a way to have a cached resolver per project.
lazy_static::lazy_static! {
  pub static ref CACHE: parcel_resolver::Cache<OsFileSystem> = {
    Cache::new(OsFileSystem::default())
  };
}

pub struct PathRequest<'a> {
  pub dep: Dependency,
  pub resolvers: &'a Vec<PluginNode>,
  pub named_pipelines: &'a Vec<&'a str>,
}

impl<'a> std::hash::Hash for PathRequest<'a> {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    self.dep.id().hash(state);
    self.resolvers.hash(state);
    self.named_pipelines.hash(state);
  }
}

impl<'a> Request for PathRequest<'a> {
  type Output = ResolverResult;

  fn run(
    self,
    _farm: &crate::worker_farm::WorkerFarm,
    options: &ParcelOptions,
  ) -> RequestResult<Self::Output> {
    // TODO: windows
    let (parsed_pipeline, specifier) = parse_scheme(&self.dep.specifier)
      .and_then(|s| {
        if self.named_pipelines.contains(&s.0.as_ref()) {
          Ok((Some(s.0.to_string()), s.1))
        } else {
          Err(())
        }
      })
      .unwrap_or((None, self.dep.specifier.as_str()));

    let resolver = DefaultResolver {};
    let result = resolver.resolve(specifier, &self.dep, options);
    match result.result {
      Ok(ResolverResult::Resolved {
        path,
        code,
        pipeline,
        side_effects,
      }) => RequestResult {
        result: Ok(ResolverResult::Resolved {
          path,
          code,
          pipeline: pipeline.or(parsed_pipeline),
          side_effects,
        }),
        invalidations: result.invalidations,
      },
      res => RequestResult {
        result: res,
        invalidations: result.invalidations,
      },
    }
  }
}

pub trait Resolver {
  fn resolve(
    &self,
    specifier: &str,
    dep: &Dependency,
    options: &ParcelOptions,
  ) -> RequestResult<ResolverResult>;
}

#[derive(Clone, Debug)]
pub enum ResolverResult {
  NotResolved,
  Excluded,
  Resolved {
    path: Interned<PathBuf>,
    code: Option<Vec<u8>>,
    pipeline: Option<String>,
    side_effects: bool,
  },
}

struct DefaultResolver;
impl Resolver for DefaultResolver {
  fn resolve(
    &self,
    specifier: &str,
    dep: &Dependency,
    options: &ParcelOptions,
  ) -> RequestResult<ResolverResult> {
    let mut resolver = parcel_resolver::Resolver::parcel(
      Cow::Borrowed(&options.project_root),
      CacheCow::Borrowed(&CACHE),
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
      options.mode == BuildMode::Production,
    );
    resolver.conditions.set(
      ExportsCondition::DEVELOPMENT,
      options.mode == BuildMode::Development,
    );

    resolver.entries = Fields::MAIN | Fields::MODULE | Fields::SOURCE;
    if dep.env.context.is_browser() {
      resolver.entries |= Fields::BROWSER;
    }

    resolver.include_node_modules = Cow::Borrowed(&dep.env.include_node_modules);

    let resolver_options = ResolveOptions {
      conditions: dep.package_conditions,
      custom_conditions: dep.custom_package_conditions.clone(),
    };

    let mut res = resolver.resolve_with_options(
      specifier,
      dep
        .resolve_from
        .or(dep.source_path)
        .as_ref()
        .map(|p| Cow::Borrowed(p.as_path()))
        .unwrap_or_else(|| Cow::Owned(options.project_root.join("index")))
        .as_ref(),
      match dep.specifier_type {
        SpecifierType::Commonjs => parcel_resolver::SpecifierType::Cjs,
        SpecifierType::Esm => parcel_resolver::SpecifierType::Esm,
        SpecifierType::Url => parcel_resolver::SpecifierType::Url,
        SpecifierType::Custom => parcel_resolver::SpecifierType::Esm, // ???
      },
      resolver_options,
    );

    let side_effects = if let Ok((Resolution::Path(p), _)) = &res.result {
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

    match res.result.unwrap().0 {
      Resolution::Path(path) => RequestResult {
        result: Ok(ResolverResult::Resolved {
          path: path.into(),
          code: None,
          pipeline: None,
          side_effects,
        }),
        invalidations: Vec::new(),
      },
      Resolution::Builtin(builtin) => self.resolve_builtin(dep, builtin, options),
      Resolution::Empty => RequestResult {
        result: Ok(ResolverResult::Resolved {
          path: Path::new(
            "/Users/devongovett/dev/parcel/packages/utils/node-resolver-core/src/_empty.js",
          )
          .into(),
          code: None,
          pipeline: None,
          side_effects,
        }),
        invalidations: Vec::new(),
      },
      Resolution::External => RequestResult {
        result: Ok(ResolverResult::Excluded),
        invalidations: Vec::new(),
      },
      Resolution::Global(global) => RequestResult {
        result: Ok(ResolverResult::Resolved {
          path: format!("{}.js", global).into(),
          code: Some(format!("module.exports={};", global).into_bytes()),
          pipeline: None,
          side_effects,
        }),
        invalidations: Vec::new(),
      },
    }
  }
}

impl DefaultResolver {
  fn resolve_builtin(
    &self,
    dep: &Dependency,
    builtin: String,
    options: &ParcelOptions,
  ) -> RequestResult<ResolverResult> {
    if dep.env.context.is_node() {
      return RequestResult {
        result: Ok(ResolverResult::Excluded),
        invalidations: Vec::new(),
      };
    }

    if dep.env.flags.contains(EnvironmentFlags::IS_LIBRARY)
      && !should_include_node_module(&dep.env.include_node_modules, &builtin)
    {
      return RequestResult {
        result: Ok(ResolverResult::Excluded),
        invalidations: Vec::new(),
      };
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
        return RequestResult {
          result: Ok(ResolverResult::Resolved {
            path: Path::new(
              "/Users/devongovett/dev/parcel/packages/utils/node-resolver-core/src/_empty.js",
            )
            .into(),
            code: None,
            pipeline: None,
            side_effects: true,
          }),
          invalidations: Vec::new(),
        }
      }
    };

    self.resolve(browser_module, dep, options)
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
