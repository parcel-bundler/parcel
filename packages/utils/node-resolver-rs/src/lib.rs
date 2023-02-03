use bitflags::bitflags;
use once_cell::unsync::OnceCell;
use specifier::{parse_package_specifier, parse_scheme};
use std::{
  borrow::Cow,
  collections::HashMap,
  path::{Path, PathBuf},
  rc::Rc,
};

use package_json::{AliasValue, ExportsResolution, PackageJson};
use specifier::Specifier;
use tsconfig::TsConfig;

mod builtins;
mod cache;
mod error;
mod fs;
mod invalidations;
mod package_json;
mod specifier;
mod tsconfig;

pub use cache::{Cache, CacheCow};
pub use error::ResolverError;
pub use fs::{FileSystem, OsFileSystem};
pub use invalidations::*;
pub use package_json::{ExportsCondition, Fields, PackageJsonError};
pub use specifier::SpecifierType;

bitflags! {
  pub struct Flags: u16 {
    /// Parcel-style absolute paths resolved relative to project root.
    const ABSOLUTE_SPECIFIERS = 1 << 0;
    /// Parcel-style tilde specifiers resolved relative to nearest module root.
    const TILDE_SPECIFIERS = 1 << 1;
    /// The `npm:` scheme.
    const NPM_SCHEME = 1 << 2;
    /// The "alias" field in package.json.
    const ALIASES = 1 << 3;
    /// The settings in tsconfig.json.
    const TSCONFIG = 1 << 4;
    /// The "exports" field in package.json.
    const EXPORTS = 1 << 5;
    /// Directory index files, e.g. index.js.
    const DIR_INDEX = 1 << 6;
    /// Optional extensions in specifiers, using the `extensions` setting.
    const OPTIONAL_EXTENSIONS = 1 << 7;
    /// Whether extensions are replaced in specifiers, e.g. `./foo.js` -> `./foo.ts`.
    const TYPESCRIPT_EXTENSIONS = 1 << 8;
    /// Whether to allow omitting the extension when resolving the same file type.
    const PARENT_EXTENSION = 1 << 9;

    /// Default Node settings for CommonJS.
    const NODE_CJS = Self::EXPORTS.bits | Self::DIR_INDEX.bits | Self::OPTIONAL_EXTENSIONS.bits;
    /// Default Node settings for ESM.
    const NODE_ESM = Self::EXPORTS.bits;
    /// Default TypeScript settings.
    const TYPESCRIPT = Self::TSCONFIG.bits | Self::EXPORTS.bits | Self::DIR_INDEX.bits | Self::OPTIONAL_EXTENSIONS.bits | Self::TYPESCRIPT_EXTENSIONS.bits;
  }
}

#[derive(Clone)]
pub enum IncludeNodeModules {
  Bool(bool),
  Array(Vec<String>),
  Map(HashMap<String, bool>),
}

impl Default for IncludeNodeModules {
  fn default() -> Self {
    IncludeNodeModules::Bool(true)
  }
}

type ResolveModuleDir = dyn Fn(&str, &Path) -> Result<PathBuf, ResolverError>;

pub struct Resolver<'a, Fs> {
  pub project_root: Cow<'a, Path>,
  pub extensions: &'a [&'a str],
  pub index_file: &'a str,
  pub entries: Fields,
  pub flags: Flags,
  pub include_node_modules: Cow<'a, IncludeNodeModules>,
  pub conditions: ExportsCondition,
  pub module_dir_resolver: Option<Rc<ResolveModuleDir>>,
  cache: CacheCow<'a, Fs>,
}

#[derive(Debug, PartialEq, Eq, Clone, serde::Serialize)]
#[serde(tag = "type", content = "value")]
pub enum Resolution {
  /// Resolved to a file path.
  Path(PathBuf),
  /// Resolved to a runtime builtin module.
  Builtin(String),
  /// Resolved to an external module that should not be bundled.
  External,
  /// Resolved to an empty module (e.g. `false` in the package.json#browser field).
  Empty,
  /// Resolved to a global variable.
  Global(String),
}

pub struct ResolveResult<'a> {
  pub result: Result<(Resolution, Option<&'a str>), ResolverError>,
  pub invalidations: Invalidations,
}

#[derive(PartialEq, Eq)]
enum Prioritize {
  Directory,
  File,
}

impl<'a, Fs: FileSystem> Resolver<'a, Fs> {
  pub fn node(project_root: Cow<'a, Path>, cache: CacheCow<'a, Fs>) -> Self {
    Self {
      project_root,
      extensions: &["js", "json", "node"],
      index_file: "index",
      entries: Fields::MAIN,
      flags: Flags::NODE_CJS,
      cache,
      include_node_modules: Cow::Owned(IncludeNodeModules::default()),
      conditions: ExportsCondition::NODE,
      module_dir_resolver: None,
    }
  }

  pub fn node_esm(project_root: Cow<'a, Path>, cache: CacheCow<'a, Fs>) -> Self {
    Self {
      project_root,
      extensions: &[],
      index_file: "index",
      entries: Fields::MAIN,
      flags: Flags::NODE_ESM,
      cache,
      include_node_modules: Cow::Owned(IncludeNodeModules::default()),
      conditions: ExportsCondition::NODE,
      module_dir_resolver: None,
    }
  }

  pub fn parcel(project_root: Cow<'a, Path>, cache: CacheCow<'a, Fs>) -> Self {
    Self {
      project_root,
      extensions: &["ts", "tsx", "mjs", "js", "jsx", "cjs", "json"],
      index_file: "index",
      entries: Fields::MAIN | Fields::SOURCE | Fields::BROWSER | Fields::MODULE,
      flags: Flags::all(),
      cache,
      include_node_modules: Cow::Owned(IncludeNodeModules::default()),
      conditions: ExportsCondition::empty(),
      module_dir_resolver: None,
    }
  }

