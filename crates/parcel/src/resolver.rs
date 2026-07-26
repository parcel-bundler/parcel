use std::{borrow::Cow, path::Path, sync::Arc};

use parcel_core::{
  AssetRequest, AssetType, BufferContent, BuildMode, CodeFrame, CodeHighlight, Dependency,
  DependencyFlags, DependencyResolution, Diagnostic, DiagnosticList, DiagnosticSeverity,
  Environment, EnvironmentFlags, ExportsCondition, FileContent, FileSystem, IncludeNodeModules,
  JsonSourceLocationType, Location, ParcelOptions, PathId, Resolver, SourceLocation, SourceUrl,
  SpecifierType, Target, json_source_location,
};
use parcel_resolver::{
  PackageJsonError, Resolution, ResolutionAndQuery, ResolveOptions, ResolverError, SpecifierError,
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

    let side_effects = dep.flags.contains(DependencyFlags::SIDE_EFFECTS)
      || if let Ok(ResolutionAndQuery {
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
          content: Arc::new(BufferContent::new_string(format!(
            "module.exports={};",
            global
          ))),
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
      Err(error) => Err(DiagnosticList(resolver_error_diagnostics(
        error, specifier, &**fs,
      ))),
    }
  }
}

const ORIGIN: &str = "@parcel/resolver-default";

fn diagnostic(message: String) -> Diagnostic {
  Diagnostic {
    message,
    origin: Some(ORIGIN.into()),
    code_frames: vec![],
    hints: vec![],
    severity: DiagnosticSeverity::Error,
    documentation_url: None,
  }
}

fn json_code_frame(
  fs: &dyn FileSystem,
  path: &Path,
  pointer: &str,
  message: Option<&str>,
) -> CodeFrame {
  let path = PathId::new(path);
  let code = fs.read_to_string(path).ok();
  let code_highlights = code
    .as_deref()
    .and_then(|code| {
      json_source_location(code, pointer, JsonSourceLocationType::Key)
        .ok()
        .flatten()
    })
    .map(|(start, end)| CodeHighlight::from_json(start, end, message))
    .into_iter()
    .collect();

  CodeFrame {
    code,
    url: Some(SourceUrl::from_path(&path)),
    language: Some(AssetType::Json),
    code_highlights,
  }
}

fn resolver_error_diagnostics(
  error: ResolverError,
  specifier: &str,
  fs: &dyn FileSystem,
) -> Vec<Diagnostic> {
  match error {
    ResolverError::FileNotFound { relative, from } => {
      vec![diagnostic(format!(
        "Cannot load file '{}' in '{}'",
        relative.display(),
        from.display()
      ))]
    }
    ResolverError::ModuleNotFound { module } => {
      vec![diagnostic(format!("Cannot find module '{}'", module))]
    }
    ResolverError::ModuleEntryNotFound {
      module,
      entry_path,
      package_path,
      field,
    } => {
      let file_specifier = package_path
        .parent()
        .and_then(|dir| entry_path.strip_prefix(dir).ok())
        .unwrap_or(&entry_path)
        .to_string_lossy()
        .replace('\\', "/");
      let highlight_message = format!("'{}' does not exist", file_specifier);
      let mut result = diagnostic(format!(
        "Could not load '{}' from module '{}' found in package.json#{}",
        file_specifier, module, field
      ));
      result.code_frames.push(json_code_frame(
        fs,
        &package_path,
        &format!("/{field}"),
        Some(&highlight_message),
      ));
      vec![result]
    }
    ResolverError::ModuleSubpathNotFound { module, path, .. } => vec![diagnostic(format!(
      "Cannot load file '{}' from module '{}'",
      path.display(),
      module
    ))],
    ResolverError::JsonError(error) => {
      let path = PathId::new(&error.path);
      let mut result = diagnostic("Error parsing JSON".into());
      result.code_frames.push(CodeFrame {
        code: fs.read_to_string(path).ok(),
        url: Some(SourceUrl::from_path(&path)),
        language: Some(AssetType::Json),
        code_highlights: vec![CodeHighlight {
          message: Some(error.message),
          start: Location {
            line: error.line as u32,
            column: error.column as u32,
          },
          end: Location {
            line: error.line as u32,
            column: error.column as u32,
          },
        }],
      });
      vec![result]
    }
    ResolverError::InvalidSpecifier(error) => {
      let message = match error {
        SpecifierError::EmptySpecifier => "Invalid empty specifier".into(),
        SpecifierError::InvalidPackageSpecifier => "Invalid package specifier".into(),
        SpecifierError::InvalidFileUrl => "Invalid file url".into(),
        SpecifierError::UrlError(url) => format!("Invalid URL: {url}"),
      };
      vec![diagnostic(message)]
    }
    ResolverError::UnknownScheme { scheme } => vec![diagnostic(format!(
      "Unknown url scheme or pipeline '{scheme}:'"
    ))],
    ResolverError::PackageJsonError {
      module,
      path,
      error,
    } => {
      let (message, pointer) = match error {
        PackageJsonError::PackagePathNotExported => (
          format!("Module '{specifier}' is not exported from the '{module}' package"),
          Some("/exports"),
        ),
        PackageJsonError::ImportNotDefined => (
          format!("Package import '{specifier}' is not defined in the '{module}' package"),
          Some("/imports"),
        ),
        PackageJsonError::InvalidPackageTarget => (
          format!(
            "Invalid package target in the '{module}' package. Targets may not refer to files outside the package."
          ),
          Some("/exports"),
        ),
        PackageJsonError::InvalidSpecifier => (
          format!("Invalid package import specifier '{specifier}'."),
          None,
        ),
      };
      let mut result = diagnostic(message);
      if let Some(pointer) = pointer {
        result
          .code_frames
          .push(json_code_frame(fs, &path, pointer, None));
      }
      vec![result]
    }
    ResolverError::IOError(error) => vec![diagnostic(error.0.to_string())],
    ResolverError::PackageJsonNotFound { from } => vec![diagnostic(format!(
      "Cannot find a package.json above '{}'",
      from.display()
    ))],
    ResolverError::TsConfigExtendsNotFound { tsconfig, error } => {
      let mut result = diagnostic("Could not find extended tsconfig".into());
      result
        .code_frames
        .push(json_code_frame(fs, &tsconfig, "/extends", None));
      let mut diagnostics = vec![result];
      diagnostics.extend(resolver_error_diagnostics(*error, specifier, fs));
      diagnostics
    }
    ResolverError::UnknownError => vec![diagnostic("Unknown error".into())],
  }
}
