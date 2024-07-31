use std::borrow::Cow;
use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;

use crate::path::resolve_path;
use crate::specifier::Specifier;
use itertools::Either;
use json_comments::StripComments;

#[derive(serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TsConfig {
  #[serde(skip)]
  pub path: PathBuf,
  base_url: Option<PathBuf>,
  paths: Option<HashMap<Specifier, Vec<String>>>,
  #[serde(skip)]
  paths_base: PathBuf,
  pub module_suffixes: Option<Vec<String>>,
  // rootDirs??
}

fn deserialize_extends<'a, 'de: 'a, D>(deserializer: D) -> Result<Vec<Specifier>, D::Error>
where
  D: serde::Deserializer<'de>,
{
  use serde::Deserialize;

  #[derive(serde::Deserialize)]
  #[serde(untagged)]
  enum StringOrArray {
    String(Specifier),
    Array(Vec<Specifier>),
  }

  Ok(match StringOrArray::deserialize(deserializer)? {
    StringOrArray::String(s) => vec![s],
    StringOrArray::Array(a) => a,
  })
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TsConfigWrapper {
  #[serde(default, deserialize_with = "deserialize_extends")]
  pub extends: Vec<Specifier>,
  #[serde(default)]
  pub compiler_options: TsConfig,
}

impl TsConfig {
  pub fn parse(path: PathBuf, data: &str) -> serde_json5::Result<TsConfigWrapper> {
    let stripped = StripComments::new(data.as_bytes());
    let mut wrapper: TsConfigWrapper = serde_json5::from_reader(stripped)?;
    wrapper.compiler_options.path = path;
    wrapper.compiler_options.validate();
    Ok(wrapper)
  }

  fn validate(&mut self) {
    if let Some(base_url) = &mut self.base_url {
      *base_url = resolve_path(&self.path, &base_url);
    }

    if self.paths.is_some() {
      self.paths_base = if let Some(base_url) = &self.base_url {
        base_url.to_owned()
      } else {
        self.path.parent().unwrap().to_owned()
      };
    }
  }

  pub fn extend(&mut self, extended: &TsConfig) {
    if self.base_url.is_none() {
      self.base_url = extended.base_url.clone();
    }

    if self.paths.is_none() {
      self.paths_base = extended.paths_base.clone();
      self.paths = extended.paths.clone();
    }

    if self.module_suffixes.is_none() {
      self.module_suffixes = extended.module_suffixes.clone();
    }
  }

  pub fn paths<'a>(&'a self, specifier: &'a Specifier) -> impl Iterator<Item = PathBuf> + 'a {
    if !matches!(specifier, Specifier::Package(..) | Specifier::Builtin(..)) {
      return Either::Right(Either::Right(std::iter::empty()));
    }

    // If there is a base url setting, resolve it relative to the tsconfig.json file.
    // Otherwise, the base for paths is implicitly the directory containing the tsconfig.
    let base_url_iter = if let Some(base_url) = &self.base_url {
      Either::Left(base_url_iter(base_url, specifier))
    } else {
      Either::Right(std::iter::empty())
    };

    if let Some(paths) = &self.paths {
      // Check exact match first.
      if let Some(paths) = paths.get(specifier) {
        return Either::Left(join_paths(&self.paths_base, paths, None).chain(base_url_iter));
      }

      // Check patterns
      let mut longest_prefix_length = 0;
      let mut longest_suffix_length = 0;
      let mut best_key = None;
      let full_specifier = specifier.to_string();

      for key in paths.keys() {
        let path = key.to_string();
        if let Some((prefix, suffix)) = path.split_once('*') {
          if (best_key.is_none() || prefix.len() > longest_prefix_length)
            && full_specifier.starts_with(prefix)
            && full_specifier.ends_with(suffix)
          {
            longest_prefix_length = prefix.len();
            longest_suffix_length = suffix.len();
            best_key = Some(key);
          }
        }
      }

      if let Some(key) = best_key {
        let paths = paths.get(key).unwrap();
        return Either::Left(
          join_paths(
            &self.paths_base,
            paths,
            Some((full_specifier, longest_prefix_length, longest_suffix_length)),
          )
          .chain(base_url_iter),
        );
      }
    }

    if matches!(specifier, Specifier::Builtin(..)) {
      // If specifier is a builtin then there's no match
      return Either::Right(Either::Right(std::iter::empty()));
    }

    // If no paths were found, try relative to the base url.
    Either::Right(base_url_iter)
  }
}

fn join_paths<'a>(
  base_url: &'a Path,
  paths: &'a [String],
  replacement: Option<(Cow<'a, str>, usize, usize)>,
) -> impl Iterator<Item = PathBuf> + 'a {
  paths
    .iter()
    .filter(|p| !p.ends_with(".d.ts"))
    .map(move |path| {
      if let Some((replacement, start, end)) = &replacement {
        let path = path.replace('*', &replacement[*start..replacement.len() - *end]);
        base_url.join(path)
      } else {
        base_url.join(path)
      }
    })
}