  pub fn resolve<'s>(
    &self,
    specifier: &'s str,
    from: &Path,
    specifier_type: SpecifierType,
  ) -> ResolveResult<'s> {
    let invalidations = Invalidations::default();
    let (specifier, query) = match Specifier::parse(specifier, specifier_type, self.flags) {
      Ok(s) => s,
      Err(e) => {
        return ResolveResult {
          result: Err(e.into()),
          invalidations,
        }
      }
    };
    let request = ResolveRequest::new(self, &specifier, specifier_type, from, &invalidations);
    let result = match request.resolve() {
      Ok(r) => Ok((r, query)),
      Err(r) => Err(r),
    };

    ResolveResult {
      result,
      invalidations,
    }
  }

  pub fn resolve_side_effects(&self, path: &Path) -> Result<bool, ResolverError> {
    if let Some(package) = self.find_package(path.parent().unwrap())? {
      Ok(package.has_side_effects(path))
    } else {
      Ok(true)
    }
  }

  fn find_package(&self, from: &Path) -> Result<Option<&PackageJson>, ResolverError> {
    if let Some(path) = self.find_ancestor_file(from, "package.json") {
      let package = self.cache.read_package(Cow::Owned(path))?;
      return Ok(Some(package));
    }

    Ok(None)
  }

  fn find_ancestor_file(&self, from: &Path, filename: &str) -> Option<PathBuf> {
    for dir in from.ancestors() {
      if let Some(filename) = dir.file_name() {
        if filename == "node_modules" {
          break;
        }
      }

      let file = dir.join(filename);
      if self.cache.fs.is_file(&file) {
        return Some(file);
      }

      if dir == self.project_root {
        break;
      }
    }

    None
  }
}

struct ResolveRequest<'a, Fs> {
  resolver: &'a Resolver<'a, Fs>,
  specifier: &'a Specifier<'a>,
  specifier_type: SpecifierType,
  from: &'a Path,
  flags: RequestFlags,
  tsconfig: OnceCell<Option<&'a TsConfig<'a>>>,
  invalidations: &'a Invalidations,
  conditions: ExportsCondition,
  priority_extension: Option<&'a str>,
}

bitflags! {
  struct RequestFlags: u8 {
    const IN_TS_FILE = 1 << 0;
    const IN_JS_FILE = 1 << 1;
    const IN_NODE_MODULES = 1 << 2;
  }
}

impl<'a, Fs: FileSystem> ResolveRequest<'a, Fs> {
  fn new(
    resolver: &'a Resolver<'a, Fs>,
    specifier: &'a Specifier<'a>,
    mut specifier_type: SpecifierType,
    from: &'a Path,
    invalidations: &'a Invalidations,
  ) -> Self {
    let mut flags = RequestFlags::empty();
    if let Some(ext) = from.extension() {
      if ext == "ts" || ext == "tsx" || ext == "mts" || ext == "cts" {
        flags |= RequestFlags::IN_TS_FILE;
      } else if ext == "js" || ext == "jsx" || ext == "mjs" || ext == "cjs" {
        flags |= RequestFlags::IN_JS_FILE;
      }
    }

    if from.components().any(|c| c.as_os_str() == "node_modules") {
      flags |= RequestFlags::IN_NODE_MODULES;
    }

    // Replace the specifier type for `npm:` URLs so we resolve it like a module.
    if specifier_type == SpecifierType::Url && matches!(specifier, Specifier::Package(..)) {
      specifier_type = SpecifierType::Esm;
    }

    // Add "import" or "require" condition to global conditions based on specifier type.
    // Also add the "module" condition if the "module" entry field is enabled.
    let mut conditions = resolver.conditions;
    let module_condition = if resolver.entries.contains(Fields::MODULE) {
      ExportsCondition::MODULE
    } else {
      ExportsCondition::empty()
    };
    match specifier_type {
      SpecifierType::Esm => conditions |= ExportsCondition::IMPORT | module_condition,
      SpecifierType::Cjs => conditions |= ExportsCondition::REQUIRE | module_condition,
      _ => {}
    }

    // Store the parent file extension so we can prioritize it even in sub-requests.
    let priority_extension = if resolver.flags.contains(Flags::PARENT_EXTENSION) {
      from.extension().and_then(|ext| ext.to_str())
    } else {
      None
    };

    Self {
      resolver,
      specifier,
      specifier_type,
      from,
      flags,
      tsconfig: OnceCell::new(),
      invalidations,
      conditions,
      priority_extension,
    }
  }

  fn resolve_aliases(
    &self,
    package: &PackageJson,
    specifier: &Specifier,
    fields: Fields,
  ) -> Result<Option<Resolution>, ResolverError> {
    // Don't resolve alias if it came from the package.json itself (i.e. another alias).
    if self.from == package.path {
      return Ok(None);
    }

    match package.resolve_aliases(&specifier, fields) {
      Some(alias) => match alias.as_ref() {
        AliasValue::Specifier(specifier) => {
          let mut req = ResolveRequest::new(
            &self.resolver,
            specifier,
            SpecifierType::Cjs,
            &package.path,
            self.invalidations,
          );
          req.priority_extension = self.priority_extension;
          let resolved = req.resolve_specifier()?;
          Ok(Some(resolved))
        }
        AliasValue::Bool(false) => Ok(Some(Resolution::Empty)),
        AliasValue::Bool(true) => Err(ResolverError::InvalidAlias),
        AliasValue::Global { global } => Ok(Some(Resolution::Global((*global).to_owned()))),
      },
      None => Ok(None),
    }
  }

  fn resolve(&self) -> Result<Resolution, ResolverError> {
    // First, check the project root package.json for any aliases.
    if self.resolver.flags.contains(Flags::ALIASES) {
      if let Some(package) = self.find_package(&self.resolver.project_root)? {
        // TODO: convert specifier to be relative to package?
        if let Some(res) = self.resolve_aliases(&package, &self.specifier, Fields::ALIAS)? {
          return Ok(res);
        }
      }
    }

    self.resolve_specifier()
  }

