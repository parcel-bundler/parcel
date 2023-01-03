use std::{
  borrow::Cow,
  path::{Path, PathBuf},
};

use indexmap::IndexMap;
use itertools::Either;

use crate::specifier::{self, Specifier};

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TsConfig<'a> {
  #[serde(skip, default = "empty_path")]
  pub path: &'a Path,
  #[serde(borrow)]
  extends: Option<Cow<'a, Path>>,
  base_url: Option<&'a Path>,
  #[serde(default)]
  paths: IndexMap<Specifier<'a>, Vec<&'a str>>,
  #[serde(default)]
  module_suffixes: Vec<&'a str>,
  // rootDirs??
}

impl<'a> Default for TsConfig<'a> {
  fn default() -> Self {
    TsConfig {
      path: empty_path(),
      extends: None,
      base_url: None,
      paths: Default::default(),
      module_suffixes: Default::default(),
    }
  }
}

fn empty_path() -> &'static Path {
  Path::new("")
}

impl<'a> TsConfig<'a> {
  pub fn parse(path: &'a Path, data: &'a str) -> serde_json::Result<TsConfig<'a>> {
    let mut parsed: TsConfig = serde_json::from_str(data)?;
    parsed.path = path;

    if let Some(extends) = &parsed.extends {
      // TypeScript allows "." and ".." to implicitly refer to a tsconfig.json file.
      if extends == Path::new(".") || extends == Path::new("..") {
        parsed.extends = Some(Cow::Owned(extends.join("tsconfig.json")))
      }

      // This needs to be resolved like a node module...
      // node_modules/{extends}/tsconfig.json
      // node_modules/{extends}
      // node_modules/{extends}.json

      // If relative:
      // tsconfig_dir/{extends}
    }

    // TODO: validate?
    Ok(parsed)
  }

  pub fn resolve(&'a self, specifier: &'a Specifier) -> impl Iterator<Item = PathBuf> + 'a {
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

    // Check exact match first.
    if let Some(paths) = self.paths.get(specifier) {
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

    for key in self.paths.keys() {
      if let Specifier::Package(module, subpath) = key {
        let path = concat_specifier(module, subpath);
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
      let paths = self.paths.get(key).unwrap();
      return Either::Left(
        join_paths(
          path_base,
          paths,
          Some((full_specifier, longest_prefix_length, longest_suffix_length)),
        )
        .chain(base_url_iter),
      );
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
  paths: &'a Vec<&'a str>,
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
      path: Path::new("/foo/tsconfig.json"),
      paths: indexmap! {
        "jquery".into() => vec!["node_modules/jquery/dist/jquery"],
        "*".into() => vec!["generated/*"],
        "bar/*".into() => vec!["test/*"],
        "bar/baz/*".into() => vec!["baz/*", "yo/*"],
        "@/components/*".into() => vec!["components/*"],
      },
      ..Default::default()
    };

    let test = |specifier: &str| {
      tsconfig
        .resolve(&specifier.into())
        .collect::<Vec<PathBuf>>()
    };

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
      path: Path::new("/foo/tsconfig.json"),
      base_url: Some(Path::new("src")),
      ..Default::default()
    };

    let test = |specifier: &str| {
      tsconfig
        .resolve(&specifier.into())
        .collect::<Vec<PathBuf>>()
    };

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
      path: Path::new("/foo/tsconfig.json"),
      base_url: Some(Path::new("src")),
      paths: indexmap! {
        "*".into() => vec!["generated/*"],
        "bar/*".into() => vec!["test/*"],
        "bar/baz/*".into() => vec!["baz/*", "yo/*"],
        "@/components/*".into() => vec!["components/*"],
      },
      ..Default::default()
    };

    let test = |specifier: &str| {
      tsconfig
        .resolve(&specifier.into())
        .collect::<Vec<PathBuf>>()
    };

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
