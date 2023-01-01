use bitflags::bitflags;
use indexmap::{indexmap, IndexMap};
use std::{
  borrow::Cow,
  cmp::Ordering,
  path::{Path, PathBuf},
};

use crate::utils::parse_package_specifier;

bitflags! {
  pub struct Fields: u8 {
    const MAIN = 1 << 0;
    const MODULE = 1 << 1;
    const SOURCE = 1 << 2;
    const BROWSER = 1 << 3;
    const ALIAS = 1 << 4;
  }
}

#[derive(serde::Deserialize, Debug)]
pub struct PackageJson<'a> {
  #[serde(skip, borrow, default = "empty_path")]
  pub path: &'a Path,
  name: &'a str,
  main: Option<&'a str>,
  module: Option<&'a str>,
  #[serde(default)]
  source: SourceField<'a>,
  #[serde(default)]
  browser: BrowserField<'a>,
  #[serde(default)]
  alias: IndexMap<&'a str, AliasValue<'a>>,
  #[serde(default)]
  exports: ExportsField<'a>,
  #[serde(default)]
  imports: IndexMap<&'a str, ExportsField<'a>>,
}

impl<'a> Default for PackageJson<'a> {
  fn default() -> Self {
    PackageJson {
      path: empty_path(),
      name: "",
      main: None,
      module: None,
      source: Default::default(),
      browser: Default::default(),
      alias: Default::default(),
      exports: Default::default(),
      imports: Default::default(),
    }
  }
}

fn empty_path() -> &'static Path {
  Path::new("")
}

#[derive(serde::Deserialize, Debug)]
#[serde(untagged)]
pub enum BrowserField<'a> {
  None,
  #[serde(borrow)]
  String(&'a str),
  Map(IndexMap<&'a str, AliasValue<'a>>),
}

impl<'a> Default for BrowserField<'a> {
  fn default() -> Self {
    BrowserField::None
  }
}