fn base_url_iter<'a>(
  base_url: &'a Path,
  specifier: &'a Specifier,
) -> impl Iterator<Item = PathBuf> + 'a {
  std::iter::once_with(move || {
    let mut path = base_url.to_owned();
    if let Specifier::Package(module, subpath) = specifier {
      path.push(module.as_str());
      path.push(subpath.as_str());
    }
    path
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_paths() {
    let mut tsconfig = TsConfig {
      path: "/foo/tsconfig.json".into(),
      paths: Some(HashMap::from([
        (
          "jquery".into(),
          vec![String::from("node_modules/jquery/dist/jquery")],
        ),
        ("*".into(), vec![String::from("generated/*")]),
        ("bar/*".into(), vec![String::from("test/*")]),
        (
          "bar/baz/*".into(),
          vec![String::from("baz/*"), String::from("yo/*")],
        ),
        ("@/components/*".into(), vec![String::from("components/*")]),
        ("url".into(), vec![String::from("node_modules/my-url")]),
      ])),
      ..Default::default()
    };
    tsconfig.validate();

    let test = |specifier: &str| tsconfig.paths(&specifier.into()).collect::<Vec<PathBuf>>();

    assert_eq!(
      test("jquery"),
      vec![PathBuf::from("/foo/node_modules/jquery/dist/jquery")]
    );
    assert_eq!(test("test"), vec![PathBuf::from("/foo/generated/test")]);
    assert_eq!(
      test("test/hello"),
      vec![PathBuf::from("/foo/generated/test/hello")]
    );
    assert_eq!(test("bar/hi"), vec![PathBuf::from("/foo/test/hi")]);
    assert_eq!(
      test("bar/baz/hi"),
      vec![PathBuf::from("/foo/baz/hi"), PathBuf::from("/foo/yo/hi")]
    );
    assert_eq!(
      test("@/components/button"),
      vec![PathBuf::from("/foo/components/button")]
    );
    assert_eq!(test("./jquery"), Vec::<PathBuf>::new());
    assert_eq!(test("url"), vec![PathBuf::from("/foo/node_modules/my-url")]);
  }

  #[test]
  fn test_base_url() {
    let mut tsconfig = TsConfig {
      path: "/foo/tsconfig.json".into(),
      base_url: Some(Path::new("src").into()),
      ..Default::default()
    };
    tsconfig.validate();

    let test = |specifier: &str| tsconfig.paths(&specifier.into()).collect::<Vec<PathBuf>>();

    assert_eq!(test("foo"), vec![PathBuf::from("/foo/src/foo")]);
    assert_eq!(
      test("components/button"),
      vec![PathBuf::from("/foo/src/components/button")]
    );
    assert_eq!(test("./jquery"), Vec::<PathBuf>::new());
  }

  #[test]
  fn test_paths_and_base_url() {
    let mut tsconfig = TsConfig {
      path: "/foo/tsconfig.json".into(),
      base_url: Some(Path::new("src").into()),
      paths: Some(HashMap::from([
        ("*".into(), vec![String::from("generated/*")]),
        ("bar/*".into(), vec![String::from("test/*")]),
        (
          "bar/baz/*".into(),
          vec![String::from("baz/*"), String::from("yo/*")],
        ),
        ("@/components/*".into(), vec![String::from("components/*")]),
      ])),
      ..Default::default()
    };
    tsconfig.validate();

    let test = |specifier: &str| tsconfig.paths(&specifier.into()).collect::<Vec<PathBuf>>();

    assert_eq!(
      test("test"),
      vec![
        PathBuf::from("/foo/src/generated/test"),
        PathBuf::from("/foo/src/test")
      ]
    );
    assert_eq!(
      test("test/hello"),
      vec![
        PathBuf::from("/foo/src/generated/test/hello"),
        PathBuf::from("/foo/src/test/hello")
      ]
    );
    assert_eq!(
      test("bar/hi"),
      vec![
        PathBuf::from("/foo/src/test/hi"),
        PathBuf::from("/foo/src/bar/hi")
      ]
    );
    assert_eq!(
      test("bar/baz/hi"),
      vec![
        PathBuf::from("/foo/src/baz/hi"),
        PathBuf::from("/foo/src/yo/hi"),
        PathBuf::from("/foo/src/bar/baz/hi")
      ]
    );
    assert_eq!(
      test("@/components/button"),
      vec![
        PathBuf::from("/foo/src/components/button"),
        PathBuf::from("/foo/src/@/components/button")
      ]
    );
    assert_eq!(test("./jquery"), Vec::<PathBuf>::new());
  }

  #[test]
  fn test_deserialize() {
    let config = r#"
{
  "compilerOptions": {
    "paths": {
      /* some comment */
      "foo": ["bar.js"]
    }
  }
  // another comment
}
    "#;
    let result: TsConfigWrapper = TsConfig::parse(PathBuf::from("stub.json"), config).unwrap();
    assert_eq!(result.extends, vec![]);
    assert!(result.compiler_options.paths.is_some());
    assert_eq!(
      result
        .compiler_options
        .paths
        .unwrap()
        .get(&Specifier::from("foo")),
      Some(&vec![String::from("bar.js")])
    );
  }
}