  fn resolve_specifier(&self) -> Result<Resolution, ResolverError> {
    match &self.specifier {
      Specifier::Relative(specifier) => {
        // Relative path
        self.resolve_relative(&specifier, &self.from)
      }
      Specifier::Tilde(specifier) if self.resolver.flags.contains(Flags::TILDE_SPECIFIERS) => {
        // Tilde path. Resolve relative to nearest node_modules directory,
        // the nearest directory with package.json or the project root - whichever comes first.
        if let Some(p) = self.find_ancestor_file(&self.from, "package.json") {
          return self.resolve_relative(&specifier, &p);
        }

        Err(ResolverError::PackageJsonNotFound {
          from: self.from.to_owned(),
        })
      }
      Specifier::Absolute(specifier) => {
        // In Parcel mode, absolute paths are actually relative to the project root.
        if self.resolver.flags.contains(Flags::ABSOLUTE_SPECIFIERS) {
          self.resolve_relative(
            specifier.strip_prefix("/").unwrap(),
            &self.resolver.project_root.join("index"),
          )
        } else if let Some(res) = self.load_path(&specifier, None, Prioritize::File)? {
          Ok(res)
        } else {
          Err(ResolverError::FileNotFound {
            relative: specifier.as_ref().to_owned(),
            from: PathBuf::from("/"),
          })
        }
      }
      Specifier::Hash(hash) => {
        if self.specifier_type == SpecifierType::Url {
          // An ID-only URL, e.g. `url(#clip-path)` for CSS rules. Ignore.
          Ok(Resolution::External)
        } else if self.specifier_type == SpecifierType::Esm
          && self.resolver.flags.contains(Flags::EXPORTS)
        {
          // An internal package #import specifier.
          let package = self.find_package(&self.from)?;
          if let Some(package) = package {
            let res = package
              .resolve_package_imports(&hash, self.conditions)
              .map_err(|e| ResolverError::PackageJsonError {
                module: package.name.to_owned(),
                path: package.path.clone(),
                error: e,
              })?;
            match res {
              ExportsResolution::Path(path) => {
                // Extensionless specifiers are not supported in the imports field.
                if let Some(res) = self.try_file_without_aliases(&path)? {
                  return Ok(res);
                }
              }
              ExportsResolution::Package(specifier) => {
                let (module, subpath) = parse_package_specifier(&specifier)?;
                // TODO: should this follow aliases??
                return self.resolve_bare(module, subpath);
              }
              _ => {}
            }
          }

          Err(ResolverError::PackageJsonNotFound {
            from: self.from.to_owned(),
          })
        } else {
          Err(ResolverError::UnknownError)
        }
      }
      Specifier::Package(module, subpath) => {
        // Bare specifier.
        self.resolve_bare(&module, &subpath)
      }
      Specifier::Builtin(builtin) => Ok(Resolution::Builtin(builtin.as_ref().to_owned())),
      Specifier::Url(url) => {
        if self.specifier_type == SpecifierType::Url {
          Ok(Resolution::External)
        } else {
          let (scheme, _) = parse_scheme(url)?;
          Err(ResolverError::UnknownScheme {
            scheme: scheme.into_owned(),
          })
        }
      }
      _ => Err(ResolverError::UnknownError),
    }
  }

  fn find_ancestor_file(&self, from: &Path, filename: &str) -> Option<PathBuf> {
    self
      .invalidations
      .invalidate_on_file_create_above(filename, from);

    let res = self.resolver.find_ancestor_file(from, filename);
    if let Some(path) = &res {
      self.invalidations.invalidate_on_file_change(path);
    }
    res
  }

  fn find_package(&self, from: &Path) -> Result<Option<&PackageJson>, ResolverError> {
    let is_package_json = match from.file_name() {
      None => true,
      Some(f) => f != "package.json",
    };

    if is_package_json {
      self
        .invalidations
        .invalidate_on_file_create_above("package.json", from);
    }

    let package = self.resolver.find_package(from)?;
    if let Some(package) = &package {
      self.invalidations.invalidate_on_file_change(&package.path);
    }
    Ok(package)
  }

  fn resolve_relative(&self, specifier: &Path, from: &Path) -> Result<Resolution, ResolverError> {
    // Resolve aliases from the nearest package.json.
    let path = from.with_file_name(specifier);
    let package = if self.resolver.flags.contains(Flags::ALIASES) {
      self.find_package(&path)?
    } else {
      None
    };

    if let Some(res) = self.load_path(&path, package, Prioritize::File)? {
      return Ok(res);
    }

    Err(ResolverError::FileNotFound {
      relative: specifier.to_owned(),
      from: from.to_owned(),
    })
  }

  fn resolve_bare(&self, module: &str, subpath: &str) -> Result<Resolution, ResolverError> {
    let include = match self.resolver.include_node_modules.as_ref() {
      IncludeNodeModules::Bool(b) => *b,
      IncludeNodeModules::Array(a) => a.iter().any(|v| v == module),
      IncludeNodeModules::Map(m) => *m.get(module).unwrap_or(&true),
    };

    if !include {
      return Ok(Resolution::External);
    }

    // First, check for a local alias within the parent package.json.
    if self.resolver.flags.contains(Flags::ALIASES) {
      if let Some(package) = self.find_package(&self.from)? {
        let mut fields = Fields::ALIAS;
        if self.resolver.entries.contains(Fields::BROWSER) {
          fields |= Fields::BROWSER;
        }
        if let Some(res) = self.resolve_aliases(
          package,
          &Specifier::Package(Cow::Borrowed(module), Cow::Borrowed(subpath)),
          fields,
        )? {
          return Ok(res);
        }
      }
    }

    // Next, check tsconfig.json for the paths and baseUrl options.
    if let Some(res) = self.resolve_tsconfig_paths()? {
      return Ok(res);
    }

    self.resolve_node_module(module, subpath)
  }

  fn resolve_node_module(&self, module: &str, subpath: &str) -> Result<Resolution, ResolverError> {
    // TODO: check if module == self

    // If there is a custom module directory resolver (e.g. Yarn PnP), use that.
    if let Some(module_dir_resolver) = &self.resolver.module_dir_resolver {
      let package_dir = module_dir_resolver(module, self.from)?;
      return self.resolve_package(package_dir, module, subpath);
    } else {
      self
        .invalidations
        .invalidate_on_file_create_above(format!("node_modules/{}", module), self.from);

      for dir in self.from.ancestors() {
        // Skip over node_modules directories
        if let Some(filename) = dir.file_name() {
          if filename == "node_modules" {
            continue;
          }
        }

        let package_dir = dir.join("node_modules").join(module);
        if self.resolver.cache.fs.is_dir(&package_dir) {
          return self.resolve_package(package_dir, module, subpath);
        }
      }
    }

    // NODE_PATH??

    Err(ResolverError::ModuleNotFound {
      module: module.to_owned(),
    })
  }

