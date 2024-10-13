use std::{
  borrow::Cow,
  ffi::OsString,
  fmt,
  ops::Deref,
  path::{Path, PathBuf},
  sync::Arc,
};

use dashmap::DashMap;
use elsa::sync::FrozenMap;
use parking_lot::Mutex;
use typed_arena::Arena;

use crate::{
  fs::{FileSystem, FileSystemRealPathCache},
  package_json::{PackageJson, SourceField},
  path::{InternedPath, PathInterner},
  tsconfig::{TsConfig, TsConfigWrapper},
  ResolverError,
};

pub struct Cache {
  pub fs: Arc<dyn FileSystem>,
  /// This stores file content strings, which are borrowed when parsing package.json and tsconfig.json files.
  arena: Mutex<Arena<Box<str>>>,
  /// These map paths to parsed config files. They aren't really 'static, but Rust doens't have a good
  /// way to associate a lifetime with owned data stored in the same struct. We only vend temporary references
  /// from our public methods so this is ok for now. FrozenMap is an append only map, which doesn't require &mut
  /// to insert into. Since each value is in a Box, it won't move and therefore references are stable.
  packages: FrozenMap<InternedPath, Box<Result<PackageJson<'static>, ResolverError>>>,
  tsconfigs: FrozenMap<InternedPath, Box<Result<TsConfigWrapper<'static>, ResolverError>>>,
  // is_file_cache: DashMap<OsString, bool, xxhash_rust::xxh3::Xxh3Builder>,
  // is_dir_cache: DashMap<OsString, bool, xxhash_rust::xxh3::Xxh3Builder>,
  // realpath_cache: FileSystemRealPathCache,
  pub paths: PathInterner,
}

impl fmt::Debug for Cache {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.debug_struct("Cache").finish()
  }
}

#[allow(clippy::large_enum_variant)]
/// Special Cow implementation for a Cache that doesn't require Clone.
pub enum CacheCow<'a> {
  Borrowed(&'a Cache),
  Owned(Cache),
}

impl<'a> Deref for CacheCow<'a> {
  type Target = Cache;

  fn deref(&self) -> &Self::Target {
    match self {
      CacheCow::Borrowed(c) => c,
      CacheCow::Owned(c) => c,
    }
  }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct JsonError {
  pub path: PathBuf,
  pub line: usize,
  pub column: usize,
  pub message: String,
}

impl JsonError {
  fn new(path: PathBuf, err: serde_json::Error) -> JsonError {
    JsonError {
      path,
      line: err.line(),
      column: err.column(),
      message: err.to_string(),
    }
  }
}

impl Cache {
  pub fn new(fs: Arc<dyn FileSystem>) -> Self {
    Self {
      fs,
      arena: Mutex::new(Arena::new()),
      packages: FrozenMap::new(),
      tsconfigs: FrozenMap::new(),
      // is_file_cache: DashMap::default(),
      // is_dir_cache: DashMap::default(),
      // realpath_cache: DashMap::default(),
      paths: PathInterner::new(),
    }
  }

  pub fn path(&self, path: &Path) -> InternedPath {
    self.paths.get(path)
  }

  // pub fn is_file(&self, path: &Path) -> bool {
  //   if let Some(is_file) = self.is_file_cache.get(path.as_os_str()) {
  //     return *is_file;
  //   }

  //   let is_file = self.fs.is_file(path);
  //   self
  //     .is_file_cache
  //     .insert(path.as_os_str().to_os_string(), is_file);
  //   is_file
  // }

  // pub fn is_dir(&self, path: &Path) -> bool {
  //   if let Some(is_file) = self.is_dir_cache.get(path.as_os_str()) {
  //     return *is_file;
  //   }

  //   let is_file = self.fs.is_dir(path);
  //   self
  //     .is_dir_cache
  //     .insert(path.as_os_str().to_os_string(), is_file);
  //   is_file
  // }

  // pub fn canonicalize(&self, path: &Path) -> Result<PathBuf, ResolverError> {
  //   Ok(self.fs.canonicalize(path, &self.realpath_cache)?)
  // }

  pub fn read_package<'a>(
    &'a self,
    path: &InternedPath,
  ) -> Result<&'a PackageJson<'a>, ResolverError> {
    if let Some(pkg) = self.packages.get(path) {
      return clone_result(pkg);
    }

    fn read_package<'fs>(
      fs: &'fs dyn FileSystem,
      arena: &Mutex<Arena<Box<str>>>,
      path: &InternedPath,
      interner: &PathInterner,
    ) -> Result<PackageJson<'static>, ResolverError> {
      let contents: &str = read(fs, arena, path.as_path())?;
      let mut pkg = PackageJson::parse(path.clone(), contents, interner)
        .map_err(|e| JsonError::new(path.as_path().into(), e))?;

      // If the package has a `source` field, make sure
      // - the package is behind symlinks
      // - and the realpath to the packages does not includes `node_modules`.
      // Since such package is likely a pre-compiled module
      // installed with package managers, rather than including a source code.
      if !matches!(pkg.source, SourceField::None) {
        let realpath = pkg.path.canonicalize(fs);
        if realpath == pkg.path.as_path()
          || realpath
            .components()
            .any(|c| c.as_os_str() == "node_modules")
        {
          pkg.source = SourceField::None;
        }
      }

      Ok(pkg)
    }

    let pkg = self.packages.insert(
      path.clone(),
      Box::new(read_package(&*self.fs, &self.arena, path, &self.paths)),
    );

    clone_result(pkg)
  }

  pub fn read_tsconfig<'a, F: FnOnce(&mut TsConfigWrapper<'a>) -> Result<(), ResolverError>>(
    &'a self,
    path: &InternedPath,
    process: F,
  ) -> Result<&'a TsConfigWrapper<'a>, ResolverError> {
    if let Some(tsconfig) = self.tsconfigs.get(path) {
      return clone_result(tsconfig);
    }

    fn read_tsconfig<'fs, 'a, F: FnOnce(&mut TsConfigWrapper<'a>) -> Result<(), ResolverError>>(
      fs: &'fs dyn FileSystem,
      arena: &Mutex<Arena<Box<str>>>,
      path: &InternedPath,
      process: F,
      interner: &PathInterner,
    ) -> Result<TsConfigWrapper<'static>, ResolverError> {
      let data = read(fs, arena, path.as_path())?;
      let mut tsconfig = TsConfig::parse(path.clone(), data, &interner)
        .map_err(|e| JsonError::new(path.as_path().to_owned(), e))?;
      // Convice the borrow checker that 'a will live as long as self and not 'static.
      // Since the data is in our arena, this is true.
      process(unsafe { std::mem::transmute(&mut tsconfig) })?;
      Ok(tsconfig)
    }

    let tsconfig = self.tsconfigs.insert(
      path.clone(),
      Box::new(read_tsconfig(
        &*self.fs,
        &self.arena,
        path,
        process,
        &self.paths,
      )),
    );

    clone_result(tsconfig)
  }
}

fn read<'fs>(
  fs: &'fs dyn FileSystem,
  arena: &Mutex<Arena<Box<str>>>,
  path: &Path,
) -> std::io::Result<&'static mut str> {
  let arena = arena.lock();
  let data = arena.alloc(fs.read_to_string(path)?.into_boxed_str());
  // The data lives as long as the arena. In public methods, we only vend temporary references.
  Ok(unsafe { &mut *(&mut **data as *mut str) })
}

fn clone_result<T, E: Clone>(res: &Result<T, E>) -> Result<&T, E> {
  match res {
    Ok(v) => Ok(v),
    Err(err) => Err(err.clone()),
  }
}
