use bitflags::bitflags;
use glob_match::{glob_match, glob_match_with_captures};
use indexmap::IndexMap;
use serde::Deserialize;
use std::{
  borrow::Cow,
  cmp::Ordering,
  ops::Range,
  path::{Path, PathBuf},
};

use crate::{specifier::decode_path, specifier::Specifier, SpecifierType};

bitflags! {
  pub struct Fields: u8 {
    const MAIN = 1 << 0;
    const MODULE = 1 << 1;
    const SOURCE = 1 << 2;
    const BROWSER = 1 << 3;
    const ALIAS = 1 << 4;
    const TSCONFIG = 1 << 5;
  }
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PackageJson<'a> {
  #[serde(skip)]
  pub path: PathBuf,
  #[serde(default)]
  name: &'a str,
  main: Option<&'a str>,
  module: Option<&'a str>,
  #[serde(default)]
  tsconfig: Option<&'a str>,
  #[serde(default)]
  pub source: SourceField<'a>,
  #[serde(default)]
  browser: BrowserField<'a>,
  #[serde(default)]
  alias: IndexMap<Specifier<'a>, AliasValue<'a>>,
  #[serde(default)]
  exports: ExportsField<'a>,
  #[serde(default)]
  imports: IndexMap<ExportsKey<'a>, ExportsField<'a>>,
  #[serde(default)]
  side_effects: SideEffects<'a>,
}

impl<'a> Default for PackageJson<'a> {
  fn default() -> Self {
    PackageJson {
      path: Default::default(),
      name: "",
      main: None,
      module: None,
      tsconfig: None,
      source: Default::default(),
      browser: Default::default(),
      alias: Default::default(),
      exports: Default::default(),
      imports: Default::default(),
      side_effects: Default::default(),
    }
  }
}

#[derive(serde::Deserialize, Debug)]
#[serde(untagged)]
pub enum BrowserField<'a> {
  None,
  #[serde(borrow)]
  String(&'a str),
  Map(IndexMap<Specifier<'a>, AliasValue<'a>>),
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
  Map(IndexMap<Specifier<'a>, AliasValue<'a>>),
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
  Map(IndexMap<ExportsKey<'a>, ExportsField<'a>>),
}

impl<'a> Default for ExportsField<'a> {
  fn default() -> Self {
    ExportsField::None
  }
}

#[derive(Debug, PartialEq, Eq, Hash)]
pub enum ExportsKey<'a> {
  Main,
  Pattern(&'a str),
  Target(&'a str),
}

impl<'a> From<&'a str> for ExportsKey<'a> {
  fn from(key: &'a str) -> Self {
    if key == "." {
      ExportsKey::Main
    } else if key.starts_with("./") {
      ExportsKey::Pattern(&key[2..])
    } else if key.starts_with('#') {
      ExportsKey::Pattern(&key[1..])
    } else {
      ExportsKey::Target(key)
    }
  }
}

impl<'a, 'de: 'a> Deserialize<'de> for ExportsKey<'a> {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let s: &'de str = Deserialize::deserialize(deserializer)?;
    Ok(ExportsKey::from(s))
  }
}

#[derive(serde::Deserialize, Clone, PartialEq, Debug)]
#[serde(untagged)]
pub enum AliasValue<'a> {
  #[serde(borrow)]
  Specifier(Specifier<'a>),
  Bool(bool),
  Global {
    global: &'a str,
  },
}