  fn resolve_package(
    &self,
    mut package_dir: PathBuf,
    module: &str,
    subpath: &str,
  ) -> Result<Resolution, ResolverError> {
    let package_path = package_dir.join("package.json");
    let package = self.invalidations.read(&package_path, || {
      self
        .resolver
        .cache
        .read_package(Cow::Borrowed(&package_path))
    });

    let package = match package {
      Ok(package) => package,
      Err(ResolverError::IOError(_)) => {
        // No package.json in node_modules is probably invalid but we have tests for it...
        if self.resolver.flags.contains(Flags::DIR_INDEX) {
          if let Some(res) = self.load_file(&package_dir.join(self.resolver.index_file), None)? {
            return Ok(res);
          }
        }

        return Err(ResolverError::ModuleNotFound {
          module: module.to_owned(),
        });
      }
      Err(err) => return Err(err),
    };

    // If the exports field is present, use the Node ESM algorithm.
    // Otherwise, fall back to classic CJS resolution.
    if self.resolver.flags.contains(Flags::EXPORTS) && package.has_exports() {
      let path = package
        .resolve_package_exports(subpath, self.conditions)
        .map_err(|e| ResolverError::PackageJsonError {
          module: package.name.to_owned(),
          path: package.path.clone(),
          error: e,
        })?;

      // Extensionless specifiers are not supported in the exports field.
      if let Some(res) = self.try_file_without_aliases(&path)? {
        return Ok(res);
      }

      // TODO: track location of resolved field
      return Err(ResolverError::ModuleSubpathNotFound {
        module: module.to_owned(),
        path,
        package_path: package.path.clone(),
      });
    } else if !subpath.is_empty() {
      package_dir.push(subpath);
      if let Some(res) = self.load_path(&package_dir, Some(&package), Prioritize::File)? {
        return Ok(res);
      }

      return Err(ResolverError::ModuleSubpathNotFound {
        module: module.to_owned(),
        path: package_dir,
        package_path: package.path.clone(),
      });
    } else {
      let res = self.try_package_entries(&package);
      if let Ok(Some(res)) = res {
        return Ok(res);
      }

      // Node ESM doesn't allow directory imports.
      if self.resolver.flags.contains(Flags::DIR_INDEX) {
        if let Some(res) =
          self.load_file(&package_dir.join(self.resolver.index_file), Some(&package))?
        {
          return Ok(res);
        }
      }

      if let Err(e) = res {
        return Err(e);
      }

      return Err(ResolverError::ModuleSubpathNotFound {
        module: module.to_owned(),
        path: package_dir.join(self.resolver.index_file),
        package_path: package.path.clone(),
      });
    }
  }

  fn try_package_entries(
    &self,
    package: &PackageJson,
  ) -> Result<Option<Resolution>, ResolverError> {
    // Try all entry fields.
    for (entry, field) in package.entries(self.resolver.entries) {
      let prioritize = if entry.extension().is_some() {
        Prioritize::File
      } else {
        Prioritize::Directory
      };

      if let Some(res) = self.load_path(&entry, Some(package), prioritize)? {
        return Ok(Some(res));
      } else {
        return Err(ResolverError::ModuleEntryNotFound {
          module: package.name.to_owned(),
          entry_path: entry,
          package_path: package.path.clone(),
          field,
        });
      }
    }

    Ok(None)
  }

  fn load_path(
    &self,
    path: &Path,
    package: Option<&PackageJson>,
    prioritize: Prioritize,
  ) -> Result<Option<Resolution>, ResolverError> {
    // Urls and Node ESM do not resolve directory index files.
    if !self.resolver.flags.contains(Flags::DIR_INDEX) || self.specifier_type == SpecifierType::Url
    {
      return self.load_file(path, package);
    }

    if prioritize == Prioritize::Directory {
      if let Some(res) = self.load_directory(path, package)? {
        return Ok(Some(res));
      }
      self.load_file(path, package)
    } else {
      if let Some(res) = self.load_file(path, package)? {
        return Ok(Some(res));
      }
      self.load_directory(path, package)
    }
  }

  fn load_file(
    &self,
    path: &Path,
    package: Option<&PackageJson>,
  ) -> Result<Option<Resolution>, ResolverError> {
    // First try the path as is.
    // TypeScript only supports resolving specifiers ending with `.ts` or `.tsx`
    // in a certain mode, but we always allow it.
    if let Some(res) = self.try_suffixes(path, "", package)? {
      return Ok(Some(res));
    }

    // TypeScript allows a specifier like "./foo.js" to resolve to "./foo.ts".
    // TSC does this before trying to append an extension. We match this
    // rather than matching "./foo.js.ts", which seems more unlikely.
    // However, if "./foo.js" exists we will resolve to it (above), unlike TSC.
    // This is to match Node and other bundlers.
    if self.resolver.flags.contains(Flags::TYPESCRIPT_EXTENSIONS)
      && self.flags.contains(RequestFlags::IN_TS_FILE)
      && !self.flags.contains(RequestFlags::IN_NODE_MODULES)
      && self.specifier_type != SpecifierType::Url
    {
      if let Some(ext) = path.extension() {
        // TODO: would be nice if there was a way to do this without cloning
        // but OsStr doesn't let you create a slice.
        let without_extension = &path.with_extension("");
        let res = if ext == "js" || ext == "jsx" {
          // TSC always prioritizes .ts over .tsx, even when the original extension was .jsx.
          self.try_extensions(&without_extension, package, &["ts", "tsx"], false)?
        } else if ext == "mjs" {
          self.try_extensions(&without_extension, package, &["mts"], false)?
        } else if ext == "cjs" {
          self.try_extensions(&without_extension, package, &["cts"], false)?
        } else {
          None
        };

        if res.is_some() {
          return Ok(res);
        }
      }
    }

    // Try adding the same extension as in the parent file first.
    // TODO: only for certain extensions?
    if let Some(ext) = self.priority_extension {
      if let Some(res) = self.try_extensions(path, package, &[ext], false)? {
        return Ok(Some(res));
      }
    }

    self.try_extensions(path, package, &self.resolver.extensions, true)
  }

