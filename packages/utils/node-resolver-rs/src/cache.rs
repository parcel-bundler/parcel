use std::{
  borrow::Cow,
  ops::Deref,
  path::{Path, PathBuf},
};

use elsa::FrozenMap;
use typed_arena::Arena;

use crate::{
  fs::{FileSystem, OsFileSystem},
  package_json::{PackageJson, SourceField},
  tsconfig::{TsConfig, TsConfigWrapper},
  ResolverError,
};

#[derive(Default)]
pub struct Cache<Fs = OsFileSystem> {
  pub fs: Fs,
  // This stores file content strings, which are borrowed when parsing package.json and tsconfig.json files.
  arena: Arena<Box<str>>,
  // These map paths to parsed config files. They aren't really 'static, but Rust doens't have a good
  // way to associate a lifetime with owned data stored in the same struct. We only vend temporary references
  // from our public methods so this is ok for now. FrozenMap is an append only map, which doesn't require &mut
  // to insert into. Since each value is in a Box, it won't move and therefore references are stable.
  packages: FrozenMap<PathBuf, Box<Result<PackageJson<'static>, ResolverError>>>,
  tsconfigs: FrozenMap<PathBuf, Box<Result<TsConfigWrapper<'static>, ResolverError>>>,
}

// Special Cow implementation for a Cache that doesn't require Clone.
pub enum CacheCow<'a, Fs> {
  Borrowed(&'a Cache<Fs>),
  Owned(Cache<Fs>),
}

impl<'a, Fs> Deref for CacheCow<'a, Fs> {
  type Target = Cache<Fs>;

  fn deref(&self) -> &Self::Target {
    match self {
      CacheCow::Borrowed(c) => *c,
      CacheCow::Owned(c) => c,
    }
  }
}

impl<Fs: FileSystem> Cache<Fs> {
  pub fn new(fs: Fs) -> Self {
    Self {
      fs,
      arena: Arena::new(),
      packages: FrozenMap::new(),
      tsconfigs: FrozenMap::new(),
    }
  }

  pub fn read_package<'a>(&'a self, path: Cow<Path>) -> Result<&'a PackageJson<'a>, ResolverError> {
    if let Some(pkg) = self.packages.get(path.as_ref()) {
      return clone_result(pkg);
    }

    fn read_package<Fs: FileSystem>(
      fs: &Fs,
      arena: &Arena<Box<str>>,
      path: PathBuf,
    ) -> Result<PackageJson<'static>, ResolverError> {
      let data = read(fs, arena, &path)?;
      let mut pkg = PackageJson::parse(path, data)?;

      Ok(pkg)
    }

    let path = path.into_owned();
    let pkg = self.packages.insert(
      path.clone(),
      Box::new(read_package(&self.fs, &self.arena, path)),
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
      arena: &Arena<Box<str>>,
      path: &Path,
      process: F,
    ) -> Result<TsConfigWrapper<'static>, ResolverError> {
      let data = read(fs, arena, &path)?;
      let mut tsconfig = TsConfig::parse(path.to_owned(), data)?;
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
  arena: &Arena<Box<str>>,
  path: &Path,
) -> std::io::Result<&'static mut str> {
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
