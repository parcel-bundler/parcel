use std::borrow::Cow;
use std::path::Path;
use std::path::PathBuf;

use indexmap::IndexMap;
use itertools::Either;
use json_comments::strip_comments_in_place;

use super::path::resolve_path;
use super::specifier::Specifier;

#[derive(serde::Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TsConfig<'a> {
  #[serde(skip)]
  pub path: PathBuf,
  base_url: Option<Cow<'a, Path>>,
  #[serde(borrow)]
  paths: Option<IndexMap<Specifier<'a>, Vec<&'a str>>>,
  #[serde(skip)]
  paths_base: PathBuf,
  pub module_suffixes: Option<Vec<&'a str>>,
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
#[serde(rename_all = "camelCase")]
pub struct TsConfigWrapper<'a> {
  #[serde(borrow, default, deserialize_with = "deserialize_extends")]
  pub extends: Vec<Specifier<'a>>,
  #[serde(default)]
  pub compiler_options: TsConfig<'a>,
}

impl<'a> TsConfig<'a> {
  pub fn parse(path: PathBuf, data: &'a mut str) -> serde_json::Result<TsConfigWrapper<'a>> {
    let _ = strip_comments_in_place(data, Default::default(), true);
    let mut wrapper: TsConfigWrapper = serde_json::from_str(data)?;
    wrapper.compiler_options.path = path;
    wrapper.compiler_options.validate();
    Ok(wrapper)
  }

  fn validate(&mut self) {
    if let Some(base_url) = &mut self.base_url {
      *base_url = Cow::Owned(resolve_path(&self.path, &base_url));
    }

    if self.paths.is_some() {
      self.paths_base = if let Some(base_url) = &self.base_url {
        base_url.as_ref().to_owned()
      } else {
        self.path.parent().unwrap().to_owned()
      };
    }
  }

  pub fn extend(&mut self, extended: &TsConfig<'a>) {
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

  pub fn paths(&'a self, specifier: &'a Specifier) -> impl Iterator<Item = PathBuf> + 'a {
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
  paths: &'a [&'a str],
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
      path.push(module.as_ref());
      path.push(subpath.as_ref());
    }
    path
  })
}

#[cfg(test)]
mod tests {
  use indexmap::indexmap;

  use super::*;

  #[test]
  fn test_paths() {
    let mut tsconfig = TsConfig {
      path: "/foo/tsconfig.json".into(),
      paths: Some(indexmap! {
        "jquery".into() => vec!["node_modules/jquery/dist/jquery"],
        "*".into() => vec!["generated/*"],
        "bar/*".into() => vec!["test/*"],
        "bar/baz/*".into() => vec!["baz/*", "yo/*"],
        "@/components/*".into() => vec!["components/*"],
        "url".into() => vec!["node_modules/my-url"],
      }),
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
      paths: Some(indexmap! {
        "*".into() => vec!["generated/*"],
        "bar/*".into() => vec!["test/*"],
        "bar/baz/*".into() => vec!["baz/*", "yo/*"],
        "@/components/*".into() => vec!["components/*"],
      }),
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
}
