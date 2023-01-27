use bitflags::bitflags;
use cache::JsonError;
use once_cell::unsync::OnceCell;
use serde::Serialize;
use std::{
  borrow::Cow,
  collections::{HashMap, HashSet},
  path::{Path, PathBuf},
  rc::Rc,
  sync::RwLock,
};
// use es_module_lexer::{lex, ImportKind};
use specifier::{parse_package_specifier, parse_scheme};

use package_json::{AliasValue, ExportsResolution, PackageJson};
use specifier::Specifier;
use tsconfig::TsConfig;

mod builtins;
mod cache;
mod fs;
mod package_json;
mod specifier;
mod tsconfig;

pub use cache::{Cache, CacheCow};
pub use fs::{FileSystem, OsFileSystem};
pub use package_json::{Fields, PackageJsonError};

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

pub struct Resolver<'a, Fs> {
  pub project_root: Cow<'a, Path>,
  pub extensions: &'a [&'a str],
  pub index_file: &'a str,
  pub entries: Fields,
  pub flags: Flags,
  pub include_node_modules: Cow<'a, IncludeNodeModules>,
  cache: CacheCow<'a, Fs>,
  root_package: OnceCell<Option<PathBuf>>,
}

#[derive(PartialEq, Eq, Hash, Debug)]
pub enum FileCreateInvalidation {
  Path(PathBuf),
  FileName { file_name: String, above: PathBuf },
}

#[derive(Default, Debug)]
pub struct Invalidations {
  pub invalidate_on_file_create: RwLock<HashSet<FileCreateInvalidation>>,
  pub invalidate_on_file_change: RwLock<HashSet<PathBuf>>,
}

impl Invalidations {
  fn invalidate_on_file_create(&self, invalidation: FileCreateInvalidation) {
    self
      .invalidate_on_file_create
      .write()
      .unwrap()
      .insert(invalidation);
  }

  fn invalidate_on_file_change(&self, invalidation: PathBuf) {
    self
      .invalidate_on_file_change
      .write()
      .unwrap()
      .insert(invalidation);
  }

  fn read<V, F: FnOnce() -> Result<V, ResolverError>>(
    &self,
    path: &Path,
    f: F,
  ) -> Result<V, ResolverError> {
    match f() {
      Ok(v) => {
        self.invalidate_on_file_change(path.to_owned());
        Ok(v)
      }
      Err(e) => {
        if matches!(e, ResolverError::IOError(..)) {
          self.invalidate_on_file_create(FileCreateInvalidation::Path(path.to_owned()));
        }
        Err(e)
      }
    }
  }
}