  fn try_extensions(
    &self,
    path: &Path,
    package: Option<&PackageJson>,
    extensions: &[&str],
    skip_parent: bool,
  ) -> Result<Option<Resolution>, ResolverError> {
    if self.resolver.flags.contains(Flags::OPTIONAL_EXTENSIONS)
      && self.specifier_type != SpecifierType::Url
    {
      // Try appending each extension.
      for ext in extensions {
        // Skip parent extension if we already tried it.
        if skip_parent
          && self.resolver.flags.contains(Flags::PARENT_EXTENSION)
          && matches!(self.from.extension(), Some(e) if e == *ext)
        {
          continue;
        }

        if let Some(res) = self.try_suffixes(path, ext, package)? {
          return Ok(Some(res));
        }
      }
    }

    Ok(None)
  }

  fn try_suffixes(
    &self,
    path: &Path,
    ext: &str,
    package: Option<&PackageJson>,
  ) -> Result<Option<Resolution>, ResolverError> {
    // TypeScript supports a moduleSuffixes option in tsconfig.json which allows suffixes
    // such as ".ios" to be appended just before the last extension.
    let module_suffixes = self
      .tsconfig()?
      .and_then(|tsconfig| tsconfig.module_suffixes.as_ref())
      .map_or([""].as_slice(), |v| v.as_slice());

    for suffix in module_suffixes {
      let mut p = if *suffix != "" {
        // The suffix is placed before the _last_ extension. If we will be appending
        // another extension later, then we only need to append the suffix first.
        // Otherwise, we need to remove the original extension so we can add the suffix.
        // TODO: TypeScript only removes certain extensions here...
        let original_ext = path.extension();
        let mut s = if ext == "" && original_ext.is_some() {
          path.with_extension("").into_os_string()
        } else {
          path.into()
        };

        // Append the suffix (this is not necessarily an extension).
        s.push(suffix);

        // Re-add the original extension if we removed it earlier.
        if ext == "" {
          if let Some(original_ext) = original_ext {
            s.push(".");
            s.push(original_ext);
          }
        }

        Cow::Owned(PathBuf::from(s))
      } else {
        Cow::Borrowed(path)
      };

      if ext != "" {
        // Append the extension.
        let mut s = p.into_owned().into_os_string();
        s.push(".");
        s.push(ext);
        p = Cow::Owned(PathBuf::from(s));
      }

      if let Some(res) = self.try_file(p.as_ref(), package)? {
        return Ok(Some(res));
      }
    }

    Ok(None)
  }

  fn try_file(
    &self,
    path: &Path,
    package: Option<&PackageJson>,
  ) -> Result<Option<Resolution>, ResolverError> {
    if self.resolver.flags.contains(Flags::ALIASES) {
      if let Some(package) = package {
        if let Ok(s) = path.strip_prefix(package.path.parent().unwrap()) {
          let specifier = Specifier::Relative(Cow::Borrowed(s));
          let mut fields = Fields::ALIAS;
          if self.resolver.entries.contains(Fields::BROWSER) {
            fields |= Fields::BROWSER;
          }
          if let Some(res) = self.resolve_aliases(package, &specifier, fields)? {
            return Ok(Some(res));
          }
        }
      }
    }

    self.try_file_without_aliases(path)
  }

  fn try_file_without_aliases(&self, path: &Path) -> Result<Option<Resolution>, ResolverError> {
    if self.resolver.cache.fs.is_file(path) {
      Ok(Some(Resolution::Path(
        self.resolver.cache.fs.canonicalize(path)?,
      )))
    } else {
      self.invalidations.invalidate_on_file_create(path);
      Ok(None)
    }
  }

  fn load_directory(
    &self,
    dir: &Path,
    parent_package: Option<&PackageJson>,
  ) -> Result<Option<Resolution>, ResolverError> {
    // Check if there is a package.json in this directory, and if so, use its entries.
    // Note that the "exports" field is NOT used here - only in resolve_node_module.
    let path = dir.join("package.json");
    let mut res = Ok(None);
    let package = if let Ok(package) = self.invalidations.read(&path, || {
      self.resolver.cache.read_package(Cow::Borrowed(&path))
    }) {
      res = self.try_package_entries(&package);
      if matches!(res, Ok(Some(_))) {
        return res;
      }
      Some(package)
    } else {
      None
    };

    // If no package.json, or no entries, try an index file with all possible extensions.
    if self.resolver.flags.contains(Flags::DIR_INDEX) && self.resolver.cache.fs.is_dir(dir) {
      return self.load_file(
        &dir.join(self.resolver.index_file),
        package.or(parent_package),
      );
    }

    res
  }

  fn resolve_tsconfig_paths(&self) -> Result<Option<Resolution>, ResolverError> {
    if let Some(tsconfig) = self.tsconfig()? {
      for path in tsconfig.paths(&self.specifier) {
        // TODO: should aliases apply to tsconfig paths??
        if let Some(res) = self.load_path(&path, None, Prioritize::File)? {
          return Ok(Some(res));
        }
      }
    }

    Ok(None)
  }

  fn tsconfig(&self) -> Result<&Option<&TsConfig>, ResolverError> {
    if self.resolver.flags.contains(Flags::TSCONFIG)
      && self
        .flags
        .intersects(RequestFlags::IN_TS_FILE | RequestFlags::IN_JS_FILE)
      && !self.flags.contains(RequestFlags::IN_NODE_MODULES)
    {
      self.tsconfig.get_or_try_init(|| {
        if let Some(path) = self.find_ancestor_file(&self.from, "tsconfig.json") {
          let tsconfig = self.read_tsconfig(path)?;
          return Ok(Some(tsconfig));
        }

        Ok(None)
      })
    } else {
      Ok(&None)
    }
  }

