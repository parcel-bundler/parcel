use std::{
  borrow::Cow,
  path::{Path, PathBuf},
};

use crate::{
  diagnostic::{
    format_markdown, json_key, CodeFrame, CodeHighlight, Diagnostic, DiagnosticSeverity,
  },
  environment::{EnvironmentContext, EnvironmentFlags},
  intern::Interned,
  parcel_config::PluginNode,
  request_tracker::{Invalidation, Request, RequestResult},
  types::{BuildMode, Dependency, DependencyFlags, Location, ParcelOptions, SpecifierType},
};
use itertools::Itertools;
use parcel_resolver::{
  parse_scheme, Cache, CacheCow, ExportsCondition, Fields, FileCreateInvalidation, FileSystem,
  Flags, IncludeNodeModules, Invalidations, OsFileSystem, Resolution, ResolveOptions,
  ResolverError, Specifier,
};
use path_slash::{PathBufExt, PathExt};

pub struct PathRequest<'a> {
  pub dep: Dependency,
  pub resolvers: &'a Vec<PluginNode>,
  pub named_pipelines: &'a Vec<&'a str>,
}

impl<'a> std::hash::Hash for PathRequest<'a> {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    self.dep.id.hash(state);
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
    let mut invalidations = result.invalidations;

    match result.result {
      Ok(ResolverResult::Resolved {
        path,
        code,
        pipeline,
        side_effects,
        query,
      }) => {
        invalidations.push(Invalidation::InvalidateOnFileDelete(path));
        RequestResult {
          result: Ok(ResolverResult::Resolved {
            path,
            code,
            pipeline: pipeline.or(parsed_pipeline).or(self.dep.pipeline),
            side_effects,
            query,
          }),
          invalidations,
        }
      }
      Err(mut diagnostics) => {
        if self.dep.flags.contains(DependencyFlags::OPTIONAL) {
          return RequestResult {
            result: Ok(ResolverResult::Excluded),
            invalidations,
          };
        }

        let dir = self
          .dep
          .resolve_from
          .or(self.dep.source_path)
          .as_ref()
          .map(|p| relative_path(p, &options.project_root))
          .unwrap_or_else(|| "./".into());
        diagnostics.insert(
          0,
          Diagnostic {
            origin: Some("@parcel/core".into()),
            message: format_markdown!("Failed to resolve '{}' from '{}'", self.dep.specifier, dir),
            code_frames: if let (Some(loc), Some(source_path)) =
              (&self.dep.loc, &self.dep.source_path)
            {
              vec![CodeFrame {
                file_path: Some(*source_path),
                code: Some(
                  options
                    .input_fs
                    .read_to_string(source_path.as_ref())
                    .unwrap_or_default(),
                ),
                code_highlights: vec![CodeHighlight::from_loc(loc, None)],
                language: None,
              }]
            } else {
              Vec::new()
            },
            severity: crate::diagnostic::DiagnosticSeverity::Error,
            documentation_url: None,
            hints: vec![],
          },
        );

        RequestResult {
          result: Err(diagnostics),
          invalidations,
        }
      }
      res => RequestResult {
        result: res,
        invalidations,
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

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub enum ResolverResult {
  NotResolved,
  Excluded,
  Resolved {
    path: Interned<PathBuf>,
    code: Option<Vec<u8>>,
    pipeline: Option<String>,
    side_effects: bool,
    query: Option<String>,
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
      CacheCow::Borrowed(&options.resolver_cache),
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

    let resolve_from = dep
      .resolve_from
      .as_ref()
      .or(dep.source_path.as_ref())
      .as_ref()
      .map(|p| Cow::Borrowed(p.as_path()))
      .unwrap_or_else(|| Cow::Owned(options.project_root.join("index")));

    let mut res = resolver.resolve_with_options(
      specifier,
      &resolve_from,
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

    let mut invalidations = Vec::new();
    for file in res.invalidations.invalidate_on_file_change {
      let file = file.into();
      invalidations.push(Invalidation::InvalidateOnFileUpdate(file));
      invalidations.push(Invalidation::InvalidateOnFileDelete(file));
    }

    for file in res.invalidations.invalidate_on_file_create {
      invalidations.push(match file {
        FileCreateInvalidation::Path(path) => Invalidation::InvalidateOnFileCreate(path.into()),
        FileCreateInvalidation::Glob(glob) => Invalidation::InvalidateOnGlobCreate(glob.into()),
        FileCreateInvalidation::FileName { file_name, above } => {
          Invalidation::InvalidateOnFileCreateAbove {
            file_name,
            above: above.into(),
          }
        }
      });
    }

    let result = match res.result {
      Ok(res) => res,
      Err(err) => {
        return RequestResult {
          result: Err(vec![error_to_diagnostic(
            err,
            options.project_root,
            &resolve_from,
          )]),
          invalidations,
        }
      }
    };

    match result.0 {
      Resolution::Path(path) => RequestResult {
        result: Ok(ResolverResult::Resolved {
          path: path.into(),
          code: None,
          pipeline: None,
          side_effects,
          query: result.1,
        }),
        invalidations,
      },
      Resolution::Builtin(builtin) => self.resolve_builtin(dep, builtin, options),
      Resolution::Empty => RequestResult {
        result: Ok(ResolverResult::Resolved {
          path: options.core_path.join("_empty.js").into(),
          code: None,
          pipeline: None,
          side_effects,
          query: None,
        }),
        invalidations,
      },
      Resolution::External => {
        let mut result = Ok(ResolverResult::Excluded);
        if let Some(source_path) = dep.source_path {
          if dep.env.flags.contains(EnvironmentFlags::IS_LIBRARY)
            && dep.specifier_type != SpecifierType::Url
          {
            result =
              check_excluded_dependency(&source_path, specifier, dep, &resolver, &options.input_fs)
                .map_err(|e| vec![e]);
          }
        }

        RequestResult {
          result,
          invalidations,
        }
      }
      Resolution::Global(global) => RequestResult {
        result: Ok(ResolverResult::Resolved {
          path: format!("{}.js", global).into(),
          code: Some(format!("module.exports={};", global).into_bytes()),
          pipeline: None,
          side_effects,
          query: None,
        }),
        invalidations,
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
            path: options.core_path.join("_empty.js").into(),
            code: None,
            pipeline: None,
            side_effects: true,
            query: None,
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

fn error_to_diagnostic(
  value: ResolverError,
  project_root: Interned<PathBuf>,
  from: &Path,
) -> Diagnostic {
  match value {
    ResolverError::FileNotFound { relative, from } => {
      let mut relative = relative.to_slash_lossy();
      if !relative.starts_with(".") {
        relative = format!("./{}", relative);
      }
      let dir = from.parent().unwrap();
      Diagnostic {
        origin: Some("@parcel/resolver-default".into()),
        message: format_markdown!(
          "Cannot load file '{}' in '{}'.",
          relative,
          relative_path(dir, &project_root)
        ),
        severity: crate::diagnostic::DiagnosticSeverity::Error,
        code_frames: vec![],
        hints: find_alternative_files(&relative, dir, &project_root)
          .into_iter()
          .map(|f| format!("Did you mean '__{}__'?", f))
          .collect(),
        documentation_url: None,
      }
    }
    ResolverError::ModuleNotFound { module } => Diagnostic {
      origin: Some("@parcel/resolver-default".into()),
      message: format_markdown!("Cannot find module '{}'", module),
      severity: crate::diagnostic::DiagnosticSeverity::Error,
      code_frames: vec![],
      hints: find_alternative_node_modules(&module, from.parent().unwrap())
        .into_iter()
        .map(|f| format!("Did you mean '__{}__'?", f))
        .collect(),
      documentation_url: None,
    },
    ResolverError::UnknownScheme { scheme } => Diagnostic {
      origin: Some("@parcel/resolver-default".into()),
      message: format_markdown!("Unknown url scheme or pipeline '{}:'", scheme),
      severity: crate::diagnostic::DiagnosticSeverity::Error,
      code_frames: vec![],
      hints: vec![],
      documentation_url: None,
    },
    err => todo!("{:?}", err),
  }
}

fn relative_path(path: &Path, project_root: &Path) -> String {
  pathdiff::diff_paths(path, project_root)
    .map(|p| {
      let res = p.to_slash_lossy();
      if !res.starts_with(".") {
        return format!("./{}", res);
      }
      return path.to_slash_lossy();
    })
    .unwrap_or_else(|| path.to_slash_lossy())
}

fn find_all_files_up(
  dir: &Path,
  root: &Path,
  basedir: &Path,
  max_length: usize,
  collected: &mut Vec<String>,
) {
  if let Ok(dir) = std::fs::read_dir(dir) {
    for entry in dir {
      let Ok(entry) = entry else {
        continue;
      };
      let path = entry.path();
      let relative = relative_path(&path, basedir);
      if relative.len() < max_length {
        collected.push(relative);
      }

      if entry.file_type().map(|t| t.is_dir()).unwrap_or_default() {
        find_all_files_up(&path, root, basedir, max_length, collected)
      }
    }
  }
}

fn find_alternative_files(specifier: &str, dir: &Path, project_root: &Path) -> Vec<String> {
  let mut potential_files = Vec::new();
  find_all_files_up(
    dir,
    project_root,
    dir,
    specifier.len() + 10,
    &mut potential_files,
  );

  // if Path::from(specifier).extension().is_none() {
  //   for p in &mut potential_files {

  //   }
  // }

  potential_files.sort();
  fuzzy_search(potential_files, specifier)
}

fn find_alternative_node_modules(module_name: &str, dir: &Path) -> Vec<String> {
  let mut potential_modules = Vec::new();
  let is_org_module = module_name.starts_with('@');

  for f in dir.ancestors() {
    if f
      .file_name()
      .map(|f| f == "node_modules")
      .unwrap_or_default()
    {
      continue;
    }

    let dir = f.join("node_modules");
    if let Ok(dir) = std::fs::read_dir(dir) {
      for entry in dir {
        let Ok(entry) = entry else {
          continue;
        };
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
          continue;
        };
        if is_org_module == file_name.starts_with('@') {
          if is_org_module {
            let Ok(dir) = std::fs::read_dir(entry.path()) else {
              continue;
            };
            for entry in dir {
              if let Ok(entry) = entry {
                if let Some(entry) = entry.file_name().to_str() {
                  potential_modules.push(format!("{}/{}", file_name, entry));
                }
              }
            }
          } else {
            potential_modules.push(file_name.to_owned());
          }
        }
      }
    }
  }

  potential_modules.sort();
  fuzzy_search(potential_modules, module_name)
}

fn fuzzy_search(potential: Vec<String>, specifier: &str) -> Vec<String> {
  potential
    .into_iter()
    .map(|f| {
      let d = levenshtein::levenshtein(&f, specifier);
      (f, d)
    })
    .filter(|(_, d)| d * 2 < specifier.len())
    .sorted_by(|a, b| a.1.cmp(&b.1))
    .take(2)
    .map(|(d, _)| d)
    .collect()
}

fn check_excluded_dependency<Fs: FileSystem>(
  source_path: &Path,
  specifier: &str,
  dep: &Dependency,
  resolver: &parcel_resolver::Resolver<Fs>,
  fs: &Fs,
) -> Result<ResolverResult, Diagnostic> {
  let Ok((Specifier::Package(module, _), _)) = Specifier::parse(
    specifier,
    parcel_resolver::SpecifierType::Esm,
    Flags::empty(),
  ) else {
    return Ok(ResolverResult::Excluded);
  };

  let Ok(Some(pkg)) = resolver.find_package(source_path, &Invalidations::default()) else {
    return Ok(ResolverResult::Excluded);
  };

  if !pkg.dependencies.contains_key(&*module) && !pkg.peer_dependencies.contains_key(&*module) {
    let contents = fs.read_to_string(&pkg.path)?;
    let parsed = json_sourcemap::parse(&contents, Default::default())?;

    return Err(Diagnostic {
      origin: Some("@parcel/resolver-default".into()),
      message: format!(
        "External dependency \"{}\" is not declared in package.json.",
        module
      ),
      code_frames: vec![CodeFrame {
        file_path: Some(pkg.path.clone().into()),
        code: Some(contents),
        code_highlights: vec![parsed
          .get_location("/dependencies")
          .map(|loc| CodeHighlight::from_json(loc.key(), loc.key_end(), None))
          .unwrap_or(CodeHighlight {
            message: None,
            start: Location { line: 1, column: 1 },
            end: Location { line: 1, column: 1 },
          })],
        language: Some(crate::types::AssetType::Json),
      }],
      hints: vec![format!("Add \"{}\" as a dependency.", module)],
      severity: DiagnosticSeverity::Error,
      documentation_url: None,
    });
  }

  if let Some(range) = dep
    .range
    .as_ref()
    .and_then(|r| node_semver::Range::parse(r).ok())
  {
    let dep_range = pkg
      .dependencies
      .get(&*module)
      .or(pkg.peer_dependencies.get(&*module));
    if let Some(dep_range) = dep_range.and_then(|r| node_semver::Range::parse(r).ok()) {
      let field = if pkg.dependencies.contains_key(&*module) {
        "dependencies"
      } else {
        "peerDependencies"
      };
      if range.intersect(&dep_range).is_none() {
        let contents = fs.read_to_string(&pkg.path)?;
        let parsed = json_sourcemap::parse(&contents, Default::default())?;
        return Err(Diagnostic {
          origin: Some("@parcel/resolver-default".into()),
          message: format_markdown!(
            "External dependency \"{}\" does not satisfy required semver range \"{}\".",
            module,
            dep.range.as_ref().unwrap()
          ),
          code_frames: vec![CodeFrame {
            file_path: Some(pkg.path.clone().into()),
            code: Some(contents),
            code_highlights: vec![parsed
              .get_location(&json_key!("/{}/{}", field, module))
              .map(|loc| {
                CodeHighlight::from_json(
                  loc.value(),
                  loc.value_end(),
                  Some("Found this conflicting requirement."),
                )
              })
              .unwrap_or(CodeHighlight {
                message: None,
                start: Location { line: 1, column: 1 },
                end: Location { line: 1, column: 1 },
              })],
            language: Some(crate::types::AssetType::Json),
          }],
          hints: vec![format_markdown!(
            "Update the dependency on \"{}\" to satisfy \"{}\".",
            module,
            dep.range.as_ref().unwrap()
          )],
          severity: DiagnosticSeverity::Error,
          documentation_url: None,
        });
      }
    }
  }

  return Ok(ResolverResult::Excluded);
}