#[derive(serde::Deserialize, Debug)]
#[serde(untagged)]
pub enum SourceField<'a> {
  None,
  #[serde(borrow)]
  String(&'a str),
  Map(IndexMap<&'a str, AliasValue<'a>>),
  Array(Vec<&'a str>),
}

impl<'a> Default for SourceField<'a> {
  fn default() -> Self {
    SourceField::None
  }
}

#[derive(serde::Deserialize, Debug, PartialEq)]
#[serde(untagged)]
pub enum ExportsField<'a> {
  None,
  #[serde(borrow)]
  String(&'a str),
  Array(Vec<ExportsField<'a>>), // ???
  Map(IndexMap<&'a str, ExportsField<'a>>),
}

impl<'a> Default for ExportsField<'a> {
  fn default() -> Self {
    ExportsField::None
  }
}

#[derive(serde::Deserialize, Clone, PartialEq, Debug)]
#[serde(untagged)]
pub enum AliasValue<'a> {
  #[serde(borrow)]
  String(Cow<'a, str>),
  Bool(bool),
  Global {
    global: &'a str,
  },
}

#[derive(Debug)]
pub enum PackageJsonError {
  InvalidPackageTarget,
  PackagePathNotExported,
  InvalidSpecifier,
  ImportNotDefined,
}

#[derive(Debug, PartialEq)]
pub enum ExportsResolution<'a> {
  None,
  Path(PathBuf),
  Package(Cow<'a, str>),
}

impl<'a> PackageJson<'a> {
  pub fn parse(path: &'a Path, data: &'a str) -> serde_json::Result<PackageJson<'a>> {
    let mut parsed: PackageJson = serde_json::from_str(data)?;
    parsed.path = path;
    Ok(parsed)
  }

  pub fn entries(&self, fields: Fields) -> EntryIter {
    return EntryIter {
      package: self,
      fields,
    };
  }

  pub fn has_exports(&self) -> bool {
    self.exports != ExportsField::None
  }

  pub fn resolve_package_exports(
    &self,
    subpath: &str,
    conditions: &[&str],
  ) -> Result<ExportsResolution<'_>, PackageJsonError> {
    // TODO: If exports is an Object with both a key starting with "." and a key not starting with ".", throw an Invalid Package Configuration error.

    if subpath == "." {
      let mut main_export = &ExportsField::None;
      match &self.exports {
        ExportsField::None | ExportsField::String(_) | ExportsField::Array(_) => {
          main_export = &self.exports;
        }
        ExportsField::Map(map) => {
          if let Some(v) = map.get(".") {
            main_export = v;
          } else if !map.keys().any(|k| k.starts_with('.')) {
            main_export = &self.exports;
          }
        }
      }

      if main_export != &ExportsField::None {
        match self.resolve_package_target(main_export, "", false, conditions)? {
          ExportsResolution::None => {}
          res => return Ok(res),
        }
      }
    } else if let ExportsField::Map(exports) = &self.exports {
      // All exports must start with "." at this point.
      match self.resolve_package_imports_exports(subpath, &exports, false, conditions)? {
        ExportsResolution::None => {}
        res => return Ok(res),
      }
    }

    Err(PackageJsonError::PackagePathNotExported)
  }

  fn resolve_package_imports(
    &self,
    specifier: &str,
    conditions: &[&str],
  ) -> Result<ExportsResolution<'_>, PackageJsonError> {
    if specifier == "#" || specifier.starts_with("#/") {
      return Err(PackageJsonError::InvalidSpecifier);
    }

    match self.resolve_package_imports_exports(specifier, &self.imports, true, conditions)? {
      ExportsResolution::None => {}
      res => return Ok(res),
    }

    Err(PackageJsonError::ImportNotDefined)
  }

  fn resolve_package_target(
    &self,
    target: &'a ExportsField,
    pattern_match: &str,
    is_imports: bool,
    conditions: &[&str],
  ) -> Result<ExportsResolution<'_>, PackageJsonError> {
    match target {
      ExportsField::String(target) => {
        if !target.starts_with("./") {
          if !is_imports || target.starts_with("../") || target.starts_with('/') {
            return Err(PackageJsonError::InvalidPackageTarget);
          }

          if pattern_match != "" {
            let target = target.replace('*', pattern_match);
            return Ok(ExportsResolution::Package(Cow::Owned(target)));
          }

          return Ok(ExportsResolution::Package(Cow::Borrowed(target)));
        }

        // TODO: If target split on "/" or "\" contains any "", ".", "..", or "node_modules" segments after
        // the first "." segment, case insensitive and including percent encoded variants,
        // throw an Invalid Package Target error.

        let target = if pattern_match == "" {
          Cow::Borrowed(*target)
        } else {
          Cow::Owned(target.replace('*', pattern_match))
        };

        let resolved_target = self.path.with_file_name(target.as_ref());
        return Ok(ExportsResolution::Path(resolved_target));
      }
      ExportsField::Map(target) => {
        // We must iterate in object insertion order.
        for (key, value) in target {
          if *key == "default" || conditions.contains(key) {
            match self.resolve_package_target(value, pattern_match, is_imports, conditions)? {
              ExportsResolution::None => continue,
              res => return Ok(res),
            }
          }
        }
      }
      ExportsField::Array(target) => {
        if target.is_empty() {
          return Ok(ExportsResolution::None);
        }

        for item in target {
          match self.resolve_package_target(item, pattern_match, is_imports, conditions) {
            Err(_) | Ok(ExportsResolution::None) => continue,
            Ok(res) => return Ok(res),
          }
        }
      }
      ExportsField::None => return Ok(ExportsResolution::None),
    }

    Err(PackageJsonError::InvalidPackageTarget)
  }

  fn resolve_package_imports_exports(
    &self,
    match_key: &str,
    match_obj: &'a IndexMap<&'a str, ExportsField<'a>>,
    is_imports: bool,
    conditions: &[&str],
  ) -> Result<ExportsResolution<'_>, PackageJsonError> {
    if let Some(target) = match_obj.get(match_key) {
      if !match_key.contains('*') {
        return self.resolve_package_target(target, "", is_imports, conditions);
      }
    }

    let mut best_key = "";
    let mut best_match = "";
    for key in match_obj.keys() {
      if let Some((pattern_base, pattern_trailer)) = key.split_once('*') {
        if match_key.starts_with(pattern_base)
          && (pattern_trailer.is_empty()
            || (match_key.len() >= key.len() && match_key.ends_with(pattern_trailer)))
          && pattern_key_compare(best_key, key) == Ordering::Greater
        {
          best_key = key;
          best_match = &match_key[pattern_base.len()..match_key.len() - pattern_trailer.len()];
        }
      }
    }

    if !best_key.is_empty() {
      return self.resolve_package_target(&match_obj[best_key], best_match, is_imports, conditions);
    }

    Ok(ExportsResolution::None)
  }

  pub fn resolve_aliases(&self, specifier: &str, fields: Fields) -> ExportsResolution {
    if fields.contains(Fields::SOURCE) {
      match &self.source {
        SourceField::Map(source) => match self.resolve_alias(source, specifier) {
          ExportsResolution::None => {}
          res => return res,
        },
        _ => {}
      }
    }

    if fields.contains(Fields::ALIAS) {
      match self.resolve_alias(&self.alias, specifier) {
        ExportsResolution::None => {}
        res => return res,
      }
    }

    if fields.contains(Fields::BROWSER) {
      match &self.browser {
        BrowserField::Map(browser) => match self.resolve_alias(browser, specifier) {
          ExportsResolution::None => {}
          res => return res,
        },
        _ => {}
      }
    }

    ExportsResolution::None
  }

  fn resolve_alias(
    &self,
    map: &'a IndexMap<&'a str, AliasValue<'a>>,
    specifier: &str,
  ) -> ExportsResolution {
    if let Some(alias) = self.lookup_alias(map, specifier) {
      return match alias {
        AliasValue::String(val) => {
          if val.starts_with("./") {
            ExportsResolution::Path(self.path.with_file_name(val.as_ref()))
          } else {
            ExportsResolution::Package(val.clone())
          }
        }
        _ => todo!(),
      }
    }

    if !specifier.starts_with("./") {
      if let Ok((module_name, subpath)) = parse_package_specifier(specifier) {
        return match self.lookup_alias(map, module_name) {
          None => ExportsResolution::None,
          Some(AliasValue::String(base)) => {
            // Join the subpath back onto the resolved alias.
            // If the alias starts with "./", it could be a directory.
            if base.starts_with("./") {
              let mut path = self.path.with_file_name(base.as_ref());
              path.push(subpath);
              return ExportsResolution::Path(path);
            }

            return ExportsResolution::Package(Cow::Owned(format!(
              "{}/{}",
              base.trim_end_matches('/'),
              subpath
            )));
          }
          Some(alias) => todo!(),
        };
      }
    }

    ExportsResolution::None
  }

  fn lookup_alias(
    &self,
    map: &'a IndexMap<&'a str, AliasValue<'a>>,
    specifier: &str,
  ) -> Option<&AliasValue> {
    if let Some(value) = map.get(specifier) {
      return Some(value);
    }

    // TODO: glob

    None
  }
}