#[derive(serde::Deserialize, Clone, PartialEq, Debug)]
#[serde(untagged)]
pub enum SideEffects<'a> {
  None,
  Boolean(bool),
  #[serde(borrow)]
  String(&'a str),
  Array(Vec<&'a str>),
}

impl<'a> Default for SideEffects<'a> {
  fn default() -> Self {
    SideEffects::None
  }
}

#[derive(Debug, Clone)]
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
  pub fn parse(path: PathBuf, data: &'a str) -> serde_json::Result<PackageJson<'a>> {
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
    subpath: &'a str,
    conditions: &[&str],
  ) -> Result<PathBuf, PackageJsonError> {
    // TODO: If exports is an Object with both a key starting with "." and a key not starting with ".", throw an Invalid Package Configuration error.

    if subpath.is_empty() {
      let mut main_export = &ExportsField::None;
      match &self.exports {
        ExportsField::None | ExportsField::String(_) | ExportsField::Array(_) => {
          main_export = &self.exports;
        }
        ExportsField::Map(map) => {
          if let Some(v) = map.get(&ExportsKey::Main) {
            main_export = v;
          } else if !map.keys().any(|k| matches!(k, ExportsKey::Pattern(_))) {
            main_export = &self.exports;
          }
        }
      }

      if main_export != &ExportsField::None {
        match self.resolve_package_target(main_export, "", false, conditions)? {
          ExportsResolution::Path(path) => return Ok(path),
          ExportsResolution::None | ExportsResolution::Package(..) => {}
        }
      }
    } else if let ExportsField::Map(exports) = &self.exports {
      // All exports must start with "." at this point.
      match self.resolve_package_imports_exports(subpath, &exports, false, conditions)? {
        ExportsResolution::Path(path) => return Ok(path),
        ExportsResolution::None | ExportsResolution::Package(..) => {}
      }
    }

    Err(PackageJsonError::PackagePathNotExported)
  }

  pub fn resolve_package_imports(
    &self,
    specifier: &'a str,
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

        let resolved_target = self
          .path
          .with_file_name(decode_path(target.as_ref(), SpecifierType::Esm).as_ref());
        return Ok(ExportsResolution::Path(resolved_target));
      }
      ExportsField::Map(target) => {
        // We must iterate in object insertion order.
        for (key, value) in target {
          if let ExportsKey::Target(key) = key {
            if *key == "default" || conditions.contains(key) {
              match self.resolve_package_target(value, pattern_match, is_imports, conditions)? {
                ExportsResolution::None => continue,
                res => return Ok(res),
              }
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
    match_key: &'a str,
    match_obj: &'a IndexMap<ExportsKey<'a>, ExportsField<'a>>,
    is_imports: bool,
    conditions: &[&str],
  ) -> Result<ExportsResolution<'_>, PackageJsonError> {
    let pattern = ExportsKey::Pattern(match_key);
    if let Some(target) = match_obj.get(&pattern) {
      if !match_key.contains('*') {
        return self.resolve_package_target(target, "", is_imports, conditions);
      }
    }

    let mut best_key = "";
    let mut best_match = "";
    for key in match_obj.keys() {
      if let ExportsKey::Pattern(key) = key {
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
    }

    if !best_key.is_empty() {
      return self.resolve_package_target(
        &match_obj[&ExportsKey::Pattern(best_key)],
        best_match,
        is_imports,
        conditions,
      );
    }

    Ok(ExportsResolution::None)
  }

  pub fn resolve_aliases(
    &self,
    specifier: &Specifier<'a>,
    fields: Fields,
  ) -> Option<Cow<'_, AliasValue>> {
    if fields.contains(Fields::SOURCE) {
      match &self.source {
        SourceField::Map(source) => match self.resolve_alias(source, specifier) {
          None => {}
          res => return res,
        },
        _ => {}
      }
    }

    if fields.contains(Fields::ALIAS) {
      match self.resolve_alias(&self.alias, specifier) {
        None => {}
        res => return res,
      }
    }

    if fields.contains(Fields::BROWSER) {
      match &self.browser {
        BrowserField::Map(browser) => match self.resolve_alias(browser, specifier) {
          None => {}
          res => return res,
        },
        _ => {}
      }
    }

    None
  }

  fn resolve_alias(
    &self,
    map: &'a IndexMap<Specifier<'a>, AliasValue<'a>>,
    specifier: &Specifier<'a>,
  ) -> Option<Cow<'_, AliasValue>> {
    if let Some(alias) = self.lookup_alias(map, specifier) {
      return Some(alias);
    }

    match specifier {
      Specifier::Package(package, subpath) => {
        if let Some(alias) =
          self.lookup_alias(map, &Specifier::Package(package.clone(), Cow::Borrowed("")))
        {
          match alias.as_ref() {
            AliasValue::Specifier(base) => {
              // Join the subpath back onto the resolved alias.
              match base {
                Specifier::Package(base_pkg, base_subpath) => {
                  let subpath = if !base_subpath.is_empty() && !subpath.is_empty() {
                    Cow::Owned(format!("{}/{}", base_subpath, subpath))
                  } else if !subpath.is_empty() {
                    subpath.clone()
                  } else {
                    return Some(alias);
                  };
                  return Some(Cow::Owned(AliasValue::Specifier(Specifier::Package(
                    base_pkg.clone(),
                    subpath,
                  ))));
                }
                Specifier::Relative(path) => {
                  if subpath.is_empty() {
                    return Some(alias);
                  } else {
                    return Some(Cow::Owned(AliasValue::Specifier(Specifier::Relative(
                      Cow::Owned(path.join(subpath.as_ref())),
                    ))));
                  }
                }
                Specifier::Absolute(path) => {
                  if subpath.is_empty() {
                    return Some(alias);
                  } else {
                    return Some(Cow::Owned(AliasValue::Specifier(Specifier::Absolute(
                      Cow::Owned(path.join(subpath.as_ref())),
                    ))));
                  }
                }
                Specifier::Tilde(path) => {
                  if subpath.is_empty() {
                    return Some(alias);
                  } else {
                    return Some(Cow::Owned(AliasValue::Specifier(Specifier::Tilde(
                      Cow::Owned(path.join(subpath.as_ref())),
                    ))));
                  }
                }
                _ => return Some(alias),
              }
            }
            _ => return Some(alias),
          };
        }
      }
      _ => {}
    }

    None
  }

  fn lookup_alias(
    &self,
    map: &'a IndexMap<Specifier<'a>, AliasValue<'a>>,
    specifier: &Specifier<'a>,
  ) -> Option<Cow<'_, AliasValue>> {
    if let Some(value) = map.get(specifier) {
      return Some(Cow::Borrowed(value));
    }

    // Match glob aliases.
    for (key, value) in map {
      let (glob, path) = match (key, specifier) {
        (Specifier::Relative(glob), Specifier::Relative(path))
        | (Specifier::Absolute(glob), Specifier::Absolute(path))
        | (Specifier::Tilde(glob), Specifier::Tilde(path)) => {
          (glob.as_os_str().to_str()?, path.as_os_str().to_str()?)
        }
        (Specifier::Package(module_a, glob), Specifier::Package(module_b, path))
          if module_a == module_b =>
        {
          (glob.as_ref(), path.as_ref())
        }
        _ => continue,
      };

      if let Some(captures) = glob_match_with_captures(glob, path) {
        let res = match value {
          AliasValue::Specifier(specifier) => AliasValue::Specifier(match specifier {
            Specifier::Relative(r) => {
              Specifier::Relative(replace_path_captures(r, path, &captures)?)
            }
            Specifier::Absolute(r) => {
              Specifier::Absolute(replace_path_captures(r, path, &captures)?)
            }
            Specifier::Tilde(r) => Specifier::Tilde(replace_path_captures(r, path, &captures)?),
            Specifier::Package(module, subpath) => {
              Specifier::Package(module.clone(), replace_captures(subpath, path, &captures))
            }
            _ => return Some(Cow::Borrowed(value)),
          }),
          _ => return Some(Cow::Borrowed(value)),
        };

        return Some(Cow::Owned(res));
      }
    }

    None
  }

  pub fn has_side_effects(&self, path: &Path) -> bool {
    let path = path
      .strip_prefix(self.path.parent().unwrap())
      .ok()
      .and_then(|path| path.as_os_str().to_str());

    let path = match path {
      Some(p) => p,
      None => return true,
    };

    fn side_effects_glob_matches(glob: &str, path: &str) -> bool {
      // Trim leading "./"
      let glob = if glob.starts_with("./") {
        &glob[2..]
      } else {
        &glob
      };

      // If the glob does not contain any '/' characters, prefix with "**/" to match webpack.
      let glob = if !glob.contains('/') {
        Cow::Owned(format!("**/{}", glob))
      } else {
        Cow::Borrowed(glob)
      };

      glob_match(glob.as_ref(), path)
    }

    match &self.side_effects {
      SideEffects::None => true,
      SideEffects::Boolean(b) => *b,
      SideEffects::String(glob) => side_effects_glob_matches(glob, path),
      SideEffects::Array(globs) => globs
        .iter()
        .any(|glob| side_effects_glob_matches(glob, path)),
    }
  }
}

fn replace_path_captures<'a>(
  s: &'a Path,
  path: &str,
  captures: &Vec<Range<usize>>,
) -> Option<Cow<'a, Path>> {
  Some(
    match replace_captures(s.as_os_str().to_str()?, path, &captures) {
      Cow::Borrowed(b) => Cow::Borrowed(Path::new(b)),
      Cow::Owned(b) => Cow::Owned(PathBuf::from(b)),
    },
  )
}

