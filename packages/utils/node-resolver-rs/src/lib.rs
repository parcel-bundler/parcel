// trait FileSystem {
//   read()
// }

use std::{path::{PathBuf, Path}, collections::{HashSet}, borrow::Cow, ffi::OsString, fs};
use url::{Url, ParseError};
use percent_encoding::percent_decode_str;
// use bitflags::bitflags;
use es_module_lexer::{lex, ImportKind};

const EXTENSIONS: &'static [&'static str] = &["js", "json"];
const BUILTINS: &'static [&'static str] = &[
  "path",
  "fs",
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

#[derive(PartialEq, Eq)]
pub enum ResolverMode {
  Parcel,
  Node,
}

pub struct Resolver {
  project_root: PathBuf,
  mode: ResolverMode
}

#[derive(PartialEq, Eq, Hash)]
enum FileCreateInvalidation {
  Path(PathBuf)
}

struct Invalidations {
  invalidate_on_file_create: HashSet<FileCreateInvalidation>,
  invalidate_on_file_delete: HashSet<PathBuf>
}

#[derive(PartialEq, Eq, Clone, Copy)]
pub enum SpecifierType {
  Esm,
  Cjs,
  Url
}

#[derive(Debug)]
pub enum ResolverError {
  EmptySpecifier,
  UnknownScheme,
  UrlError(ParseError),
  UnknownError,
  FileNotFound,
  JsonError(serde_json::Error),
  IOError(std::io::Error)
}

impl From<ParseError> for ResolverError {
  fn from(e: ParseError) -> Self {
    ResolverError::UrlError(e)
  }
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

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum Resolution {
  Excluded,
  Path(PathBuf),
  Builtin(String)
}

#[derive(serde::Deserialize)]
struct PackageJson<'a> {
  #[serde(borrow)]
  main: Option<&'a str>,
  module: Option<&'a str>,
  source: Option<&'a str>,
  browser: Option<&'a str>,
}

#[derive(PartialEq, Eq)]
enum Prioritize {
  Directory,
  File
}

impl Resolver {
  pub fn resolve(&self, specifier: &str, from: &Path, specifier_type: SpecifierType) -> Result<Resolution, ResolverError> {
    if specifier.is_empty() {
      return Err(ResolverError::EmptySpecifier)
    }

    match specifier.as_bytes()[0] {
      b'.' => {
        // Relative path
        self.resolve_relative(specifier, from, specifier_type)
      }
      b'~' if self.mode == ResolverMode::Parcel => {
        // Tilde path. Resolve relative to nearest node_modules directory,
        // the nearest directory with package.json or the project root - whichever comes first.
        let mut specifier = &specifier[1..];
        if specifier.starts_with('/') {
          specifier = &specifier[1..];
        }
        for ancestor in from.ancestors() {
          if let Some(parent) = ancestor.parent() {
            if parent == self.project_root {
              return self.resolve_relative(specifier, &ancestor, specifier_type);
            }
          }
          
          let p = ancestor.join("package.json");
          if p.is_file() {
            return self.resolve_relative(specifier, &p, specifier_type);
          }
        }
        
        Err(ResolverError::FileNotFound)
      }
      b'/' if self.mode == ResolverMode::Parcel => {
        self.resolve_relative(&specifier[1..], &self.project_root.join("index"), specifier_type)
      }
      b'#' if self.mode == ResolverMode::Parcel && specifier_type == SpecifierType::Url => {
        // An ID-only URL, e.g. `url(#clip-path)` for CSS rules. Ignore.
        // TODO: handle '#' for Node package imports.
        Ok(Resolution::Excluded)
      }
      _ => {
        // Bare specifier.
        self.resolve_bare(specifier, from, specifier_type)
      }
    }
  }

  fn resolve_relative(&self, specifier: &str, from: &Path, specifier_type: SpecifierType) -> Result<Resolution, ResolverError> {
    let path = match specifier_type {
      SpecifierType::Url | SpecifierType::Esm => {
        let url = Url::from_file_path(from)?;
        url.join(specifier)?.to_file_path()?
      }
      SpecifierType::Cjs => {
        from.with_file_name(specifier)
      }
    };

    self.load_path(&path, specifier_type, Prioritize::File)
  }

  fn resolve_bare(&self, specifier: &str, from: &Path, specifier_type: SpecifierType) -> Result<Resolution, ResolverError> {
    match specifier_type {
      SpecifierType::Url | SpecifierType::Esm => {
        match Url::parse(specifier) {
          Ok(url) => {
            match url.scheme() {
              "npm" if self.mode == ResolverMode::Parcel => {
                self.resolve_node_module(percent_decode_str(url.path()).decode_utf8()?, from, specifier_type)
              }
              "node" => {
                // Node does not URL decode or support query params here.
                // See https://github.com/nodejs/node/issues/39710.
                Ok(Resolution::Builtin(url.path().to_owned()))
              }
              "file" => {
                self.load_path(&url.to_file_path()?, specifier_type, Prioritize::File)
              }
              _ => {
                if specifier_type == SpecifierType::Url {
                  return Ok(Resolution::Excluded)
                }
                Err(ResolverError::UnknownScheme)
              }
            }
          }
          Err(_) => {
            self.resolve_node_module(percent_decode_str(specifier).decode_utf8()?, from, specifier_type)
          }
        }
      }
      SpecifierType::Cjs => {
        self.resolve_node_module(Cow::Borrowed(specifier), from, specifier_type)
      }
    }
  }

  fn resolve_node_module(&self, specifier: Cow<'_, str>, from: &Path, specifier_type: SpecifierType) -> Result<Resolution, ResolverError> {
    if BUILTINS.contains(&specifier.as_ref()) {
      return Ok(Resolution::Builtin(specifier.as_ref().to_owned()))
    }

    let idx = specifier.chars().position(|p| p == '/');
    let (module, sub_path) = if specifier.starts_with('@') {
      let idx = idx.ok_or(ResolverError::UnknownError)?;
      if let Some(next) = &specifier[idx + 1..].chars().position(|p| p == '/') {
        (&specifier[0..idx + 1 + *next], Some(&specifier[idx + *next + 2..]))
      } else {
        (&specifier[..], None)
      }
    } else if let Some(idx) = idx {
      (&specifier[0..idx], Some(&specifier[idx + 1..]))
    } else {
      (&specifier[..], None)
    };

    for dir in from.ancestors() {
      // Skip over node_modules directories
      if let Some(filename) = dir.file_name() {
        if filename == "node_modules" {
          continue;
        }
      }
  
      let mut fullpath = dir.join("node_modules").join(module);
      if fullpath.is_dir() {
        if let Some(sub_path) = sub_path {
          // TODO: if node esm, only allow exports field.
          fullpath.push(sub_path);
          return self.load_path(&fullpath, specifier_type, Prioritize::File)
        } else {
          // return self.load_path(&fullpath, specifier_type, Prioritize::Directory)
          return self.load_directory(&fullpath, specifier_type)
        }
      }
    }

    Err(ResolverError::FileNotFound)
  }

  fn load_path(&self, path: &Path, specifier_type: SpecifierType, prioritize: Prioritize) -> Result<Resolution, ResolverError> {
    // Urls and Node ESM do not resolve directory index files and do not add any extensions.
    match specifier_type {
      SpecifierType::Cjs => {},
      SpecifierType::Esm if self.mode == ResolverMode::Parcel => {},
      SpecifierType::Url | SpecifierType::Esm => {
        return self.load_file(path, &[])
      },
    }

    if prioritize == Prioritize::Directory {
      self.load_directory(path, specifier_type).or_else(|_| self.load_file(path, EXTENSIONS))
    } else {
      self.load_file(path, EXTENSIONS).or_else(|_| self.load_directory(path, specifier_type))
    }
  }

  fn load_file(&self, path: &Path, extensions: &[&str]) -> Result<Resolution, ResolverError> {
    if path.is_file() {
      return Ok(Resolution::Path(fs::canonicalize(path)?))
    }

    for ext in extensions {
      // Append extension.
      let mut p: OsString = path.into();
      p.push(".");
      p.push(ext);
      let p: PathBuf = p.into();

      println!("{:?}", p);
      if p.is_file() {
        return Ok(Resolution::Path(fs::canonicalize(p)?))
      }

      // TODO: add invalidation
    }

    Err(ResolverError::FileNotFound)
  }

  fn load_directory(&self, dir: &Path, specifier_type: SpecifierType) -> Result<Resolution, ResolverError> {
    if let Ok(res) = self.load_package(dir, specifier_type) {
      return Ok(res)
    }

    if dir.is_dir() {
      return self.load_file(&dir.join("index"), EXTENSIONS)
    }

    Err(ResolverError::FileNotFound)
  }

  fn load_package(&self, dir: &Path, specifier_type: SpecifierType) -> Result<Resolution, ResolverError> {
    let path = dir.join("package.json");
    let file = std::fs::read_to_string(path)?;
    let package: PackageJson = serde_json::from_str(&file)?;

    if self.mode == ResolverMode::Parcel {
      if let Ok(res) = self.load_package_entry(dir, package.module, specifier_type) {
        return Ok(res)
      }

      if let Ok(res) = self.load_package_entry(dir, package.browser, specifier_type) {
        return Ok(res)
      }
    }

    if let Ok(res) = self.load_package_entry(dir, package.main, specifier_type) {
      return Ok(res)
    }

    self.load_file(&dir.join("index"), EXTENSIONS)
  }

  fn load_package_entry(&self, dir: &Path, entry: Option<&str>, specifier_type: SpecifierType) -> Result<Resolution, ResolverError> {
    if let Some(entry) = entry {
      let path = dir.join(entry);
      let prioritize = if path.extension().is_some() {
        Prioritize::File
      } else {
        Prioritize::Directory
      };
      return self.load_path(&path, specifier_type, prioritize)
    }

    Err(ResolverError::FileNotFound)
  }
}

#[derive(Debug)]
enum EsmGraphBuilderError {
  IOError(std::io::Error),
  ParseError,
  ResolverError(ResolverError),
  Dynamic
}

impl From<std::io::Error> for EsmGraphBuilderError {
  fn from(e: std::io::Error) -> Self {
    EsmGraphBuilderError::IOError(e)
  }
}

impl From<usize> for EsmGraphBuilderError {
  fn from(e: usize) -> Self {
    EsmGraphBuilderError::ParseError
  }
}

impl From<ResolverError> for EsmGraphBuilderError {
  fn from(e: ResolverError) -> Self {
    EsmGraphBuilderError::ResolverError(e)
  }
}

struct EsmGraphBuilder {
  visited: HashSet<PathBuf>,
  resolver: Resolver
}

impl EsmGraphBuilder {
  pub fn build(&mut self, file: &Path) -> Result<(), EsmGraphBuilderError> {
    if self.visited.contains(file) {
      return Ok(());
    }

    self.visited.insert(file.to_owned());
    
    let contents = std::fs::read_to_string(&file)?;
    let module = lex(&contents)?;
    for import in module.imports() {
      println!("IMPORT {} {:?} {:?}", import.specifier(), import.kind(), file);
      match import.kind() {
        ImportKind::DynamicExpression => return Err(EsmGraphBuilderError::Dynamic),
        ImportKind::DynamicString | ImportKind::Standard => {
          match self.resolver.resolve(import.specifier(), &file, SpecifierType::Esm)? {
            Resolution::Path(p) => {
              self.build(&p)?;
            }
            _ => {}
          }
        }
        ImportKind::Meta => {}
      }
    }

    Ok(())
  }
}

fn build_esm_graph(file: &Path, project_root: PathBuf) -> Result<HashSet<PathBuf>, EsmGraphBuilderError> {
  let mut visitor = EsmGraphBuilder {
    visited: HashSet::new(),
    resolver: Resolver {
      project_root,
      mode: ResolverMode::Node
    }
  };

  visitor.build(file)?;
  Ok(visitor.visited)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("node-resolver-core/test/fixture")
  }

  fn test_resolver() -> Resolver {
    Resolver {
      project_root: root(),
      mode: ResolverMode::Parcel
    }
  }

  #[test]
  fn relative() {
    assert_eq!(
      test_resolver().resolve("./bar.js", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver().resolve("./bar", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver().resolve("/bar", &root().join("nested/test.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver().resolve("/bar", &root().join("node_modules/foo/index.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver().resolve("~/bar", &root().join("nested/test.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver().resolve("~bar", &root().join("nested/test.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      test_resolver().resolve("~/bar", &root().join("node_modules/foo/nested/baz.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("node_modules/foo/bar.js"))
    );
    assert_eq!(
      test_resolver().resolve("./nested", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("nested/index.js"))
    );
  }

  #[test]
  fn node_modules() {
    assert_eq!(
      test_resolver().resolve("foo", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("node_modules/foo/index.js"))
    );
    assert_eq!(
      test_resolver().resolve("package-main", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("node_modules/package-main/main.js"))
    );
    assert_eq!(
      test_resolver().resolve("package-module", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("node_modules/package-module/module.js"))
    );
    assert_eq!(
      test_resolver().resolve("package-browser", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("node_modules/package-browser/browser.js"))
    );
    assert_eq!(
      test_resolver().resolve("package-fallback", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("node_modules/package-fallback/index.js"))
    );
    assert_eq!(
      test_resolver().resolve("package-main-directory", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("node_modules/package-main-directory/nested/index.js"))
    );
    assert_eq!(
      test_resolver().resolve("foo/nested/baz", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("node_modules/foo/nested/baz.js"))
    );
    assert_eq!(
      test_resolver().resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("node_modules/@scope/pkg/index.js"))
    );
    assert_eq!(
      test_resolver().resolve("@scope/pkg/foo/bar", &root().join("foo.js"), SpecifierType::Esm).unwrap(),
      Resolution::Path(root().join("node_modules/@scope/pkg/foo/bar.js"))
    );
  }

  #[test]
  fn test_visitor() {
    let resolved = test_resolver().resolve("unified", &root(), SpecifierType::Esm).unwrap();
    println!("{:?}", resolved);
    if let Resolution::Path(p) = resolved {
      let res = build_esm_graph(
        &p,
        root()
      ).unwrap();
      println!("{:?}", res);
    }
  }
}
