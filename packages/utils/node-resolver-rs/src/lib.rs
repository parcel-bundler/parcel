// trait FileSystem {
//   read()
// }

use std::{
  borrow::Cow,
  collections::HashSet,
  ffi::OsString,
  fs,
  path::{Path, PathBuf},
};
// use bitflags::bitflags;
// use es_module_lexer::{lex, ImportKind};
use specifier::parse_package_specifier;

use package_json::{AliasValue, ExportsResolution, Fields, PackageJson, PackageJsonError};
use specifier::Specifier;

mod builtins;
mod package_json;
mod specifier;
mod tsconfig;

const EXTENSIONS: &'static [&'static str] = &["js", "json"];
const BUILTINS: &'static [&'static str] = &[
  "path", "fs",
  // "url"
];

// bitflags! {
//   pub struct Flags: u8 {
//     const ABSOLUTE = 1 << 0;
//     const TILDE = 1 << 1;
//     const NPM_SCHEME = 1 << 2;
//     const ESM_INTEROP = 1 << 3;
//     const MODULE_FIELD = 1 << 4;
//     const BROWSER_FIELD = 1 << 5;
//     const NODE_BUILTINS = 1 << 6;

//     // const PARCEL = ABSOLUTE | TILDE
//   }
// }

#[derive(PartialEq, Eq, Clone, Copy)]
pub enum ResolverMode {
  Parcel,
  Node,
}

pub struct Resolver {
  project_root: PathBuf,
  mode: ResolverMode,
}

#[derive(PartialEq, Eq, Hash)]
enum FileCreateInvalidation {
  Path(PathBuf),
}

struct Invalidations {
  invalidate_on_file_create: HashSet<FileCreateInvalidation>,
  invalidate_on_file_delete: HashSet<PathBuf>,
}

#[derive(PartialEq, Eq, Clone, Copy)]
pub enum SpecifierType {
  Esm,
  Cjs,
  Url,
}