#[derive(PartialEq, Eq, Clone, Copy)]
pub enum SpecifierType {
  Esm,
  Cjs,
  Url,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum ResolverError {
  EmptySpecifier,
  UnknownScheme {
    scheme: String,
  },
  UnknownError,
  FileNotFound {
    relative: PathBuf,
    from: PathBuf,
  },
  ModuleNotFound {
    module: String,
  },
  ModuleEntryNotFound {
    module: String,
    entry_path: PathBuf,
    package_path: PathBuf,
    field: &'static str,
  },
  ModuleSubpathNotFound {
    module: String,
    path: PathBuf,
    package_path: PathBuf,
  },
  InvalidAlias,
  JsonError(JsonError),
  #[serde(serialize_with = "serialize_io_error")]
  IOError(Rc<std::io::Error>),
  PackageJsonError(PackageJsonError),
}

fn serialize_io_error<S: serde::Serializer>(
  e: &Rc<std::io::Error>,
  s: S,
) -> Result<S::Ok, S::Error> {
  e.to_string().serialize(s)
}

impl From<()> for ResolverError {
  fn from(_: ()) -> Self {
    ResolverError::UnknownError
  }
}

impl From<std::str::Utf8Error> for ResolverError {
  fn from(_: std::str::Utf8Error) -> Self {
    ResolverError::UnknownError
  }
}

impl From<JsonError> for ResolverError {
  fn from(e: JsonError) -> Self {
    ResolverError::JsonError(e)
  }
}

impl From<std::io::Error> for ResolverError {
  fn from(e: std::io::Error) -> Self {
    ResolverError::IOError(Rc::new(e))
  }
}

impl From<PackageJsonError> for ResolverError {
  fn from(e: PackageJsonError) -> Self {
    ResolverError::PackageJsonError(e)
  }
}

// Can't derive this because std::io::Error and serde_json::Error don't implement it.
impl PartialEq for ResolverError {
  fn eq(&self, other: &Self) -> bool {
    use ResolverError::*;

    match (self, other) {
      (EmptySpecifier, EmptySpecifier) | (UnknownError, UnknownError) => true,
      (UnknownScheme { scheme: a }, UnknownScheme { scheme: b }) => a == b,
      (
        FileNotFound {
          relative: ra,
          from: fa,
        },
        FileNotFound {
          relative: rb,
          from: fb,
        },
      ) => ra == rb && fa == fb,
      (ModuleNotFound { module: a }, ModuleNotFound { module: b }) => a == b,
      (
        ModuleEntryNotFound {
          module: ma,
          entry_path: ea,
          package_path: pa,
          field: fa,
        },
        ModuleEntryNotFound {
          module: mb,
          entry_path: eb,
          package_path: pb,
          field: fb,
        },
      ) => ma == mb && ea == eb && pa == pb && fa == fb,
      (
        ModuleSubpathNotFound {
          module: ma,
          path: pa,
          package_path: ppa,
        },
        ModuleSubpathNotFound {
          module: mb,
          path: pb,
          package_path: ppb,
        },
      ) => ma == mb && pa == pb && ppa == ppb,
      (InvalidAlias, InvalidAlias) => true,
      (PackageJsonError(a), PackageJsonError(b)) => a == b,
      _ => false,
    }
  }
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum Resolution {
  Excluded,
  Path(PathBuf),
  Builtin(String),
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
      root_package: OnceCell::new(),
      include_node_modules: Cow::Owned(IncludeNodeModules::default()),
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
      root_package: OnceCell::new(),
      include_node_modules: Cow::Owned(IncludeNodeModules::default()),
    }
  }

  pub fn resolve(
    &self,
    specifier: &str,
    from: &Path,
    specifier_type: SpecifierType,
  ) -> Result<(Resolution, Invalidations), (ResolverError, Invalidations)> {
    if specifier.is_empty() {
      return Err((ResolverError::EmptySpecifier, Invalidations::default()));
    }

    let invalidations = Invalidations::default();
    let specifier = match Specifier::parse(specifier, specifier_type, self.flags) {
      Ok(s) => s,
      Err(e) => return Err((e.into(), invalidations)),
    };
    let request = ResolveRequest::new(self, &specifier, specifier_type, from, &invalidations);
    match request.resolve() {
      Ok(r) => Ok((r, invalidations)),
      Err(r) => Err((r, invalidations)),
    }
  }

  pub fn resolve_side_effects(&self, path: &Path) -> Result<bool, ResolverError> {
    if let Some(package) = self.find_package(path.parent().unwrap())? {
      Ok(package.has_side_effects(path))
    } else {
      Ok(true)
    }
  }

  fn root_package(&self) -> Result<Option<&PackageJson>, ResolverError> {
    if self.flags.contains(Flags::ALIASES) {
      let path = self
        .root_package
        .get_or_init(|| self.find_ancestor_file(&self.project_root, "package.json"));
      if let Some(path) = path {
        let package = self.cache.read_package(Cow::Borrowed(path))?;
        return Ok(Some(package));
      }
    }

    Ok(None)
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

    Self {
      resolver,
      specifier,
      specifier_type,
      from,
      flags,
      tsconfig: OnceCell::new(),
      invalidations,
    }
  }

