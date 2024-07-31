//! This file contains a few benchmarks which demonstrate the following insights on the resolver
//! performance profile:
//!
//! 1. Resolution completes in micro-seconds
//! 2. Resolution is IO bound; if we remove all IO resolution is around 3-4x faster, therefore we
//!    can estimate most of the time is spent doing IO and not anything else
//! 3. stat is faster than read_to_string if files don't exist by around 2x on macOS and 3x on Linux
//!    therefore, we should only read files after we've checked they exist, it is worth it to check
//!    if the file is present before reading if we will miss files a large proportion of the time
//! 4. The next bottleneck is JSON parsing. To that we are using serde_json5, the master branch is
//!    20-30% faster than the latest version on `crates.io` (which is 0.1 as of time of writing).
//!    We can have much faster JSON parsing if we look into consuming SIMD-JSON.
//!
use std::collections::HashMap;
use std::hint::black_box;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use criterion::{criterion_group, criterion_main, Criterion};
use parking_lot::RwLock;

use parcel_filesystem::os_file_system::OsFileSystem;
use parcel_filesystem::FileSystem;
use parcel_resolver::{Cache, CacheCow, Resolver, SpecifierType};

#[derive(Clone)]
enum FileEntry {
  Directory,
  File(String),
}

struct PreloadingFileSystem {
  files: RwLock<HashMap<PathBuf, FileEntry>>,
}

impl Clone for PreloadingFileSystem {
  fn clone(&self) -> Self {
    let files = self.files.read();
    Self {
      files: RwLock::new(files.clone()),
    }
  }
}

impl PreloadingFileSystem {
  fn load(root: &Path) -> Self {
    let mut files = HashMap::new();
    fn load_directory(files: &mut HashMap<PathBuf, FileEntry>, dir: &Path) {
      files.insert(dir.to_path_buf(), FileEntry::Directory);
      let entries = std::fs::read_dir(dir).unwrap();
      for entry in entries {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_file() {
          let string = std::fs::read_to_string(&path).unwrap();
          files.insert(path, FileEntry::File(string));
        } else {
          load_directory(files, &path)
        }
      }
    };
    load_directory(&mut files, root);

    let files = RwLock::new(files);
    Self { files }
  }
}

impl FileSystem for PreloadingFileSystem {
  fn cwd(&self) -> std::io::Result<PathBuf> {
    todo!()
  }

  fn canonicalize_base(&self, path: &Path) -> std::io::Result<PathBuf> {
    let cwd = Path::new("/");
    let mut result = if path.is_absolute() {
      vec![]
    } else {
      cwd.components().collect()
    };

    let components = path.components();
    for component in components {
      match component {
        Component::Prefix(prefix) => {
          result = vec![Component::Prefix(prefix)];
        }
        Component::RootDir => {
          result.push(Component::RootDir);
        }
        Component::CurDir => {}
        Component::ParentDir => {
          result.pop();
        }
        Component::Normal(path) => {
          result.push(Component::Normal(path));
        }
      }
    }

    Ok(PathBuf::from_iter(result))
  }

  fn create_directory(&self, path: &Path) -> std::io::Result<()> {
    self
      .files
      .write()
      .insert(path.to_path_buf(), FileEntry::Directory);
    Ok(())
  }

  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    let files = self.files.read();
    let file = files.get(path);
    if let Some(FileEntry::File(contents)) = file {
      Ok(contents.to_string())
    } else {
      return Err(todo!());
    }
  }

  fn is_file(&self, path: &Path) -> bool {
    let files = self.files.read();
    let file = files.get(path);
    matches!(file, Some(FileEntry::File(_)))
  }

  fn is_dir(&self, path: &Path) -> bool {
    let files = self.files.read();
    let file = files.get(path);
    matches!(file, Some(FileEntry::Directory))
  }
}

fn root() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .unwrap()
    .join("node-resolver-core/test/fixture")
}

fn criterion_benchmark(c: &mut Criterion) {
  let make_resolver = || {
    Resolver::parcel(
      root().into(),
      CacheCow::Owned(Cache::new(Arc::new(OsFileSystem))),
    )
  };
  c.bench_function("is file using stat", |b| {
    let target = root().join("do-not-exist");
    b.iter(|| black_box(target.exists()));
  });

  c.bench_function("is file using open", |b| {
    let target = root().join("do-not-exist");
    b.iter(|| black_box(std::fs::read_to_string(&target).is_err()));
  });

  c.bench_function("resolver simple", |b| {
    b.iter_with_setup(
      || make_resolver(),
      |resolver| {
        let result = resolver
          .resolve("./bar.js", &root().join("foo.js"), SpecifierType::Esm)
          .result
          .unwrap();
        black_box(result)
      },
    );
  });

  c.bench_function("resolver modules", |b| {
    b.iter_with_setup(
      || make_resolver(),
      |resolver| {
        let result = resolver
          .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Cjs)
          .result
          .unwrap();
        black_box(result)
      },
    );
  });

  let preloading_fs = PreloadingFileSystem::load(&root());
  let make_resolver = || {
    Resolver::parcel(
      root().into(),
      CacheCow::Owned(Cache::new(Arc::new(preloading_fs.clone()))),
    )
  };

  c.bench_function("resolver preloading", |b| {
    b.iter_with_setup(
      || make_resolver(),
      |resolver| {
        let result = resolver
          .resolve("./bar.js", &root().join("foo.js"), SpecifierType::Esm)
          .result
          .unwrap();
        black_box(result)
      },
    );
  });

  c.bench_function("resolver preloading", |b| {
    b.iter_with_setup(
      || make_resolver(),
      |resolver| {
        let result = resolver
          .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Cjs)
          .result
          .unwrap();
        black_box(result)
      },
    );
  });
}

criterion_group!(benches, criterion_benchmark);
criterion_main!(benches);
