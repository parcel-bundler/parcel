use std::{borrow::Cow, sync::Arc};

use parcel_core::{
  AssetRequest, AssetType, BufferContent, BuildMode, CodeFrame, CodeHighlight, Dependency,
  DependencyFlags, DependencyResolution, Diagnostic, DiagnosticList, Environment, EnvironmentFlags,
  ExportsCondition, FileContent, FileSystem, IncludeNodeModules, Location, ParcelOptions, PathId,
  Resolver, SourceLocation, SourceUrl, SpecifierType, Target,
};
use parcel_resolver::{
  Resolution, ResolutionAndQuery, ResolveOptions, ResolverError, SpecifierError,
};

pub struct DefaultResolver;

impl DefaultResolver {
  pub fn new(_project_root: String) -> Self {
    DefaultResolver
  }
}

impl Resolver for DefaultResolver {
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    pipeline: Option<&str>,
    options: &ParcelOptions,
    fs: &Arc<dyn FileSystem>,
  ) -> Result<DependencyResolution, DiagnosticList> {
    let resolve_from = dep.resolve_from.as_ref().unwrap();
    let mut conditions = dep.conditions | ExportsCondition::SOURCE;

    if dep.target.environment.is_browser() {
      conditions |= ExportsCondition::BROWSER;
    }

    if dep.target.environment.is_worker() {
      conditions |= ExportsCondition::WORKER;
    }

    if dep.target.environment == Environment::Worklet {
      conditions |= ExportsCondition::WORKLET;
    }

    if dep.target.environment.is_electron() {
      conditions |= ExportsCondition::ELECTRON;
    }

    if dep.target.environment.is_node() {
      conditions |= ExportsCondition::NODE;
    }

    if dep.target.environment == Environment::ReactServer {
      conditions |= ExportsCondition::REACT_SERVER;
    }

    if options.mode == BuildMode::Production {
      conditions |= ExportsCondition::PRODUCTION;
    } else if options.mode == BuildMode::Development {
      conditions |= ExportsCondition::DEVELOPMENT;
    }

    // Resolve through the per-request tracking file system so every file consulted (package.json,
    // existence checks, ...) is recorded as an invalidation of this asset. The interning cache is
    // per-resolve; the underlying metadata/parse caching is shared via the wrapped CachedFileSystem.
    let mut resolver = parcel_resolver::Resolver::parcel(options.project_root);
    resolver.include_node_modules = if dep.flags.contains(DependencyFlags::FORCE_BUNDLE) {
      Cow::Owned(IncludeNodeModules::Bool(true))
    } else {
      Cow::Borrowed(&dep.target.include_node_modules)
    };

    let mut res = resolver.resolve_with_options(
      specifier,
      resolve_from.to_file_path()?,
      match dep.specifier_type {
        SpecifierType::Esm => parcel_resolver::SpecifierType::Esm,
        SpecifierType::Commonjs => parcel_resolver::SpecifierType::Cjs,
        SpecifierType::Url => parcel_resolver::SpecifierType::Url,
        _ => parcel_resolver::SpecifierType::Esm,
      },
      &**fs,
      ResolveOptions {
        conditions,
        ..Default::default()
      },
    );

    let side_effects = if let Ok(ResolutionAndQuery {
      resolution: Resolution::Path(p),
      ..
    }) = &res
    {
      match resolver.resolve_side_effects(*p, &**fs) {
        Ok(side_effects) => side_effects,
        Err(err) => {
          res = Err(err);
          true
        }
      }
    } else {
      true
    };

    match res {
      Ok(res) => match res.resolution {
        Resolution::Path(path) => {
          let url = SourceUrl::from_path_and_query(&path, res.query.as_ref().map(|s| &s[1..]));
          let ty = AssetType::from_url(&url);
          Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
            loc: SourceLocation {
              url,
              ..Default::default()
            },
            content: Arc::new(FileContent::new(path, options.input_fs.clone())),
            target: Target::normalize(&dep.target, &ty),
            pipeline: pipeline.map(|p| p.into()),
            ty,
            side_effects,
          })))
        }
        Resolution::External => Ok(DependencyResolution::External),
        Resolution::Empty => Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
          ty: AssetType::Js,
          loc: SourceLocation {
            url: SourceUrl::parse("file:///empty.js")?,
            ..Default::default()
          },
          content: Arc::new(BufferContent::new(vec![])),
          target: dep.target.clone(),
          pipeline: pipeline.map(|p| p.into()),
          side_effects,
        }))),
        Resolution::Global(global) => Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
          ty: AssetType::Js,
          loc: SourceLocation {
            url: SourceUrl::parse(&format!("file:///globals/{}.js", global))?,
            ..Default::default()
          },
          content: Arc::new(BufferContent::new(
            format!("module.exports={};", global).into_bytes(),
          )),
          target: dep.target.clone(),
          pipeline: pipeline.map(|p| p.into()),
          side_effects,
        }))),
        Resolution::Builtin { module, .. } => {
          if dep.target.flags.contains(EnvironmentFlags::IS_LIBRARY)
            || dep.target.environment.is_node()
            || dep.target.environment == Environment::ReactServer
          {
            return Ok(DependencyResolution::External);
          }

          let module = match module.as_str() {
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
            "string_decoder" => "string_decoder/",
            "sys" => "util",
            "timers" => "timers-browserify",
            "tty" => "tty-browserify",
            "url" => "url/",
            "util" => "util/",
            "vm" => "vm-browserify",
            "zlib" => "browserify-zlib",
            _ => {
              return Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
                ty: AssetType::Js,
                loc: SourceLocation {
                  url: SourceUrl::parse("file:///empty.js")?,
                  ..Default::default()
                },
                content: Arc::new(BufferContent::new(vec![])),
                target: dep.target.clone(),
                pipeline: pipeline.map(|p| p.into()),
                side_effects,
              })));
            }
          };

          self.resolve(dep, module, pipeline, options, fs)
        }
      },
      Err(e) => {
        match e {
          ResolverError::FileNotFound { relative, from } => {
            // TODO: find alternate files
            Err(DiagnosticList(vec![Diagnostic {
              message: format!("Cannot load file {:?} in {:?}", relative, from),
              origin: Some("@parcel/resolver-default".into()),
              code_frames: vec![],
              hints: vec![],
              severity: parcel_core::DiagnosticSeverity::Error,
              documentation_url: None,
            }]))
          }
          ResolverError::ModuleNotFound { module } => {
            // TODO: find alternate modules
            Err(DiagnosticList(vec![Diagnostic {
              message: format!("Cannot find module {:?}", module),
              origin: Some("@parcel/resolver-default".into()),
              code_frames: vec![],
              hints: vec![],
              severity: parcel_core::DiagnosticSeverity::Error,
              documentation_url: None,
            }]))
          }
          ResolverError::ModuleEntryNotFound {
            module,
            entry_path,
            package_path,
            field,
          } => {
            Err(DiagnosticList(vec![Diagnostic {
              message: format!(
                "Could not load {:?} from module {:?} found in package.json#{}",
                entry_path, module, field
              ),
              origin: Some("@parcel/resolver-default".into()),
              code_frames: vec![CodeFrame {
                url: Some(SourceUrl::from_path(&PathId::new(&package_path))),
                code: None,
                language: Some(AssetType::Json),
                code_highlights: vec![
                  // TODO
                  // CodeHighlight {

                  // }
                ],
              }],
              hints: vec![],
              severity: parcel_core::DiagnosticSeverity::Error,
              documentation_url: None,
            }]))
          }
          ResolverError::ModuleSubpathNotFound { module, path, .. } => {
            Err(DiagnosticList(vec![Diagnostic {
              message: format!("Cannot load file {:?} from module {:?}", path, module),
              origin: Some("@parcel/resolver-default".into()),
              code_frames: vec![],
              hints: vec![],
              severity: parcel_core::DiagnosticSeverity::Error,
              documentation_url: None,
            }]))
          }
          ResolverError::JsonError(e) => Err(DiagnosticList(vec![Diagnostic {
            message: format!("Error parsing JSON"),
            origin: Some("@parcel/resolver-default".into()),
            code_frames: vec![CodeFrame {
              url: Some(SourceUrl::from_path(&PathId::new(&e.path))),
              code: None,
              language: Some(AssetType::Json),
              code_highlights: vec![CodeHighlight {
                message: Some(e.message),
                start: Location {
                  line: e.line as u32,
                  column: e.column as u32,
                },
                end: Location {
                  line: e.line as u32,
                  column: e.column as u32,
                },
              }],
            }],
            hints: vec![],
            severity: parcel_core::DiagnosticSeverity::Error,
            documentation_url: None,
          }])),
          ResolverError::InvalidSpecifier(e) => {
            let message = match e {
              SpecifierError::EmptySpecifier => format!("Invalid empty specifier"),
              SpecifierError::InvalidPackageSpecifier => format!("Invalid package specifier"),
              SpecifierError::InvalidFileUrl => format!("Invalid file url"),
              SpecifierError::UrlError(url) => format!("Invalid URL: {}", url),
            };

            Err(DiagnosticList(vec![Diagnostic {
              message,
              origin: Some("@parcel/resolver-default".into()),
              code_frames: vec![],
              hints: vec![],
              severity: parcel_core::DiagnosticSeverity::Error,
              documentation_url: None,
            }]))
          }
          ResolverError::UnknownScheme { scheme } => Err(DiagnosticList(vec![Diagnostic {
            message: format!("Unknown url scheme or pipeline {:?}", scheme),
            origin: Some("@parcel/resolver-default".into()),
            code_frames: vec![],
            hints: vec![],
            severity: parcel_core::DiagnosticSeverity::Error,
            documentation_url: None,
          }])),
          ResolverError::PackageJsonError {
            module,
            path,
            error,
          } => match error {
            // PackageJsonError::PackagePathNotExported => {}
            _ => todo!(),
          },
          ResolverError::IOError(e) => Err(DiagnosticList(vec![Diagnostic {
            message: e.0.to_string(),
            origin: Some("@parcel/resolver-default".into()),
            code_frames: vec![],
            hints: vec![],
            severity: parcel_core::DiagnosticSeverity::Error,
            documentation_url: None,
          }])),
          ResolverError::PackageJsonNotFound { from } => Err(DiagnosticList(vec![Diagnostic {
            message: format!("Cannot find a package.json above {:?}", from),
            origin: Some("@parcel/resolver-default".into()),
            code_frames: vec![],
            hints: vec![],
            severity: parcel_core::DiagnosticSeverity::Error,
            documentation_url: None,
          }])),
          ResolverError::TsConfigExtendsNotFound { .. } => Err(DiagnosticList(vec![Diagnostic {
            message: format!("Could not find extended tsconfig"),
            origin: Some("@parcel/resolver-default".into()),
            code_frames: vec![],
            hints: vec![],
            severity: parcel_core::DiagnosticSeverity::Error,
            documentation_url: None,
          }])),
          ResolverError::UnknownError => Err(DiagnosticList(vec![Diagnostic {
            message: "Unknown error".into(),
            origin: Some("@parcel/resolver-default".into()),
            code_frames: vec![],
            hints: vec![],
            severity: parcel_core::DiagnosticSeverity::Error,
            documentation_url: None,
          }])),
        }
      }
    }
  }
}