  fn resolve_aliases(
    &self,
    package: &PackageJson,
    specifier: &Specifier,
    fields: Fields,
  ) -> Result<Option<Resolution>, ResolverError> {
    match package.resolve_aliases(&specifier, fields) {
      Some(alias) => match alias.as_ref() {
        AliasValue::Specifier(specifier) => {
          let req = ResolveRequest::new(
            &self.resolver,
            specifier,
            SpecifierType::Cjs,
            &package.path,
            self.invalidations,
          );
          let resolved = req.resolve_specifier()?;
          Ok(Some(resolved))
        }
        AliasValue::Bool(false) => Ok(Some(Resolution::Excluded)),
        AliasValue::Bool(true) => Err(ResolverError::InvalidAlias),
        _ => todo!(),
      },
      None => Ok(None),
    }
  }

  fn resolve(&self) -> Result<Resolution, ResolverError> {
    // First, check the project root package.json for any aliases.
    let path = self.resolver.project_root.join("package.json");
    if let Some(package) = self
      .invalidations
      .read(&path, || self.resolver.root_package())?
    {
      if let Some(res) = self.resolve_aliases(&package, &self.specifier, Fields::ALIAS)? {
        return Ok(res);
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

        Err(ResolverError::UnknownError)
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
          Ok(Resolution::Excluded)
        } else if self.specifier_type == SpecifierType::Esm
          && self.resolver.flags.contains(Flags::EXPORTS)
        {
          // An internal package #import specifier.
          let package = self.find_package(&self.from)?;
          if let Some(package) = package {
            match package.resolve_package_imports(&hash, &[])? {
              ExportsResolution::Path(path) => {
                // Extensionless specifiers are not supported in the imports field.
                if let Some(res) = self.try_file_without_aliases(&path)? {
                  return Ok(res);
                }
              }
              ExportsResolution::Package(specifier) => {
                let (module, subpath) = parse_package_specifier(&specifier)?;
                return self.resolve_bare(module, subpath);
              }
              _ => {}
            }
          }

          Err(ResolverError::UnknownError)
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
          Ok(Resolution::Excluded)
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
      .invalidate_on_file_create(FileCreateInvalidation::FileName {
        file_name: filename.into(),
        above: from.to_owned(),
      });

    let res = self.resolver.find_ancestor_file(from, filename);
    if let Some(path) = &res {
      self
        .invalidations
        .invalidate_on_file_change(path.to_owned());
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
        .invalidate_on_file_create(FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: from.to_owned(),
        });
    }

    let package = self.resolver.find_package(from)?;
    if let Some(package) = &package {
      self
        .invalidations
        .invalidate_on_file_change(package.path.clone());
    }
    Ok(package)
  }

  fn resolve_relative(&self, specifier: &Path, from: &Path) -> Result<Resolution, ResolverError> {
    // Find a package.json above the source file where the dependency was located.
    // This is used to resolve any aliases.
    let package = self.find_package(from)?;
    if let Some(res) = self.load_path(&from.with_file_name(specifier), package, Prioritize::File)? {
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
      return Ok(Resolution::Excluded);
    }

    // First check tsconfig.json for the paths and baseUrl options.
    if let Some(res) = self.resolve_tsconfig_paths()? {
      return Ok(res);
    }

    self.resolve_node_module(module, subpath)
  }

  fn resolve_node_module(&self, module: &str, subpath: &str) -> Result<Resolution, ResolverError> {
    // TODO: do pnp here
    // TODO: check if module == self

    self
      .invalidations
      .invalidate_on_file_create(FileCreateInvalidation::FileName {
        file_name: format!("node_modules/{}", module),
        above: self.from.to_owned(),
      });

    for dir in self.from.ancestors() {
      // Skip over node_modules directories
      if let Some(filename) = dir.file_name() {
        if filename == "node_modules" {
          continue;
        }
      }

      let mut package_dir = dir.join("node_modules").join(module);
      if self.resolver.cache.fs.is_dir(&package_dir) {
        let package_path = package_dir.join("package.json");
        let package = self.invalidations.read(&package_path, || {
          self
            .resolver
            .cache
            .read_package(Cow::Borrowed(&package_path))
        })?;

        // If the exports field is present, use the Node ESM algorithm.
        // Otherwise, fall back to classic CJS resolution.
        if self.resolver.flags.contains(Flags::EXPORTS) && package.has_exports() {
          let path = package.resolve_package_exports(subpath, &[])?;

          // Extensionless specifiers are not supported in the exports field.
          if let Some(res) = self.try_file_without_aliases(&path)? {
            return Ok(res);
          }

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
    }

    // NODE_PATH??

    Err(ResolverError::ModuleNotFound {
      module: module.to_owned(),
    })
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
          self.try_extensions(&without_extension, package, &["ts", "tsx"])?
        } else if ext == "mjs" {
          self.try_extensions(&without_extension, package, &["mts"])?
        } else if ext == "cjs" {
          self.try_extensions(&without_extension, package, &["cts"])?
        } else {
          None
        };

        if res.is_some() {
          return Ok(res);
        }
      }
    }

    self.try_extensions(path, package, &self.resolver.extensions)
  }