fn pattern_key_compare(a: &str, b: &str) -> Ordering {
  let a_pos = a.chars().position(|c| c == '*');
  let b_pos = b.chars().position(|c| c == '*');
  let base_length_a = a_pos.map_or(a.len(), |p| p + 1);
  let base_length_b = b_pos.map_or(b.len(), |p| p + 1);
  let cmp = base_length_b.cmp(&base_length_a);
  if cmp != Ordering::Equal {
    return cmp;
  }

  if a_pos == None {
    return Ordering::Greater;
  }

  if b_pos == None {
    return Ordering::Less;
  }

  b.len().cmp(&a.len())
}

pub struct EntryIter<'a> {
  package: &'a PackageJson<'a>,
  fields: Fields,
}

impl<'a> Iterator for EntryIter<'a> {
  type Item = PathBuf;

  fn next(&mut self) -> Option<Self::Item> {
    if self.fields.contains(Fields::BROWSER) {
      self.fields.remove(Fields::BROWSER);
      match &self.package.browser {
        BrowserField::None => {}
        BrowserField::String(browser) => return Some(self.package.path.with_file_name(browser)),
        BrowserField::Map(map) => match map.get(self.package.name) {
          Some(AliasValue::String(s)) => return Some(self.package.path.with_file_name(s.as_ref())),
          _ => {}
        },
      }
    }

    if self.fields.contains(Fields::MODULE) {
      self.fields.remove(Fields::MODULE);
      if let Some(module) = self.package.module {
        return Some(self.package.path.with_file_name(module));
      }
    }

    if self.fields.contains(Fields::MAIN) {
      self.fields.remove(Fields::MAIN);
      if let Some(main) = self.package.main {
        return Some(self.package.path.with_file_name(main));
      }
    }

    None
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  // Based on https://github.com/lukeed/resolve.exports/blob/master/test/resolve.js

  #[test]
  fn exports_string() {
    let pkg = PackageJson {
      path: Path::new("/foo/package.json"),
      name: "foobar",
      exports: ExportsField::String("./exports.js"),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_package_exports(".", &[]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/exports.js"))
    );
    // assert_eq!(pkg.resolve_package_exports("./exports.js", &[]).unwrap(), ExportsResolution::Path(PathBuf::from("/foo/exports.js")));
    // assert_eq!(pkg.resolve_package_exports("foobar", &[]).unwrap(), ExportsResolution::Path(PathBuf::from("/foo/exports.js")));
  }

  #[test]
  fn exports_dot() {
    let pkg = PackageJson {
      path: Path::new("/foo/package.json"),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "." => ExportsField::String("./exports.js")
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_package_exports(".", &[]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/exports.js"))
    );
    // assert_eq!(pkg.resolve_package_exports("foobar", &[]).unwrap(), ExportsResolution::Path(PathBuf::from("/foo/exports.js")));
  }

  #[test]
  fn exports_dot_conditions() {
    let pkg = PackageJson {
      path: Path::new("/foo/package.json"),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "." => ExportsField::Map(indexmap! {
          "import" => ExportsField::String("./import.js"),
          "require" => ExportsField::String("./require.js")
        })
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg
        .resolve_package_exports(".", &["import", "require"])
        .unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/import.js"))
    );
    assert_eq!(
      pkg.resolve_package_exports(".", &["require"]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/require.js"))
    );
  }

  #[test]
  fn exports_map_string() {
    let pkg = PackageJson {
      path: Path::new("/foo/package.json"),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "./foo" => ExportsField::String("./exports.js")
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_package_exports("./foo", &[]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/exports.js"))
    );
  }

  #[test]
  fn exports_map_conditions() {
    let pkg = PackageJson {
      path: Path::new("/foo/package.json"),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "./foo" => ExportsField::Map(indexmap! {
          "import" => ExportsField::String("./import.js"),
          "require" => ExportsField::String("./require.js")
        })
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg
        .resolve_package_exports("./foo", &["import", "require"])
        .unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/import.js"))
    );
    assert_eq!(
      pkg.resolve_package_exports("./foo", &["require"]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/require.js"))
    );
  }

  #[test]
  fn nested_conditions() {
    let pkg = PackageJson {
      path: Path::new("/foo/package.json"),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "node" => ExportsField::Map(indexmap! {
          "import" => ExportsField::String("./import.js"),
          "require" => ExportsField::String("./require.js")
        }),
        "default" => ExportsField::String("./default.js")
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg
        .resolve_package_exports(".", &["node", "import"])
        .unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/import.js"))
    );
    assert_eq!(
      pkg
        .resolve_package_exports(".", &["node", "require"])
        .unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/require.js"))
    );
    assert_eq!(
      pkg.resolve_package_exports(".", &["import"]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/default.js"))
    );
  }

  #[test]
  fn subpath_nested_conditions() {
    let pkg = PackageJson {
      path: Path::new("/foo/package.json"),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "./lite" => ExportsField::Map(indexmap! {
          "node" => ExportsField::Map(indexmap! {
            "import" => ExportsField::String("./node_import.js"),
            "require" => ExportsField::String("./node_require.js")
          }),
          "browser" => ExportsField::Map(indexmap! {
            "import" => ExportsField::String("./browser_import.js"),
            "require" => ExportsField::String("./browser_require.js")
          }),
        })
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg
        .resolve_package_exports("./lite", &["node", "import"])
        .unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/node_import.js"))
    );
    assert_eq!(
      pkg
        .resolve_package_exports("./lite", &["node", "require"])
        .unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/node_require.js"))
    );
    assert_eq!(
      pkg
        .resolve_package_exports("./lite", &["browser", "import"])
        .unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/browser_import.js"))
    );
    assert_eq!(
      pkg
        .resolve_package_exports("./lite", &["browser", "require"])
        .unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/browser_require.js"))
    );
  }

  #[test]
  fn subpath_star() {
    let pkg = PackageJson {
      path: Path::new("/foo/package.json"),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "./*" => ExportsField::String("./cheese/*.mjs"),
        "./pizza/*" => ExportsField::String("./pizza/*.mjs"),
        "./burritos/*" => ExportsField::String("./burritos/*/*.mjs")
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_package_exports("./hello", &[]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/cheese/hello.mjs"))
    );
    assert_eq!(
      pkg.resolve_package_exports("./hello/world", &[]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/cheese/hello/world.mjs"))
    );
    assert_eq!(
      pkg.resolve_package_exports("./hello.js", &[]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/cheese/hello.js.mjs"))
    );
    assert_eq!(
      pkg.resolve_package_exports("./pizza/test", &[]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/pizza/test.mjs"))
    );
    assert_eq!(
      pkg.resolve_package_exports("./burritos/test", &[]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/burritos/test/test.mjs"))
    );
  }

  #[test]
  fn aliases() {
    let pkg = PackageJson {
      path: Path::new("/foo/package.json"),
      name: "foobar",
      alias: indexmap! {
        "./foo.js" => AliasValue::String("./foo-alias.js".into()),
        "bar" => AliasValue::String("./bar-alias.js".into()),
        "lodash" => AliasValue::String("my-lodash".into()),
        "lodash/clone" => AliasValue::String("./clone.js".into()),
        "test" => AliasValue::String("./test".into()),
      },
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_aliases("./foo.js", Fields::ALIAS),
      ExportsResolution::Path(PathBuf::from("/foo/foo-alias.js"))
    );
    assert_eq!(
      pkg.resolve_aliases("bar", Fields::ALIAS),
      ExportsResolution::Path(PathBuf::from("/foo/bar-alias.js"))
    );
    assert_eq!(
      pkg.resolve_aliases("lodash", Fields::ALIAS),
      ExportsResolution::Package("my-lodash".into())
    );
    assert_eq!(
      pkg.resolve_aliases("lodash/foo", Fields::ALIAS),
      ExportsResolution::Package("my-lodash/foo".into())
    );
    assert_eq!(
      pkg.resolve_aliases("lodash/clone", Fields::ALIAS),
      ExportsResolution::Path(PathBuf::from("/foo/clone.js"))
    );
    assert_eq!(
      pkg.resolve_aliases("test", Fields::ALIAS),
      ExportsResolution::Path(PathBuf::from("/foo/test"))
    );
    assert_eq!(
      pkg.resolve_aliases("test/foo", Fields::ALIAS),
      ExportsResolution::Path(PathBuf::from("/foo/test/foo"))
    );
  }
}