/// Inserts captures matched in a glob against `path` using a pattern string.
/// Replacements are inserted using JS-like $N syntax, e.g. $1 for the first capture.
fn replace_captures<'a>(s: &'a str, path: &str, captures: &Vec<Range<usize>>) -> Cow<'a, str> {
  let mut res = Cow::Borrowed(s);
  let bytes = s.as_bytes();
  for (idx, _) in s.match_indices('$').rev() {
    let mut end = idx;
    while end + 1 < bytes.len() && bytes[end + 1].is_ascii_digit() {
      end += 1;
    }

    if end != idx {
      if let Ok(capture_index) = s[idx + 1..end + 1].parse::<usize>() {
        if capture_index > 0 && capture_index - 1 < captures.len() {
          res
            .to_mut()
            .replace_range(idx..end + 1, &path[captures[capture_index - 1].clone()]);
        }
      }
    }
  }

  res
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
  type Item = (PathBuf, Fields);

  fn next(&mut self) -> Option<Self::Item> {
    if self.fields.contains(Fields::SOURCE) {
      self.fields.remove(Fields::SOURCE);
      match &self.package.source {
        SourceField::None | SourceField::Array(_) => {}
        SourceField::String(source) => {
          return Some((self.package.path.with_file_name(source), Fields::SOURCE))
        }
        SourceField::Map(map) => match map.get(&Specifier::Package(
          Cow::Borrowed(self.package.name),
          Cow::Borrowed(""),
        )) {
          Some(AliasValue::Specifier(s)) => match s {
            Specifier::Relative(s) => {
              return Some((self.package.path.with_file_name(s.as_ref()), Fields::SOURCE))
            }
            _ => {}
          },
          _ => {}
        },
      }
    }

    if self.fields.contains(Fields::BROWSER) {
      self.fields.remove(Fields::BROWSER);
      match &self.package.browser {
        BrowserField::None => {}
        BrowserField::String(browser) => {
          return Some((self.package.path.with_file_name(browser), Fields::BROWSER))
        }
        BrowserField::Map(map) => match map.get(&Specifier::Package(
          Cow::Borrowed(self.package.name),
          Cow::Borrowed(""),
        )) {
          Some(AliasValue::Specifier(s)) => match s {
            Specifier::Relative(s) => {
              return Some((self.package.path.with_file_name(s.as_ref()), Fields::SOURCE))
            }
            _ => {}
          },
          _ => {}
        },
      }
    }

    if self.fields.contains(Fields::MODULE) {
      self.fields.remove(Fields::MODULE);
      if let Some(module) = self.package.module {
        return Some((self.package.path.with_file_name(module), Fields::MODULE));
      }
    }

    if self.fields.contains(Fields::MAIN) {
      self.fields.remove(Fields::MAIN);
      if let Some(main) = self.package.main {
        return Some((self.package.path.with_file_name(main), Fields::MAIN));
      }
    }

    if self.fields.contains(Fields::TSCONFIG) {
      self.fields.remove(Fields::TSCONFIG);
      if let Some(tsconfig) = self.package.tsconfig {
        return Some((self.package.path.with_file_name(tsconfig), Fields::TSCONFIG));
      }
    }

    None
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use indexmap::indexmap;

  // Based on https://github.com/lukeed/resolve.exports/blob/master/test/resolve.js

  #[test]
  fn exports_string() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      exports: ExportsField::String("./exports.js"),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_package_exports("", &[]).unwrap(),
      PathBuf::from("/foo/exports.js")
    );
    // assert_eq!(pkg.resolve_package_exports("./exports.js", &[]).unwrap(), PathBuf::from("/foo/exports.js"));
    // assert_eq!(pkg.resolve_package_exports("foobar", &[]).unwrap(), PathBuf::from("/foo/exports.js"));
  }

  #[test]
  fn exports_dot() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        ".".into() => ExportsField::String("./exports.js")
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_package_exports("", &[]).unwrap(),
      PathBuf::from("/foo/exports.js")
    );
    // assert_eq!(pkg.resolve_package_exports("foobar", &[]).unwrap(), PathBuf::from("/foo/exports.js"));
  }

  #[test]
  fn exports_dot_conditions() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        ".".into() => ExportsField::Map(indexmap! {
          "import".into() => ExportsField::String("./import.js"),
          "require".into() => ExportsField::String("./require.js")
        })
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg
        .resolve_package_exports("", &["import", "require"])
        .unwrap(),
      PathBuf::from("/foo/import.js")
    );
    assert_eq!(
      pkg.resolve_package_exports("", &["require"]).unwrap(),
      PathBuf::from("/foo/require.js")
    );
  }

  #[test]
  fn exports_map_string() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "./foo".into() => ExportsField::String("./exports.js")
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_package_exports("foo", &[]).unwrap(),
      PathBuf::from("/foo/exports.js")
    );
  }

  #[test]
  fn exports_map_conditions() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "./foo".into() => ExportsField::Map(indexmap! {
          "import".into() => ExportsField::String("./import.js"),
          "require".into() => ExportsField::String("./require.js")
        })
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg
        .resolve_package_exports("foo", &["import", "require"])
        .unwrap(),
      PathBuf::from("/foo/import.js")
    );
    assert_eq!(
      pkg.resolve_package_exports("foo", &["require"]).unwrap(),
      PathBuf::from("/foo/require.js")
    );
  }

  #[test]
  fn nested_conditions() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "node".into() => ExportsField::Map(indexmap! {
          "import".into() => ExportsField::String("./import.js"),
          "require".into() => ExportsField::String("./require.js")
        }),
        "default".into() => ExportsField::String("./default.js")
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg
        .resolve_package_exports("", &["node", "import"])
        .unwrap(),
      PathBuf::from("/foo/import.js")
    );
    assert_eq!(
      pkg
        .resolve_package_exports("", &["node", "require"])
        .unwrap(),
      PathBuf::from("/foo/require.js")
    );
    assert_eq!(
      pkg.resolve_package_exports("", &["import"]).unwrap(),
      PathBuf::from("/foo/default.js")
    );
  }

  #[test]
  fn subpath_nested_conditions() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "./lite".into() => ExportsField::Map(indexmap! {
          "node".into() => ExportsField::Map(indexmap! {
            "import".into() => ExportsField::String("./node_import.js"),
            "require".into() => ExportsField::String("./node_require.js")
          }),
          "browser".into() => ExportsField::Map(indexmap! {
            "import".into() => ExportsField::String("./browser_import.js"),
            "require".into() => ExportsField::String("./browser_require.js")
          }),
        })
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg
        .resolve_package_exports("lite", &["node", "import"])
        .unwrap(),
      PathBuf::from("/foo/node_import.js")
    );
    assert_eq!(
      pkg
        .resolve_package_exports("lite", &["node", "require"])
        .unwrap(),
      PathBuf::from("/foo/node_require.js")
    );
    assert_eq!(
      pkg
        .resolve_package_exports("lite", &["browser", "import"])
        .unwrap(),
      PathBuf::from("/foo/browser_import.js")
    );
    assert_eq!(
      pkg
        .resolve_package_exports("lite", &["browser", "require"])
        .unwrap(),
      PathBuf::from("/foo/browser_require.js")
    );
  }

  #[test]
  fn subpath_star() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "./*".into() => ExportsField::String("./cheese/*.mjs"),
        "./pizza/*".into() => ExportsField::String("./pizza/*.mjs"),
        "./burritos/*".into() => ExportsField::String("./burritos/*/*.mjs")
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_package_exports("hello", &[]).unwrap(),
      PathBuf::from("/foo/cheese/hello.mjs")
    );
    assert_eq!(
      pkg.resolve_package_exports("hello/world", &[]).unwrap(),
      PathBuf::from("/foo/cheese/hello/world.mjs")
    );
    assert_eq!(
      pkg.resolve_package_exports("hello.js", &[]).unwrap(),
      PathBuf::from("/foo/cheese/hello.js.mjs")
    );
    assert_eq!(
      pkg.resolve_package_exports("pizza/test", &[]).unwrap(),
      PathBuf::from("/foo/pizza/test.mjs")
    );
    assert_eq!(
      pkg.resolve_package_exports("burritos/test", &[]).unwrap(),
      PathBuf::from("/foo/burritos/test/test.mjs")
    );
  }

  #[test]
  fn exports_null() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "./features/*.js".into() => ExportsField::String("./src/features/*.js"),
        "./features/private-internal/*".into() => ExportsField::None,
      }),
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_package_exports("features/foo.js", &[]).unwrap(),
      PathBuf::from("/foo/src/features/foo.js")
    );
    assert_eq!(
      pkg
        .resolve_package_exports("features/foo/bar.js", &[])
        .unwrap(),
      PathBuf::from("/foo/src/features/foo/bar.js")
    );
    assert!(matches!(
      pkg.resolve_package_exports("features/private-internal/foo.js", &[]),
      Err(PackageJsonError::PackagePathNotExported)
    ),);
  }

  #[test]
  fn exports_array() {}

  #[test]
  fn exports_invalid() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      exports: ExportsField::Map(indexmap! {
        "./invalid".into() => ExportsField::String("../invalid"),
        "./absolute".into() => ExportsField::String("/absolute"),
        "./package".into() => ExportsField::String("package"),
      }),
      ..PackageJson::default()
    };

    assert!(matches!(
      pkg.resolve_package_exports("invalid", &[]),
      Err(PackageJsonError::InvalidPackageTarget)
    ),);
    assert!(matches!(
      pkg.resolve_package_exports("absolute", &[]),
      Err(PackageJsonError::InvalidPackageTarget)
    ),);
    assert!(matches!(
      pkg.resolve_package_exports("package", &[]),
      Err(PackageJsonError::InvalidPackageTarget)
    ),);
  }

  #[test]
  fn imports() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      imports: indexmap! {
        "#foo".into() => ExportsField::String("./foo.mjs"),
        "#internal/*".into() => ExportsField::String("./src/internal/*.mjs"),
        "#bar".into() => ExportsField::String("bar")
      },
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_package_imports("foo", &[]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/foo.mjs"))
    );
    assert_eq!(
      pkg.resolve_package_imports("internal/foo", &[]).unwrap(),
      ExportsResolution::Path(PathBuf::from("/foo/src/internal/foo.mjs"))
    );
    assert_eq!(
      pkg.resolve_package_imports("bar", &[]).unwrap(),
      ExportsResolution::Package("bar".into())
    );
  }

  #[test]
  fn aliases() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      alias: indexmap! {
        "./foo.js".into() => AliasValue::Specifier("./foo-alias.js".into()),
        "bar".into()  => AliasValue::Specifier("./bar-alias.js".into()),
        "lodash".into()  => AliasValue::Specifier("my-lodash".into()),
        "lodash/clone".into()  => AliasValue::Specifier("./clone.js".into()),
        "test".into() => AliasValue::Specifier("./test".into()),
        "foo/*".into() => AliasValue::Specifier("bar/$1".into()),
        "./foo/src/**".into() => AliasValue::Specifier("./foo/lib/$1".into()),
        "/foo/src/**".into() => AliasValue::Specifier("/foo/lib/$1".into()),
        "~/foo/src/**".into() => AliasValue::Specifier("~/foo/lib/$1".into()),
      },
      ..PackageJson::default()
    };

    assert_eq!(
      pkg.resolve_aliases(&"./foo.js".into(), Fields::ALIAS),
      Some(Cow::Owned(AliasValue::Specifier("./foo-alias.js".into())))
    );
    assert_eq!(
      pkg.resolve_aliases(&"bar".into(), Fields::ALIAS),
      Some(Cow::Owned(AliasValue::Specifier("./bar-alias.js".into())))
    );
    assert_eq!(
      pkg.resolve_aliases(&"lodash".into(), Fields::ALIAS),
      Some(Cow::Owned(AliasValue::Specifier("my-lodash".into())))
    );
    assert_eq!(
      pkg.resolve_aliases(&"lodash/foo".into(), Fields::ALIAS),
      Some(Cow::Owned(AliasValue::Specifier("my-lodash/foo".into())))
    );
    assert_eq!(
      pkg.resolve_aliases(&"lodash/clone".into(), Fields::ALIAS),
      Some(Cow::Owned(AliasValue::Specifier("./clone.js".into())))
    );
    assert_eq!(
      pkg.resolve_aliases(&"test".into(), Fields::ALIAS),
      Some(Cow::Owned(AliasValue::Specifier("./test".into())))
    );
    assert_eq!(
      pkg.resolve_aliases(&"test/foo".into(), Fields::ALIAS),
      Some(Cow::Owned(AliasValue::Specifier("./test/foo".into())))
    );
    assert_eq!(
      pkg.resolve_aliases(&"foo/hi".into(), Fields::ALIAS),
      Some(Cow::Owned(AliasValue::Specifier("bar/hi".into())))
    );
    assert_eq!(
      pkg.resolve_aliases(&"./foo/src/a/b".into(), Fields::ALIAS),
      Some(Cow::Owned(AliasValue::Specifier("./foo/lib/a/b".into())))
    );
    assert_eq!(
      pkg.resolve_aliases(&"/foo/src/a/b".into(), Fields::ALIAS),
      Some(Cow::Owned(AliasValue::Specifier("/foo/lib/a/b".into())))
    );
    assert_eq!(
      pkg.resolve_aliases(&"~/foo/src/a/b".into(), Fields::ALIAS),
      Some(Cow::Owned(AliasValue::Specifier("~/foo/lib/a/b".into())))
    );
  }

  #[test]
  fn test_replace_captures() {
    assert_eq!(
      replace_captures("test/$1/$2", "foo/bar/baz", &vec![4..7, 8..11]),
      Cow::Borrowed("test/bar/baz")
    );
    assert_eq!(
      replace_captures("test/$1/$2", "foo/bar/baz", &vec![4..7]),
      Cow::Borrowed("test/bar/$2")
    );
    assert_eq!(
      replace_captures("test/$1/$2/$3", "foo/bar/baz", &vec![4..7, 8..11]),
      Cow::Borrowed("test/bar/baz/$3")
    );
    assert_eq!(
      replace_captures("test/$1/$2/$", "foo/bar/baz", &vec![4..7, 8..11]),
      Cow::Borrowed("test/bar/baz/$")
    );
    assert_eq!(
      replace_captures("te$st/$1/$2", "foo/bar/baz", &vec![4..7, 8..11]),
      Cow::Borrowed("te$st/bar/baz")
    );
  }

  #[test]
  fn side_effects_none() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      ..PackageJson::default()
    };

    assert!(pkg.has_side_effects(Path::new("/foo/index.js")));
    assert!(pkg.has_side_effects(Path::new("/foo/bar/index.js")));
    assert!(pkg.has_side_effects(Path::new("/index.js")));
  }

  #[test]
  fn side_effects_bool() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      side_effects: SideEffects::Boolean(false),
      ..PackageJson::default()
    };

    assert!(!pkg.has_side_effects(Path::new("/foo/index.js")));
    assert!(!pkg.has_side_effects(Path::new("/foo/bar/index.js")));
    assert!(pkg.has_side_effects(Path::new("/index.js")));

    let pkg = PackageJson {
      side_effects: SideEffects::Boolean(true),
      ..pkg
    };

    assert!(pkg.has_side_effects(Path::new("/foo/index.js")));
    assert!(pkg.has_side_effects(Path::new("/foo/bar/index.js")));
    assert!(pkg.has_side_effects(Path::new("/index.js")));
  }

  #[test]
  fn side_effects_glob() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      side_effects: SideEffects::String("*.css"),
      ..PackageJson::default()
    };

    assert!(pkg.has_side_effects(Path::new("/foo/a.css")));
    assert!(pkg.has_side_effects(Path::new("/foo/bar/baz.css")));
    assert!(pkg.has_side_effects(Path::new("/foo/bar/x/baz.css")));
    assert!(!pkg.has_side_effects(Path::new("/foo/a.js")));
    assert!(!pkg.has_side_effects(Path::new("/foo/bar/baz.js")));
    assert!(pkg.has_side_effects(Path::new("/index.js")));

    let pkg = PackageJson {
      side_effects: SideEffects::String("bar/*.css"),
      ..pkg
    };

    assert!(!pkg.has_side_effects(Path::new("/foo/a.css")));
    assert!(pkg.has_side_effects(Path::new("/foo/bar/baz.css")));
    assert!(!pkg.has_side_effects(Path::new("/foo/bar/x/baz.css")));
    assert!(!pkg.has_side_effects(Path::new("/foo/a.js")));
    assert!(!pkg.has_side_effects(Path::new("/foo/bar/baz.js")));
    assert!(pkg.has_side_effects(Path::new("/index.js")));

    let pkg = PackageJson {
      side_effects: SideEffects::String("./bar/*.css"),
      ..pkg
    };

    assert!(!pkg.has_side_effects(Path::new("/foo/a.css")));
    assert!(pkg.has_side_effects(Path::new("/foo/bar/baz.css")));
    assert!(!pkg.has_side_effects(Path::new("/foo/bar/x/baz.css")));
    assert!(!pkg.has_side_effects(Path::new("/foo/a.js")));
    assert!(!pkg.has_side_effects(Path::new("/foo/bar/baz.js")));
    assert!(pkg.has_side_effects(Path::new("/index.js")));
  }

  #[test]
  fn side_effects_array() {
    let pkg = PackageJson {
      path: "/foo/package.json".into(),
      name: "foobar",
      side_effects: SideEffects::Array(vec!["*.css", "*.html"]),
      ..PackageJson::default()
    };

    assert!(pkg.has_side_effects(Path::new("/foo/a.css")));
    assert!(pkg.has_side_effects(Path::new("/foo/bar/baz.css")));
    assert!(pkg.has_side_effects(Path::new("/foo/bar/x/baz.css")));
    assert!(pkg.has_side_effects(Path::new("/foo/a.html")));
    assert!(pkg.has_side_effects(Path::new("/foo/bar/baz.html")));
    assert!(pkg.has_side_effects(Path::new("/foo/bar/x/baz.html")));
    assert!(!pkg.has_side_effects(Path::new("/foo/a.js")));
    assert!(!pkg.has_side_effects(Path::new("/foo/bar/baz.js")));
    assert!(pkg.has_side_effects(Path::new("/index.js")));
  }
}