  fn read_tsconfig(&self, path: PathBuf) -> Result<&'a TsConfig<'a>, ResolverError> {
    let tsconfig = self.invalidations.read(&path, || {
      self.resolver.cache.read_tsconfig(&path, |tsconfig| {
        for i in 0..tsconfig.extends.len() {
          let path = match &tsconfig.extends[i] {
            Specifier::Absolute(path) => path.as_ref().to_owned(),
            Specifier::Relative(path) => {
              let mut absolute_path = tsconfig.compiler_options.path.with_file_name(path.as_ref());

              // TypeScript allows "." and ".." to implicitly refer to a tsconfig.json file.
              if path == Path::new(".") || path == Path::new("..") {
                absolute_path.push("tsconfig.json");
              }

              absolute_path
            }
            specifier @ Specifier::Package(..) => {
              let resolver = Resolver {
                project_root: Cow::Borrowed(&self.resolver.project_root),
                extensions: &["json"],
                index_file: "tsconfig.json",
                entries: Fields::TSCONFIG,
                flags: Flags::NODE_CJS,
                cache: CacheCow::Borrowed(&self.resolver.cache),
                include_node_modules: Cow::Borrowed(self.resolver.include_node_modules.as_ref()),
                conditions: ExportsCondition::TYPES,
                module_dir_resolver: self.resolver.module_dir_resolver.clone(),
              };

              let req = ResolveRequest::new(
                &resolver,
                specifier,
                SpecifierType::Cjs,
                &tsconfig.compiler_options.path,
                self.invalidations,
              );

              if let Resolution::Path(res) = req.resolve()? {
                res
              } else {
                return Err(ResolverError::UnknownError);
              }
            }
            _ => return Ok(()),
          };

          let extended = self.read_tsconfig(path)?;
          tsconfig.compiler_options.extend(extended);
        }

        Ok(())
      })
    })?;

    Ok(&tsconfig.compiler_options)
  }
}

#[cfg(test)]
mod tests {
  use std::collections::HashSet;

  use super::cache::Cache;
  use super::*;

  fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
      .parent()
      .unwrap()
      .join("node-resolver-core/test/fixture")
  }

  fn test_resolver<'a>() -> Resolver<'a, OsFileSystem> {
    Resolver::parcel(root().into(), CacheCow::Owned(Cache::default()))
  }

  fn node_resolver<'a>() -> Resolver<'a, OsFileSystem> {
    Resolver::node(root().into(), CacheCow::Owned(Cache::default()))
  }

  #[test]
  fn relative() {
    assert_eq!(
      test_resolver()
        .resolve("./bar.js", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("./bar", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("~/bar", &root().join("nested/test.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("~bar", &root().join("nested/test.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "~/bar",
          &root().join("node_modules/foo/nested/baz.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("./nested", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("./bar?foo=2", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("./bar?foo=2", &root().join("foo.js"), SpecifierType::Cjs)
        .result
        .unwrap_err(),
      ResolverError::FileNotFound {
        relative: "bar?foo=2".into(),
        from: root().join("foo.js")
      },
    );

    let invalidations = test_resolver()
      .resolve("./bar", &root().join("foo.js"), SpecifierType::Esm)
      .invalidations;
    assert_eq!(
      *invalidations.invalidate_on_file_create.read().unwrap(),
      HashSet::from([
        FileCreateInvalidation::Path(root().join("bar")),
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root().join("bar")
        },
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root()
        },
        FileCreateInvalidation::FileName {
          file_name: "tsconfig.json".into(),
          above: root().join("foo.js")
        },
      ])
    );
    assert_eq!(
      *invalidations.invalidate_on_file_change.read().unwrap(),
      HashSet::from([root().join("package.json"), root().join("tsconfig.json")])
    );
  }

  #[test]
  fn test_absolute() {
    assert_eq!(
      test_resolver()
        .resolve("/bar", &root().join("nested/test.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "/bar",
          &root().join("node_modules/foo/index.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "file:///bar",
          &root().join("nested/test.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      node_resolver()
        .resolve(
          root().join("foo.js").to_str().unwrap(),
          &root().join("nested/test.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("foo.js"))
    );
    assert_eq!(
      node_resolver()
        .resolve(
          &format!("file://{}", root().join("foo.js").to_str().unwrap()),
          &root().join("nested/test.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("foo.js"))
    );
  }

  #[test]
  fn node_modules() {
    assert_eq!(
      test_resolver()
        .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("package-main", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-main/main.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("package-module", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-module/module.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-browser",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-browser/browser.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-fallback",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-fallback/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-main-directory",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-main-directory/nested/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("foo/nested/baz", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/nested/baz.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/@scope/pkg/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "@scope/pkg/foo/bar",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/@scope/pkg/foo/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "foo/with space.mjs",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/with space.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "foo/with%20space.mjs",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/with space.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "foo/with space.mjs",
          &root().join("foo.js"),
          SpecifierType::Cjs
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/with space.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "foo/with%20space.mjs",
          &root().join("foo.js"),
          SpecifierType::Cjs
        )
        .result
        .unwrap_err(),
      ResolverError::ModuleSubpathNotFound {
        module: "foo".into(),
        path: root().join("node_modules/foo/with%20space.mjs"),
        package_path: root().join("node_modules/foo/package.json")
      },
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "@scope/pkg?foo=2",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/@scope/pkg/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "@scope/pkg?foo=2",
          &root().join("foo.js"),
          SpecifierType::Cjs
        )
        .result
        .unwrap_err(),
      ResolverError::ModuleNotFound {
        module: "@scope/pkg?foo=2".into()
      },
    );

    let invalidations = test_resolver()
      .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
      .invalidations;
    assert_eq!(
      *invalidations.invalidate_on_file_create.read().unwrap(),
      HashSet::from([
        FileCreateInvalidation::FileName {
          file_name: "node_modules/foo".into(),
          above: root().join("foo.js")
        },
        FileCreateInvalidation::Path(root().join("node_modules/foo/index")),
        FileCreateInvalidation::FileName {
          file_name: "tsconfig.json".into(),
          above: root().join("foo.js")
        },
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root().join("foo.js")
        },
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root()
        },
      ])
    );
    assert_eq!(
      *invalidations.invalidate_on_file_change.read().unwrap(),
      HashSet::from([
        root().join("node_modules/foo/package.json"),
        root().join("package.json"),
        root().join("tsconfig.json")
      ])
    );
  }

  #[test]
  fn browser_field() {
    assert_eq!(
      test_resolver()
        .resolve(
          "package-browser-alias",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-browser-alias/browser.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-browser-alias/foo",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-browser-alias/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./foo",
          &root().join("node_modules/package-browser-alias/browser.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-browser-alias/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./nested",
          &root().join("node_modules/package-browser-alias/browser.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(
        root().join("node_modules/package-browser-alias/subfolder1/subfolder2/subfile.js")
      )
    );
  }

  #[test]
  fn local_aliases() {
    assert_eq!(
      test_resolver()
        .resolve(
          "package-alias/foo",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-alias/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./foo",
          &root().join("node_modules/package-alias/browser.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-alias/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./lib/test",
          &root().join("node_modules/package-alias-glob/browser.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-alias-glob/src/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-browser-exclude",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Empty
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./lib/test",
          &root().join("node_modules/package-alias-glob/index.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-alias-glob/src/test.js"))
    );

    let invalidations = test_resolver()
      .resolve(
        "package-alias/foo",
        &root().join("foo.js"),
        SpecifierType::Esm,
      )
      .invalidations;
    assert_eq!(
      *invalidations.invalidate_on_file_create.read().unwrap(),
      HashSet::from([
        FileCreateInvalidation::FileName {
          file_name: "node_modules/package-alias".into(),
          above: root().join("foo.js")
        },
        FileCreateInvalidation::Path(root().join("node_modules/package-alias/bar")),
        FileCreateInvalidation::FileName {
          file_name: "tsconfig.json".into(),
          above: root().join("foo.js")
        },
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root().join("foo.js")
        },
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root()
        },
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root().join("node_modules/package-alias/bar")
        },
      ])
    );
    assert_eq!(
      *invalidations.invalidate_on_file_change.read().unwrap(),
      HashSet::from([
        root().join("node_modules/package-alias/package.json"),
        root().join("package.json"),
        root().join("tsconfig.json")
      ])
    );
  }

  #[test]
  fn global_aliases() {
    assert_eq!(
      test_resolver()
        .resolve("aliased", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliased",
          &root().join("node_modules/package-alias/foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliased/bar",
          &root().join("node_modules/package-alias/foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("aliased-file", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliased-file",
          &root().join("node_modules/package-alias/foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliasedfolder/test.js",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("aliasedfolder", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliasedabsolute/test.js",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliasedabsolute",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("foo/bar", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("glob/bar/test", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("something", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "something",
          &root().join("node_modules/package-alias/foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-alias-exclude",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Empty
    );
  }

  #[test]
  fn test_urls() {
    assert_eq!(
      test_resolver()
        .resolve(
          "http://example.com/foo.png",
          &root().join("foo.js"),
          SpecifierType::Url
        )
        .result
        .unwrap()
        .0,
      Resolution::External
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "//example.com/foo.png",
          &root().join("foo.js"),
          SpecifierType::Url
        )
        .result
        .unwrap()
        .0,
      Resolution::External
    );
    assert_eq!(
      test_resolver()
        .resolve("#hash", &root().join("foo.js"), SpecifierType::Url)
        .result
        .unwrap()
        .0,
      Resolution::External
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "http://example.com/foo.png",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap_err(),
      ResolverError::UnknownScheme {
        scheme: "http".into()
      },
    );
    assert_eq!(
      test_resolver()
        .resolve("bar.js", &root().join("foo.js"), SpecifierType::Url)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("bar", &root().join("foo.js"), SpecifierType::Url)
        .result
        .unwrap_err(),
      ResolverError::FileNotFound {
        relative: "bar".into(),
        from: root().join("foo.js")
      }
    );
    assert_eq!(
      test_resolver()
        .resolve("npm:foo", &root().join("foo.js"), SpecifierType::Url)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("npm:@scope/pkg", &root().join("foo.js"), SpecifierType::Url)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/@scope/pkg/index.js"))
    );
  }

  #[test]
  fn test_exports() {
    assert_eq!(
      test_resolver()
        .resolve(
          "package-exports",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-exports/main.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-exports/foo",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      // "browser" field is NOT used.
      Resolution::Path(root().join("node_modules/package-exports/foo.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-exports/features/test",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-exports/features/test.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-exports/space",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-exports/with space.mjs"))
    );
    // assert_eq!(
    //   test_resolver().resolve("package-exports/with%20space", &root().join("foo.js"), SpecifierType::Esm).unwrap().0,
    //   Resolution::Path(root().join("node_modules/package-exports/with space.mjs"))
    // );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-exports/with space",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap_err(),
      ResolverError::PackageJsonError {
        module: "package-exports".into(),
        path: root().join("node_modules/package-exports/package.json"),
        error: PackageJsonError::PackagePathNotExported
      },
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-exports/internal",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap_err(),
      ResolverError::PackageJsonError {
        module: "package-exports".into(),
        path: root().join("node_modules/package-exports/package.json"),
        error: PackageJsonError::PackagePathNotExported
      },
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-exports/internal.mjs",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap_err(),
      ResolverError::PackageJsonError {
        module: "package-exports".into(),
        path: root().join("node_modules/package-exports/package.json"),
        error: PackageJsonError::PackagePathNotExported
      },
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-exports/invalid",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap_err(),
      ResolverError::PackageJsonError {
        module: "package-exports".into(),
        path: root().join("node_modules/package-exports/package.json"),
        error: PackageJsonError::InvalidPackageTarget
      }
    );
  }

  #[test]
  fn test_imports() {
    assert_eq!(
      test_resolver()
        .resolve(
          "#internal",
          &root().join("node_modules/package-exports/main.mjs"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-exports/internal.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "#foo",
          &root().join("node_modules/package-exports/main.mjs"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
  }

  #[test]
  fn test_builtins() {
    assert_eq!(
      test_resolver()
        .resolve("zlib", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Builtin("zlib".into())
    );
    assert_eq!(
      test_resolver()
        .resolve("node:zlib", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Builtin("zlib".into())
    );
  }

  #[test]
  fn test_tsconfig() {
    assert_eq!(
      test_resolver()
        .resolve("ts-path", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("foo.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "ts-path",
          &root().join("nested/index.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "foo",
          &root().join("tsconfig/index/index.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/tsconfig-index/foo.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "foo",
          &root().join("tsconfig/field/index.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/tsconfig-field/foo.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "foo",
          &root().join("tsconfig/exports/index.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/tsconfig-exports/foo.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "ts-path",
          &root().join("node_modules/tsconfig-not-used/index.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap_err(),
      ResolverError::ModuleNotFound {
        module: "ts-path".into()
      },
    );
    assert_eq!(
      test_resolver()
        .resolve("ts-path", &root().join("foo.css"), SpecifierType::Esm)
        .result
        .unwrap_err(),
      ResolverError::ModuleNotFound {
        module: "ts-path".into()
      },
    );

    let invalidations = test_resolver()
      .resolve("ts-path", &root().join("foo.js"), SpecifierType::Esm)
      .invalidations;
    assert_eq!(
      *invalidations.invalidate_on_file_create.read().unwrap(),
      HashSet::from([
        FileCreateInvalidation::FileName {
          file_name: "tsconfig.json".into(),
          above: root().join("foo.js")
        },
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root().join("foo.js")
        },
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root()
        }
      ])
    );
    assert_eq!(
      *invalidations.invalidate_on_file_change.read().unwrap(),
      HashSet::from([root().join("package.json"), root().join("tsconfig.json")])
    );
  }

  #[test]
  fn test_module_suffixes() {
    assert_eq!(
      test_resolver()
        .resolve(
          "./a",
          &root().join("tsconfig/suffixes/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("tsconfig/suffixes/a.ios.ts"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./a.ts",
          &root().join("tsconfig/suffixes/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("tsconfig/suffixes/a.ios.ts"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./b",
          &root().join("tsconfig/suffixes/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("tsconfig/suffixes/b.ts"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./b.ts",
          &root().join("tsconfig/suffixes/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("tsconfig/suffixes/b.ts"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./c",
          &root().join("tsconfig/suffixes/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("tsconfig/suffixes/c-test.ts"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./c.ts",
          &root().join("tsconfig/suffixes/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("tsconfig/suffixes/c-test.ts"))
    );
  }

  #[test]
  fn test_ts_extensions() {
    assert_eq!(
      test_resolver()
        .resolve(
          "./a.js",
          &root().join("ts-extensions/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("ts-extensions/a.ts"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./a.jsx",
          &root().join("ts-extensions/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      // TSC always prioritizes .ts over .tsx
      Resolution::Path(root().join("ts-extensions/a.ts"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./a.mjs",
          &root().join("ts-extensions/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("ts-extensions/a.mts"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./a.cjs",
          &root().join("ts-extensions/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("ts-extensions/a.cts"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./b.js",
          &root().join("ts-extensions/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      // We deviate from TSC here to match Node/bundlers.
      Resolution::Path(root().join("ts-extensions/b.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./c.js",
          &root().join("ts-extensions/index.ts"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      // This matches TSC. c.js.ts seems kinda unlikely?
      Resolution::Path(root().join("ts-extensions/c.ts"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./a.js",
          &root().join("ts-extensions/index.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap_err(),
      ResolverError::FileNotFound {
        relative: "a.js".into(),
        from: root().join("ts-extensions/index.js")
      },
    );

    let invalidations = test_resolver()
      .resolve(
        "./a.js",
        &root().join("ts-extensions/index.ts"),
        SpecifierType::Esm,
      )
      .invalidations;
    assert_eq!(
      *invalidations.invalidate_on_file_create.read().unwrap(),
      HashSet::from([
        FileCreateInvalidation::Path(root().join("ts-extensions/a.js")),
        FileCreateInvalidation::FileName {
          file_name: "tsconfig.json".into(),
          above: root().join("ts-extensions/index.ts")
        },
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root().join("ts-extensions/a.js")
        },
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root()
        },
      ])
    );
    assert_eq!(
      *invalidations.invalidate_on_file_change.read().unwrap(),
      HashSet::from([root().join("package.json"), root().join("tsconfig.json")])
    );
  }

  fn resolve_side_effects(specifier: &str, from: &Path) -> bool {
    let resolver = test_resolver();
    let resolved = resolver
      .resolve(specifier, from, SpecifierType::Esm)
      .result
      .unwrap()
      .0;

    if let Resolution::Path(path) = resolved {
      resolver.resolve_side_effects(&path).unwrap()
    } else {
      unreachable!()
    }
  }

  #[test]
  fn test_side_effects() {
    assert_eq!(
      resolve_side_effects("side-effects-false/src/index.js", &root().join("foo.js")),
      false,
    );
    assert_eq!(
      resolve_side_effects("side-effects-false/src/index", &root().join("foo.js")),
      false,
    );
    assert_eq!(
      resolve_side_effects("side-effects-false/src/", &root().join("foo.js")),
      false,
    );
    assert_eq!(
      resolve_side_effects("side-effects-false", &root().join("foo.js")),
      false,
    );
    assert_eq!(
      resolve_side_effects(
        "side-effects-package-redirect-up/foo/bar",
        &root().join("foo.js")
      ),
      false,
    );
    assert_eq!(
      resolve_side_effects(
        "side-effects-package-redirect-down/foo/bar",
        &root().join("foo.js")
      ),
      false,
    );
    assert_eq!(
      resolve_side_effects("side-effects-false-glob/a/index", &root().join("foo.js")),
      true,
    );
    assert_eq!(
      resolve_side_effects("side-effects-false-glob/b/index.js", &root().join("foo.js")),
      false,
    );
    assert_eq!(
      resolve_side_effects(
        "side-effects-false-glob/sub/a/index.js",
        &root().join("foo.js")
      ),
      false,
    );
    assert_eq!(
      resolve_side_effects(
        "side-effects-false-glob/sub/index.json",
        &root().join("foo.js")
      ),
      true,
    );
  }

  #[test]
  fn test_include_node_modules() {
    let mut resolver = test_resolver();
    resolver.include_node_modules = Cow::Owned(IncludeNodeModules::Bool(false));

    assert_eq!(
      resolver
        .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::External
    );
    assert_eq!(
      resolver
        .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::External
    );

    resolver.include_node_modules = Cow::Owned(IncludeNodeModules::Array(vec!["foo".into()]));
    assert_eq!(
      resolver
        .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      resolver
        .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::External
    );

    resolver.include_node_modules = Cow::Owned(IncludeNodeModules::Map(HashMap::from([
      ("foo".into(), false),
      ("@scope/pkg".into(), true),
    ])));
    assert_eq!(
      resolver
        .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::External
    );
    assert_eq!(
      resolver
        .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/@scope/pkg/index.js"))
    );
  }

  // #[test]
  // fn test_visitor() {
  //   let resolved = test_resolver().resolve("unified", &root(), SpecifierType::Esm).unwrap();
  //   println!("{:?}", resolved);
  //   if let Resolution::Path(p) = resolved {
  //     let res = build_esm_graph(
  //       &p,
  //       root()
  //     ).unwrap();
  //     println!("{:?}", res);
  //   }
  // }
}