#[derive(Debug)]
pub enum ResolverError {
  EmptySpecifier,
  UnknownScheme,
  UnknownError,
  FileNotFound,
  JsonError(serde_json::Error),
  IOError(std::io::Error),
  PackageJsonError(PackageJsonError),
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

impl From<serde_json::Error> for ResolverError {
  fn from(e: serde_json::Error) -> Self {
    ResolverError::JsonError(e)
  }
}

impl From<std::io::Error> for ResolverError {
  fn from(e: std::io::Error) -> Self {
    ResolverError::IOError(e)
  }
}

impl From<PackageJsonError> for ResolverError {
  fn from(e: PackageJsonError) -> Self {
    ResolverError::PackageJsonError(e)
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

impl Resolver {
  pub fn resolve(
    &self,
    specifier: &str,
    from: &Path,
    specifier_type: SpecifierType,
  ) -> Result<Resolution, ResolverError> {
    if specifier.is_empty() {
      return Err(ResolverError::EmptySpecifier);
    }

    let specifier = Specifier::parse(specifier, specifier_type, self.mode)?;

    // First, check the project root package.json for any aliases.
    self.find_package(&self.project_root, |package| {
      if let Some(package) = package {
        self
          .resolve_aliases(&package, &specifier, Fields::ALIAS)
          .or_else(|_| self.resolve_specifier(&specifier, from, specifier_type))
      } else {
        self.resolve_specifier(&specifier, from, specifier_type)
      }
    })
  }

  fn find_package<T, F: FnOnce(Option<&PackageJson>) -> Result<T, ResolverError>>(
    &self,
    path: &Path,
    cb: F,
  ) -> Result<T, ResolverError> {
    for dir in path.ancestors() {
      if let Some(filename) = dir.file_name() {
        if filename == "node_modules" {
          break;
        }
      }

      let pkg = dir.join("package.json");
      if let Ok(data) = std::fs::read_to_string(&pkg) {
        let package = PackageJson::parse(&pkg, &data)?;
        return cb(Some(&package));
      }

      if dir == self.project_root {
        break;
      }
    }

    cb(None)
  }

  fn resolve_aliases(
    &self,
    package: &PackageJson,
    specifier: &Specifier,
    fields: Fields,
  ) -> Result<Resolution, ResolverError> {
    match package.resolve_aliases(&specifier, fields) {
      Some(alias) => match alias.as_ref() {
        AliasValue::Specifier(specifier) => {
          self.resolve_specifier(&specifier, &package.path, SpecifierType::Cjs)
        }
        AliasValue::Bool(false) => Ok(Resolution::Excluded),
        AliasValue::Bool(true) => Err(ResolverError::FileNotFound),
        _ => todo!(),
      },
      None => Err(ResolverError::FileNotFound),
    }
  }

  fn resolve_specifier(
    &self,
    specifier: &Specifier,
    from: &Path,
    specifier_type: SpecifierType,
  ) -> Result<Resolution, ResolverError> {
    match specifier {
      Specifier::Relative(specifier) => {
        // Relative path
        self.resolve_relative(&specifier, from, specifier_type)
      }
      Specifier::Tilde(specifier) if self.mode == ResolverMode::Parcel => {
        // Tilde path. Resolve relative to nearest node_modules directory,
        // the nearest directory with package.json or the project root - whichever comes first.
        for ancestor in from.ancestors() {
          if let Some(parent) = ancestor.parent() {
            if parent == self.project_root {
              return self.resolve_relative(&specifier, &ancestor, specifier_type);
            }
          }

          let p = ancestor.join("package.json");
          if p.is_file() {
            return self.resolve_relative(&specifier, &p, specifier_type);
          }
        }

        Err(ResolverError::FileNotFound)
      }
      Specifier::Absolute(specifier) => {
        // In Parcel mode, absolute paths are actually relative to the project root.
        if self.mode == ResolverMode::Parcel {
          self.resolve_relative(
            specifier.strip_prefix("/").unwrap(),
            &self.project_root.join("index"),
            specifier_type,
          )
        } else {
          self.load_path(&specifier, specifier_type, None, Prioritize::File)
        }
      }
      Specifier::Hash(hash) => {
        if self.mode == ResolverMode::Parcel && specifier_type == SpecifierType::Url {
          // An ID-only URL, e.g. `url(#clip-path)` for CSS rules. Ignore.
          Ok(Resolution::Excluded)
        } else if specifier_type == SpecifierType::Esm {
          // An internal package #import specifier.
          self.find_package(from, |package| {
            if let Some(package) = package {
              match package.resolve_package_imports(&hash, &[])? {
                ExportsResolution::Path(path) => {
                  // Extensionless specifiers are not supported in the imports field.
                  if path.is_file() {
                    return Ok(Resolution::Path(fs::canonicalize(path)?));
                  }
                }
                ExportsResolution::Package(specifier) => {
                  let (module, subpath) = parse_package_specifier(&specifier)?;
                  return self.resolve_node_module(module, subpath, from, specifier_type);
                }
                _ => {}
              }
            }

            Err(ResolverError::UnknownError)
          })
        } else {
          Err(ResolverError::UnknownError)
        }
      }
      Specifier::Package(module, subpath) => {
        // Bare specifier.
        self.resolve_node_module(&module, &subpath, from, specifier_type)
      }
      Specifier::Builtin(builtin) => Ok(Resolution::Builtin(builtin.as_ref().to_owned())),
      Specifier::Url(_) => {
        if specifier_type == SpecifierType::Url {
          Ok(Resolution::Excluded)
        } else {
          Err(ResolverError::UnknownScheme)
        }
      }
      _ => Err(ResolverError::UnknownError),
    }
  }

  fn resolve_relative(
    &self,
    specifier: &Path,
    from: &Path,
    specifier_type: SpecifierType,
  ) -> Result<Resolution, ResolverError> {
    // Find a package.json above the source file where the dependency was located.
    // This is used to resolve any aliases.
    self.find_package(from, |package| {
      self.load_path(
        &from.with_file_name(specifier),
        specifier_type,
        package,
        Prioritize::File,
      )
    })
  }

  fn resolve_node_module(
    &self,
    module: &str,
    subpath: &str,
    from: &Path,
    specifier_type: SpecifierType,
  ) -> Result<Resolution, ResolverError> {
    if BUILTINS.contains(&module) {
      return Ok(Resolution::Builtin(module.to_owned()));
    }

    // TODO: tsconfig.json
    // TODO: do pnp here
    // TODO: check if module == self

    for dir in from.ancestors() {
      // Skip over node_modules directories
      if let Some(filename) = dir.file_name() {
        if filename == "node_modules" {
          continue;
        }
      }

      let mut package_dir = dir.join("node_modules").join(module);
      if package_dir.is_dir() {
        let package_path = package_dir.join("package.json");
        let contents = std::fs::read_to_string(&package_path)?;
        let package = PackageJson::parse(&package_path, &contents)?;

        // If the exports field is present, use the Node ESM algorithm.
        // Otherwise, fall back to classic CJS resolution.
        if package.has_exports() {
          let path = package.resolve_package_exports(subpath, &[])?;

          // Extensionless specifiers are not supported in the exports field.
          if path.is_file() {
            return Ok(Resolution::Path(fs::canonicalize(path)?));
          }
        } else if !subpath.is_empty() {
          package_dir.push(subpath);
          return self.load_path(
            &package_dir,
            specifier_type,
            Some(&package),
            Prioritize::File,
          );
        } else {
          return self
            .try_package_entries(&package, specifier_type)
            .or_else(|e| {
              // Node ESM doesn't allow directory imports.
              if self.mode != ResolverMode::Node || specifier_type != SpecifierType::Esm {
                self.try_extensions(&package_dir.join("index"), EXTENSIONS, Some(&package))
              } else {
                Err(e)
              }
            });
        }
      }
    }

    // NODE_PATH??

    Err(ResolverError::FileNotFound)
  }

  fn try_package_entries(
    &self,
    package: &PackageJson,
    specifier_type: SpecifierType,
  ) -> Result<Resolution, ResolverError> {
    let mut fields = Fields::MAIN;
    if self.mode == ResolverMode::Parcel {
      fields.insert(Fields::MODULE | Fields::BROWSER);
    }

    // Try all entry fields.
    for entry in package.entries(fields) {
      let prioritize = if entry.extension().is_some() {
        Prioritize::File
      } else {
        Prioritize::Directory
      };

      if let Ok(res) = self.load_path(&entry, specifier_type, Some(package), prioritize) {
        return Ok(res);
      }
    }

    Err(ResolverError::FileNotFound)
  }

  fn load_path(
    &self,
    path: &Path,
    specifier_type: SpecifierType,
    package: Option<&PackageJson>,
    prioritize: Prioritize,
  ) -> Result<Resolution, ResolverError> {
    // Urls and Node ESM do not resolve directory index files and do not add any extensions.
    match specifier_type {
      SpecifierType::Cjs => {}
      SpecifierType::Esm if self.mode != ResolverMode::Node => {}
      SpecifierType::Url | SpecifierType::Esm => return self.try_extensions(path, &[], package),
    }

    if prioritize == Prioritize::Directory {
      self
        .load_directory(path, specifier_type, package)
        .or_else(|_| self.try_extensions(path, EXTENSIONS, package))
    } else {
      self
        .try_extensions(path, EXTENSIONS, package)
        .or_else(|_| self.load_directory(path, specifier_type, package))
    }
  }

  fn try_extensions(
    &self,
    path: &Path,
    extensions: &[&str],
    package: Option<&PackageJson>,
  ) -> Result<Resolution, ResolverError> {
    // First try the path as is.
    if let Ok(res) = self.try_file(path, package) {
      return Ok(res);
    }

    // Try appending each extension.
    for ext in extensions {
      let mut p: OsString = path.into();
      p.push(".");
      p.push(ext);

      if let Ok(res) = self.try_file(Path::new(&p), package) {
        return Ok(res);
      }

      // TODO: add invalidation
    }

    Err(ResolverError::FileNotFound)
  }

  fn try_file(
    &self,
    path: &Path,
    package: Option<&PackageJson>,
  ) -> Result<Resolution, ResolverError> {
    let path = Cow::Borrowed(path);
    if let Some(package) = package {
      let s = path.strip_prefix(package.path.parent().unwrap()).unwrap();
      let specifier = Specifier::Relative(Cow::Borrowed(s));
      if let Ok(res) = self.resolve_aliases(package, &specifier, Fields::BROWSER | Fields::ALIAS) {
        return Ok(res);
      }
    }

    // println!("{:?}", path);
    if path.is_file() {
      Ok(Resolution::Path(fs::canonicalize(path)?))
    } else {
      Err(ResolverError::FileNotFound)
    }
  }

  fn load_directory(
    &self,
    dir: &Path,
    specifier_type: SpecifierType,
    parent_package: Option<&PackageJson>,
  ) -> Result<Resolution, ResolverError> {
    // Check if there is a package.json in this directory, and if so, use its entries.
    // Note that the "exports" field is NOT used here - only in resolve_node_module.
    let path = dir.join("package.json");
    let contents = std::fs::read_to_string(&path);
    let package = if let Ok(file) = &contents {
      let package = PackageJson::parse(&path, &file)?;
      if let Ok(res) = self.try_package_entries(&package, specifier_type) {
        return Ok(res);
      }
      Some(package)
    } else {
      None
    };

    // If no package.json, or no entries, try an index file with all possible extensions.
    if dir.is_dir() {
      return self.try_extensions(
        &dir.join("index"),
        EXTENSIONS,
        package.as_ref().or(parent_package),
      );
    }

    Err(ResolverError::FileNotFound)
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
//   pub fn build(&mut self, file: &Path) -> Result<(), EsmGraphBuilderError> {
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
  use super::*;

  fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
      .parent()
      .unwrap()
      .join("node-resolver-core/test/fixture")
  }

  fn test_resolver() -> Resolver {
    Resolver {
      project_root: root(),
      mode: ResolverMode::Parcel,
    }
  }

  fn node_resolver() -> Resolver {
    Resolver {
      project_root: root(),
      mode: ResolverMode::Node,
    }
  }

  #[test]
  fn relative() {
    assert_eq!(
      test_resolver()
        .resolve("./bar.js", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("./bar", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("~/bar", &root().join("nested/test.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("~bar", &root().join("nested/test.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "~/bar",
          &root().join("node_modules/foo/nested/baz.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/foo/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("./nested", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("nested/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("./bar?foo=2", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert!(matches!(
      test_resolver().resolve("./bar?foo=2", &root().join("foo.js"), SpecifierType::Cjs),
      Err(ResolverError::FileNotFound)
    ));
  }

  #[test]
  fn test_absolute() {
    assert_eq!(
      test_resolver()
        .resolve("/bar", &root().join("nested/test.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "/bar",
          &root().join("node_modules/foo/index.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "file:///bar",
          &root().join("nested/test.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      node_resolver()
        .resolve(
          root().join("foo.js").to_str().unwrap(),
          &root().join("nested/test.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("foo.js"))
    );
    assert_eq!(
      node_resolver()
        .resolve(
          &format!("file://{}", root().join("foo.js").to_str().unwrap()),
          &root().join("nested/test.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("foo.js"))
    );
  }

  #[test]
  fn node_modules() {
    assert_eq!(
      test_resolver()
        .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("package-main", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-main/main.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("package-module", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-module/module.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-browser",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-browser/browser.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-fallback",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-fallback/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-main-directory",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-main-directory/nested/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("foo/nested/baz", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("node_modules/foo/nested/baz.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("node_modules/@scope/pkg/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "@scope/pkg/foo/bar",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/@scope/pkg/foo/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "foo/with space.mjs",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/foo/with space.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "foo/with%20space.mjs",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/foo/with space.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "foo/with space.mjs",
          &root().join("foo.js"),
          SpecifierType::Cjs
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/foo/with space.mjs"))
    );
    assert!(matches!(
      test_resolver().resolve(
        "foo/with%20space.mjs",
        &root().join("foo.js"),
        SpecifierType::Cjs
      ),
      Err(ResolverError::FileNotFound)
    ));
    assert_eq!(
      test_resolver()
        .resolve(
          "@scope/pkg?foo=2",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/@scope/pkg/index.js"))
    );
    assert!(matches!(
      test_resolver().resolve(
        "@scope/pkg?foo=2",
        &root().join("foo.js"),
        SpecifierType::Cjs
      ),
      Err(ResolverError::FileNotFound)
    ));
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
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-browser-alias/browser.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-browser-alias/foo",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-browser-alias/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./foo",
          &root().join("node_modules/package-browser-alias/browser.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-browser-alias/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./nested",
          &root().join("node_modules/package-browser-alias/browser.js"),
          SpecifierType::Esm
        )
        .unwrap(),
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
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-alias/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "./foo",
          &root().join("node_modules/package-alias/browser.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-alias/bar.js"))
    );
    // assert_eq!(
    //   test_resolver().resolve("./lib/test", &root().join("node_modules/package-alias-glob/browser.js"), SpecifierType::Esm).unwrap(),
    //   Resolution::Path(root().join("node_modules/package-alias-glob/src/test.js"))
    // );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-browser-exclude",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Excluded
    );
  }

  #[test]
  fn global_aliases() {
    assert_eq!(
      test_resolver()
        .resolve("aliased", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliased",
          &root().join("node_modules/package-alias/foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliased/bar",
          &root().join("node_modules/package-alias/foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/foo/bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("aliased-file", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliased-file",
          &root().join("node_modules/package-alias/foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliasedfolder/test.js",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("aliasedfolder", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("nested/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliasedabsolute/test.js",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "aliasedabsolute",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("nested/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("foo/bar", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    // assert_eq!(
    //   test_resolver().resolve("glob/bar/test", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
    //   Resolution::Path(root().join("nested/test.js"))
    // );
    assert_eq!(
      test_resolver()
        .resolve("something", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "something",
          &root().join("node_modules/package-alias/foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("nested/test.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-alias-exclude",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
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
        .unwrap(),
      Resolution::Excluded
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "//example.com/foo.png",
          &root().join("foo.js"),
          SpecifierType::Url
        )
        .unwrap(),
      Resolution::Excluded
    );
    assert_eq!(
      test_resolver()
        .resolve("#hash", &root().join("foo.js"), SpecifierType::Url)
        .unwrap(),
      Resolution::Excluded
    );
    assert!(matches!(
      test_resolver().resolve(
        "http://example.com/foo.png",
        &root().join("foo.js"),
        SpecifierType::Esm
      ),
      Err(ResolverError::UnknownScheme)
    ));
    assert_eq!(
      test_resolver()
        .resolve("bar.js", &root().join("foo.js"), SpecifierType::Url)
        .unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("npm:foo", &root().join("foo.js"), SpecifierType::Url)
        .unwrap(),
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      test_resolver()
        .resolve("npm:@scope/pkg", &root().join("foo.js"), SpecifierType::Url)
        .unwrap(),
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
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-exports/main.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-exports/foo",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
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
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-exports/features/test.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "package-exports/space",
          &root().join("foo.js"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-exports/with space.mjs"))
    );
    // assert_eq!(
    //   test_resolver().resolve("package-exports/with%20space", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
    //   Resolution::Path(root().join("node_modules/package-exports/with space.mjs"))
    // );
    assert!(matches!(
      test_resolver().resolve(
        "package-exports/with space",
        &root().join("foo.js"),
        SpecifierType::Esm
      ),
      Err(ResolverError::PackageJsonError(
        PackageJsonError::PackagePathNotExported
      ))
    ));
    assert!(matches!(
      test_resolver().resolve(
        "package-exports/internal",
        &root().join("foo.js"),
        SpecifierType::Esm
      ),
      Err(ResolverError::PackageJsonError(
        PackageJsonError::PackagePathNotExported
      ))
    ));
    assert!(matches!(
      test_resolver().resolve(
        "package-exports/internal.mjs",
        &root().join("foo.js"),
        SpecifierType::Esm
      ),
      Err(ResolverError::PackageJsonError(
        PackageJsonError::PackagePathNotExported
      ))
    ));
    assert!(matches!(
      test_resolver().resolve(
        "package-exports/invalid",
        &root().join("foo.js"),
        SpecifierType::Esm
      ),
      Err(ResolverError::PackageJsonError(
        PackageJsonError::InvalidPackageTarget
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
        .unwrap(),
      Resolution::Path(root().join("node_modules/package-exports/internal.mjs"))
    );
    assert_eq!(
      test_resolver()
        .resolve(
          "#foo",
          &root().join("node_modules/package-exports/main.mjs"),
          SpecifierType::Esm
        )
        .unwrap(),
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
  }

  #[test]
  fn test_builtins() {
    assert_eq!(
      test_resolver()
        .resolve("zlib", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Builtin("zlib".into())
    );
    assert_eq!(
      test_resolver()
        .resolve("node:zlib", &root().join("foo.js"), SpecifierType::Esm)
        .unwrap(),
      Resolution::Builtin("zlib".into())
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