  fn try_extensions(
    &self,
    path: &Path,
    package: Option<&PackageJson>,
    extensions: &[&str],
  ) -> Result<Option<Resolution>, ResolverError> {
    if self.resolver.flags.contains(Flags::OPTIONAL_EXTENSIONS)
      && self.specifier_type != SpecifierType::Url
    {
      // Try appending each extension.
      for ext in extensions {
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
        let s = path.strip_prefix(package.path.parent().unwrap()).unwrap();
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

    self.try_file_without_aliases(path)
  }

  fn try_file_without_aliases(&self, path: &Path) -> Result<Option<Resolution>, ResolverError> {
    if self.resolver.cache.fs.is_file(path) {
      Ok(Some(Resolution::Path(
        self.resolver.cache.fs.canonicalize(path)?,
      )))
    } else {
      self
        .invalidations
        .invalidate_on_file_create(FileCreateInvalidation::Path(path.to_owned()));
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
                root_package: self.resolver.root_package.clone(),
                include_node_modules: Cow::Borrowed(self.resolver.include_node_modules.as_ref()),
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

// #[derive(Debug)]
// enum EsmGraphBuilderError {
//   IOError(std::io::Error),
//   ParseError,
//   ResolverError(ResolverError),
//   Dynamic
// }

// impl From<std::io::Error> for EsmGraphBuilderError {
//   fn from(e: std::io::Error) -> Self {
//     EsmGraphBuilderError::IOError(e)
//   }
// }

// impl From<usize> for EsmGraphBuilderError {
//   fn from(e: usize) -> Self {
//     EsmGraphBuilderError::ParseError
//   }
// }

// impl From<ResolverError> for EsmGraphBuilderError {
//   fn from(e: ResolverError) -> Self {
//     EsmGraphBuilderError::ResolverError(e)
//   }
// }

// struct EsmGraphBuilder {
//   visited: HashSet<PathBuf>,
//   resolver: Resolver
// }

// impl EsmGraphBuilder {
//   pub fn build(&self, file: &Path) -> Result<(), EsmGraphBuilderError> {
//     if self.visited.contains(file) {
//       return Ok(());
//     }

//     self.visited.insert(file.to_owned());

//     let contents = std::fs::read_to_string(&file)?;
//     let module = lex(&contents)?;
//     for import in module.imports() {
//       println!("IMPORT {} {:?} {:?}", import.specifier(), import.kind(), file);
//       match import.kind() {
//         ImportKind::DynamicExpression => return Err(EsmGraphBuilderError::Dynamic),
//         ImportKind::DynamicString | ImportKind::Standard => {
//           match self.resolver.resolve(import.specifier(), &file, SpecifierType::Esm)? {
//             Resolution::Path(p) => {
//               self.build(&p)?;
//             }
//             _ => {}
//           }
//         }
//         ImportKind::Meta => {}
//       }
//     }

//     Ok(())
//   }
// }

// fn build_esm_graph(file: &Path, project_root: PathBuf) -> Result<HashSet<PathBuf>, EsmGraphBuilderError> {
//   let mut visitor = EsmGraphBuilder {
//     visited: HashSet::new(),
//     resolver: Resolver {
//       project_root,
//       mode: ResolverMode::Node
//     }
//   };

//   visitor.build(file)?;
//   Ok(visitor.visited)
// }

#[cfg(test)]
mod tests {
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
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("./bar", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("~/bar", &root().join("nested/test.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("~bar", &root().join("nested/test.js"), SpecifierType::Esm)
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
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("./nested", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("./bar?foo=2", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("./bar?foo=2", &root().join("foo.js"), SpecifierType::Cjs)
        .unwrap_err()
        .0,
      ResolverError::FileNotFound {
        relative: "bar?foo=2".into(),
        from: root().join("foo.js")
      },
    );

    let invalidations = test_resolver()
      .resolve("./bar", &root().join("foo.js"), SpecifierType::Esm)
      .unwrap()
      .1;
    assert_eq!(
      *invalidations.invalidate_on_file_create.read().unwrap(),
      HashSet::from([
        FileCreateInvalidation::Path(root().join("bar")),
        FileCreateInvalidation::Path(root().join("bar.ts")),
        FileCreateInvalidation::Path(root().join("bar.tsx")),
        FileCreateInvalidation::Path(root().join("bar.mjs")),
        FileCreateInvalidation::FileName {
          file_name: "package.json".into(),
          above: root().join("foo.js")
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
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("package-main", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-main/main.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("package-module", &root().join("foo.js"), SpecifierType::Esm)
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
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-main-directory/nested/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("foo/nested/baz", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/nested/baz.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
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
        .unwrap_err()
        .0,
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
        .unwrap_err()
        .0,
      ResolverError::ModuleNotFound {
        module: "@scope/pkg?foo=2".into()
      },
    );

    let invalidations = test_resolver()
      .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
      .unwrap()
      .1;
    assert_eq!(
      *invalidations.invalidate_on_file_create.read().unwrap(),
      HashSet::from([
        FileCreateInvalidation::FileName {
          file_name: "node_modules/foo".into(),
          above: root().join("foo.js")
        },
        FileCreateInvalidation::Path(root().join("node_modules/foo/index")),
        FileCreateInvalidation::Path(root().join("node_modules/foo/index.ts")),
        FileCreateInvalidation::Path(root().join("node_modules/foo/index.tsx")),
        FileCreateInvalidation::Path(root().join("node_modules/foo/index.mjs")),
        FileCreateInvalidation::FileName {
          file_name: "tsconfig.json".into(),
          above: root().join("foo.js")
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
        .unwrap()
        .0,
      Resolution::Excluded
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./lib/test",
          &root().join("node_modules/package-alias-glob/index.js"),
          SpecifierType::Esm
        )
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
      .unwrap()
      .1;
    assert_eq!(
      *invalidations.invalidate_on_file_create.read().unwrap(),
      HashSet::from([
        FileCreateInvalidation::FileName {
          file_name: "node_modules/package-alias".into(),
          above: root().join("foo.js")
        },
        FileCreateInvalidation::Path(root().join("node_modules/package-alias/bar")),
        FileCreateInvalidation::Path(root().join("node_modules/package-alias/bar.ts")),
        FileCreateInvalidation::Path(root().join("node_modules/package-alias/bar.tsx")),
        FileCreateInvalidation::Path(root().join("node_modules/package-alias/bar.mjs")),
        FileCreateInvalidation::FileName {
          file_name: "tsconfig.json".into(),
          above: root().join("foo.js")
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
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("aliased-file", &root().join("foo.js"), SpecifierType::Esm)
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
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("aliasedfolder", &root().join("foo.js"), SpecifierType::Esm)
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
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("foo/bar", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("glob/bar/test", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("something", &root().join("foo.js"), SpecifierType::Esm)
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
        .unwrap()
        .0,
      Resolution::Excluded
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
        .unwrap()
        .0,
      Resolution::Excluded
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "//example.com/foo.png",
          &root().join("foo.js"),
          SpecifierType::Url
        )
        .unwrap()
        .0,
      Resolution::Excluded
    );
    assert_eq!(
      test_resolver()
        .resolve("#hash", &root().join("foo.js"), SpecifierType::Url)
        .unwrap()
        .0,
      Resolution::Excluded
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "http://example.com/foo.png",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap_err()
        .0,
      ResolverError::UnknownScheme {
        scheme: "http".into()
      },
    );
    assert_eq!(
      test_resolver()
        .resolve("bar.js", &root().join("foo.js"), SpecifierType::Url)
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("bar", &root().join("foo.js"), SpecifierType::Url)
        .unwrap_err()
        .0,
      ResolverError::FileNotFound {
        relative: "bar".into(),
        from: root().join("foo.js")
      }
    );
    assert_eq!(
      test_resolver()
        .resolve("npm:foo", &root().join("foo.js"), SpecifierType::Url)
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("npm:@scope/pkg", &root().join("foo.js"), SpecifierType::Url)
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
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/package-exports/with space.mjs"))
    );
    // assert_eq!(
    //   test_resolver().resolve("package-exports/with%20space", &root().join("foo.js"), SpecifierType::Esm).unwrap().0,
    //   Resolution::Path(root().join("node_modules/package-exports/with space.mjs"))
    // );
    assert!(matches!(
      test_resolver().resolve(
        "package-exports/with space",
        &root().join("foo.js"),
        SpecifierType::Esm
      ),
      Err((
        ResolverError::PackageJsonError(PackageJsonError::PackagePathNotExported),
        _
      ))
    ));
    assert!(matches!(
      test_resolver().resolve(
        "package-exports/internal",
        &root().join("foo.js"),
        SpecifierType::Esm
      ),
      Err((
        ResolverError::PackageJsonError(PackageJsonError::PackagePathNotExported),
        _
      ))
    ));
    assert!(matches!(
      test_resolver().resolve(
        "package-exports/internal.mjs",
        &root().join("foo.js"),
        SpecifierType::Esm
      ),
      Err((
        ResolverError::PackageJsonError(PackageJsonError::PackagePathNotExported),
        _
      ))
    ));
    assert!(matches!(
      test_resolver().resolve(
        "package-exports/invalid",
        &root().join("foo.js"),
        SpecifierType::Esm
      ),
      Err((
        ResolverError::PackageJsonError(PackageJsonError::InvalidPackageTarget),
        _
      ))
    ));
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
        .unwrap()
        .0,
      Resolution::Builtin("zlib".into())
    );
    assert_eq!(
      test_resolver()
        .resolve("node:zlib", &root().join("foo.js"), SpecifierType::Esm)
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
        .unwrap_err()
        .0,
      ResolverError::ModuleNotFound {
        module: "ts-path".into()
      },
    );
    assert_eq!(
      test_resolver()
        .resolve("ts-path", &root().join("foo.css"), SpecifierType::Esm)
        .unwrap_err()
        .0,
      ResolverError::ModuleNotFound {
        module: "ts-path".into()
      },
    );

    let invalidations = test_resolver()
      .resolve("ts-path", &root().join("foo.js"), SpecifierType::Esm)
      .unwrap()
      .1;
    assert_eq!(
      *invalidations.invalidate_on_file_create.read().unwrap(),
      HashSet::from([FileCreateInvalidation::FileName {
        file_name: "tsconfig.json".into(),
        above: root().join("foo.js")
      }])
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
        .unwrap_err()
        .0,
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
      .unwrap()
      .1;
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
          above: root().join("ts-extensions/index.ts")
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
        .unwrap()
        .0,
      Resolution::Excluded
    );
    assert_eq!(
      resolver
        .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Excluded
    );

    resolver.include_node_modules = Cow::Owned(IncludeNodeModules::Array(vec!["foo".into()]));
    assert_eq!(
      resolver
        .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      resolver
        .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Excluded
    );

    resolver.include_node_modules = Cow::Owned(IncludeNodeModules::Map(HashMap::from([
      ("foo".into(), false),
      ("@scope/pkg".into(), true),
    ])));
    assert_eq!(
      resolver
        .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap()
        .0,
      Resolution::Excluded
    );
    assert_eq!(
      resolver
        .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
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
