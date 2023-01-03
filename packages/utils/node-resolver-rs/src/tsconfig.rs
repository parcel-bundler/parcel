use std::{
  borrow::Cow,
  path::{Path, PathBuf},
};

use indexmap::IndexMap;
use itertools::Either;
use json_comments::StripComments;

use crate::specifier::{self, Specifier};

#[derive(serde::Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TsConfig {
  #[serde(skip)]
  pub path: PathBuf,
  #[serde(deserialize_with = "deserialize_extends")]
  pub extends: Vec<Specifier<'static>>,
  base_url: Option<PathBuf>,
  #[serde(borrow)]
  paths: Option<IndexMap<Specifier<'static>, Vec<String>>>,
  module_suffixes: Option<Vec<String>>,
  // rootDirs??
}

fn deserialize_extends<'a, 'de: 'a, D>(deserializer: D) -> Result<Vec<Specifier<'a>>, D::Error>
where
  D: serde::Deserializer<'de>,
{
  use serde::Deserialize;

  #[derive(serde::Deserialize)]
  #[serde(untagged)]
  enum StringOrArray<'a> {
    #[serde(borrow)]
    String(Specifier<'a>),
    Array(Vec<Specifier<'a>>),
  }

  Ok(match StringOrArray::deserialize(deserializer)? {
    StringOrArray::String(s) => vec![s],
    StringOrArray::Array(a) => a,
  })
}

#[derive(serde::Deserialize, Debug)]
#[serde(
  rename_all = "camelCase",
  bound(deserialize = "TsConfig: serde::Deserialize<'de>")
)]
struct TsConfigWrapper {
  compiler_options: TsConfig,
}

impl TsConfig {
  pub fn parse(path: PathBuf, data: &str) -> serde_json::Result<TsConfig> {
    let stripped = StripComments::new(data.as_bytes());
    let wrapper: TsConfigWrapper = serde_json::from_reader(stripped).map(serde_detach::detach)?;
    let mut parsed = wrapper.compiler_options;
    parsed.path = path;

    // TODO: validate?
    Ok(parsed)
  }

  pub fn extend(&mut self, extended: TsConfig) {
    if self.base_url.is_none() {
      self.base_url = extended.base_url;
    }

    if self.paths.is_none() {
      self.paths = extended.paths;
    }

    if self.module_suffixes.is_none() {
      self.module_suffixes = extended.module_suffixes;
    }
  }

  pub fn paths<'a>(&'a self, specifier: &'a Specifier) -> impl Iterator<Item = PathBuf> + 'a {
    if !matches!(specifier, Specifier::Package(..)) {
      return Either::Right(Either::Right(std::iter::empty()));
    }

    // If there is a base url setting, resolve it relative to the tsconfig.json file.
    // Otherwise, the base for paths is implicitly the directory containing the tsconfig.
    let (path_base, base_url_iter) = if let Some(base_url) = &self.base_url {
      let base_url = self.path.with_file_name(base_url);
      (
        Cow::Owned(base_url.clone()),
        Either::Left(base_url_iter(base_url, specifier)),
      )
    } else {
      (
        Cow::Borrowed(self.path.parent().unwrap()),
        Either::Right(std::iter::empty()),
      )
    };

    if let Some(paths) = &self.paths {
      // Check exact match first.
      if let Some(paths) = paths.get(specifier) {
        return Either::Left(join_paths(path_base, paths, None).chain(base_url_iter));
      }

      // Check patterns
      let mut longest_prefix_length = 0;
      let mut longest_suffix_length = 0;
      let mut best_key = None;
      let full_specifier = if let Specifier::Package(module, subpath) = specifier {
        concat_specifier(module, subpath)
      } else {
        unreachable!()
      };

      for key in paths.keys() {
        if let Specifier::Package(module, subpath) = key {
          let path = concat_specifier(module.as_ref(), subpath.as_ref());
          if let Some((prefix, suffix)) = path.split_once('*') {
            if best_key.is_none()
              || prefix.len() > longest_prefix_length
                && full_specifier.starts_with(prefix)
                && full_specifier.ends_with(suffix)
            {
              longest_prefix_length = prefix.len();
              longest_suffix_length = suffix.len();
              best_key = Some(key);
            }
          }
        }
      }

      if let Some(key) = best_key {
        let paths = paths.get(key).unwrap();
        return Either::Left(
          join_paths(
            path_base,
            paths,
            Some((full_specifier, longest_prefix_length, longest_suffix_length)),
          )
          .chain(base_url_iter),
        );
      }
    }

    // If no paths were found, try relative to the base url.
    Either::Right(base_url_iter)
  }
}

fn concat_specifier<'a>(module: &'a str, subpath: &'a str) -> Cow<'a, str> {
  if subpath.is_empty() {
    Cow::Borrowed(module)
  } else {
    Cow::Owned(format!("{}/{}", module, subpath))
  }
}

fn join_paths<'a>(
  base_url: Cow<'a, Path>,
  paths: &'a Vec<String>,
  replacement: Option<(Cow<'a, str>, usize, usize)>,
) -> impl Iterator<Item = PathBuf> + 'a {
  paths
    .iter()
    .filter(|p| !p.ends_with(".d.ts"))
    .map(move |path| {
      if let Some((replacement, start, end)) = &replacement {
        let path = path.replace('*', &replacement[*start..replacement.len() - *end]);
        base_url.join(&path)
      } else {
        base_url.join(&path)
      }
    })
}

fn base_url_iter<'a>(
  base_url: PathBuf,
  specifier: &'a Specifier,
) -> impl Iterator<Item = PathBuf> + 'a {
  std::iter::once_with(move || {
    let mut path = base_url;
    if let Specifier::Package(module, subpath) = specifier {
      path.push(module.as_ref());
      path.push(subpath.as_ref());
    }
    path
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use indexmap::indexmap;

  #[test]
  fn test_paths() {
    let tsconfig = TsConfig {
      path: "/foo/tsconfig.json".into(),
      paths: Some(indexmap! {
        "jquery".into() => vec!["node_modules/jquery/dist/jquery".into()],
        "*".into() => vec!["generated/*".into()],
        "bar/*".into() => vec!["test/*".into()],
        "bar/baz/*".into() => vec!["baz/*".into(), "yo/*".into()],
        "@/components/*".into() => vec!["components/*".into()],
      }),
      ..Default::default()
    };

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
  }

  #[test]
  fn test_base_url() {
    let tsconfig = TsConfig {
      path: "/foo/tsconfig.json".into(),
      base_url: Some("src".into()),
      ..Default::default()
    };

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
    let tsconfig = TsConfig {
      path: "/foo/tsconfig.json".into(),
      base_url: Some("src".into()),
      paths: Some(indexmap! {
        "*".into() => vec!["generated/*".into()],
        "bar/*".into() => vec!["test/*".into()],
        "bar/baz/*".into() => vec!["baz/*".into(), "yo/*".into()],
        "@/components/*".into() => vec!["components/*".into()],
      }),
      ..Default::default()
    };

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
}
