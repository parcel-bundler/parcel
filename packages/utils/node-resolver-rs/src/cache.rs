use std::{
  borrow::Cow,
  ops::Deref,
  path::{Path, PathBuf},
  sync::Mutex,
};

use crate::{
  fs::FileSystem,
  package_json::{PackageJson, SourceField},
  tsconfig::{TsConfig, TsConfigWrapper},
  ResolverError,
};
use dashmap::DashMap;
use gxhash::GxBuildHasher;
use typed_arena::Arena;

pub struct Cache<Fs> {
  pub fs: Fs,
  /// This stores file content strings, which are borrowed when parsing package.json and tsconfig.json files.
  arena: Mutex<Arena<Box<str>>>,
  /// These map paths to parsed config files. They aren't really 'static, but Rust doens't have a good
  /// way to associate a lifetime with owned data stored in the same struct. We only vend temporary references
  /// from our public methods so this is ok for now. FrozenDashMap is an append only map, which doesn't require &mut
  /// to insert into. Since each value is in a Box, it won't move and therefore references are stable.
  packages: FrozenDashMap<PathBuf, Box<Result<PackageJson<'static>, ResolverError>>>,
  tsconfigs: FrozenDashMap<PathBuf, Box<Result<TsConfigWrapper<'static>, ResolverError>>>,
  is_file_cache: DashMap<PathBuf, bool, GxBuildHasher>,
  is_dir_cache: DashMap<PathBuf, bool, GxBuildHasher>,
  realpath_cache: DashMap<PathBuf, Option<PathBuf>, GxBuildHasher>,
}

// This is based on FrozenMap in the elsa crate, but modified to use DashMap instead of RwLock<HashMap>
struct FrozenDashMap<K, V> {
  map: DashMap<K, V, GxBuildHasher>,
}

impl<K: Eq + std::hash::Hash, V: stable_deref_trait::StableDeref> FrozenDashMap<K, V> {
  pub fn new() -> Self {
    Self {
      map: DashMap::default(),
    }
  }

  pub fn insert(&self, k: K, v: V) -> &V::Target {
    unsafe {
      let inserted = &**self.map.entry(k).or_insert(v);
      &*(inserted as *const _)
    }
  }

  pub fn get<Q: ?Sized>(&self, k: &Q) -> Option<&V::Target>
  where
    K: std::borrow::Borrow<Q>,
    Q: std::hash::Hash + Eq,
  {
    let ret = unsafe { self.map.get(k).map(|x| &*(&**x as *const V::Target)) };
    ret
  }
}

#[allow(clippy::large_enum_variant)]
/// Special Cow implementation for a Cache that doesn't require Clone.
pub enum CacheCow<'a, Fs> {
  Borrowed(&'a Cache<Fs>),
  Owned(Cache<Fs>),
}

impl<'a, Fs> Deref for CacheCow<'a, Fs> {
  type Target = Cache<Fs>;

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

impl<Fs: FileSystem> Cache<Fs> {
  pub fn new(fs: Fs) -> Self {
    Self {
      fs,
      arena: Mutex::new(Arena::new()),
      packages: FrozenDashMap::new(),
      tsconfigs: FrozenDashMap::new(),
      is_file_cache: DashMap::default(),
      is_dir_cache: DashMap::default(),
      realpath_cache: DashMap::default(),
    }
  }

  pub fn is_file(&self, path: &Path) -> bool {
    if let Some(is_file) = self.is_file_cache.get(path) {
      return *is_file;
    }

    let is_file = self.fs.is_file(path);
    self.is_file_cache.insert(path.to_path_buf(), is_file);
    is_file
  }

  pub fn is_dir(&self, path: &Path) -> bool {
    if let Some(is_file) = self.is_dir_cache.get(path) {
      return *is_file;
    }

    let is_file = self.fs.is_dir(path);
    self.is_dir_cache.insert(path.to_path_buf(), is_file);
    is_file
  }

  pub fn canonicalize(&self, path: &Path) -> Result<PathBuf, ResolverError> {
    Ok(self.fs.canonicalize(path, &self.realpath_cache)?)
  }

  pub fn read_package<'a>(&'a self, path: Cow<Path>) -> Result<&'a PackageJson<'a>, ResolverError> {
    if let Some(pkg) = self.packages.get(path.as_ref()) {
      return clone_result(pkg);
    }

    fn read_package<Fs: FileSystem>(
      fs: &Fs,
      realpath_cache: &DashMap<PathBuf, Option<PathBuf>, GxBuildHasher>,
      arena: &Mutex<Arena<Box<str>>>,
      path: PathBuf,
    ) -> Result<PackageJson<'static>, ResolverError> {
      let data = read(fs, arena, &path)?;
      let mut pkg = PackageJson::parse(path.clone(), data).map_err(|e| JsonError::new(path, e))?;

      // If the package has a `source` field, make sure
      // - the package is behind symlinks
      // - and the realpath to the packages does not includes `node_modules`.
      // Since such package is likely a pre-compiled module
      // installed with package managers, rather than including a source code.
      if !matches!(pkg.source, SourceField::None) {
        let realpath = fs.canonicalize(&pkg.path, realpath_cache)?;
        if realpath == pkg.path
          || realpath
            .components()
            .any(|c| c.as_os_str() == "node_modules")
        {
          pkg.source = SourceField::None;
        }
      }

      Ok(pkg)
    }

    let path = path.into_owned();
    let pkg = self.packages.insert(
      path.clone(),
      Box::new(read_package(
        &self.fs,
        &self.realpath_cache,
        &self.arena,
        path,
      )),
    );

    clone_result(pkg)
  }

  pub fn read_tsconfig<'a, F: FnOnce(&mut TsConfigWrapper<'a>) -> Result<(), ResolverError>>(
    &'a self,
    path: &Path,
    process: F,
  ) -> Result<&'a TsConfigWrapper<'a>, ResolverError> {
    if let Some(tsconfig) = self.tsconfigs.get(path) {
      return clone_result(tsconfig);
    }

    fn read_tsconfig<
      'a,
      Fs: FileSystem,
      F: FnOnce(&mut TsConfigWrapper<'a>) -> Result<(), ResolverError>,
    >(
      fs: &Fs,
      arena: &Mutex<Arena<Box<str>>>,
      path: &Path,
      process: F,
    ) -> Result<TsConfigWrapper<'static>, ResolverError> {
      let data = read(fs, arena, path)?;
      let mut tsconfig =
        TsConfig::parse(path.to_owned(), data).map_err(|e| JsonError::new(path.to_owned(), e))?;
      // Convice the borrow checker that 'a will live as long as self and not 'static.
      // Since the data is in our arena, this is true.
      process(unsafe { std::mem::transmute(&mut tsconfig) })?;
      Ok(tsconfig)
    }

    let tsconfig = self.tsconfigs.insert(
      path.to_owned(),
      Box::new(read_tsconfig(&self.fs, &self.arena, path, process)),
    );

    clone_result(tsconfig)
  }
}

fn read<F: FileSystem>(
  fs: &F,
  arena: &Mutex<Arena<Box<str>>>,
  path: &Path,
) -> std::io::Result<&'static mut str> {
  let arena = arena.lock().unwrap();
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
