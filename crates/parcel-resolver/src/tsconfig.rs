use std::{
  borrow::Cow,
  path::{Path, PathBuf},
};

use crate::json_comments_rs::strip_comments_in_place;
use indexmap::IndexMap;
use itertools::Either;
use parcel_core::{FileSystem, PathId};

use crate::{ResolverError, error::JsonError, specifier::Specifier};

#[derive(serde::Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct SerializedTsConfig {
  base_url: Option<PathBuf>,
  paths: Option<IndexMap<Specifier<'static>, Vec<String>>>,
  pub module_suffixes: Option<Vec<String>>,
  // rootDirs??
  pub jsx_factory: Option<String>,
  pub jsx_fragment_factory: Option<String>,
  pub jsx_import_source: Option<String>,
  pub jsx: Option<Jsx>,
  #[serde(default)]
  pub experimental_decorators: bool,
  pub use_define_for_class_fields: Option<bool>,
  #[serde(default)]
  pub target: Option<String>,
}

pub struct TsConfig {
  pub path: PathId,
  base_url: Option<PathId>,
  paths: Option<IndexMap<Specifier<'static>, Vec<String>>>,
  paths_base: PathId,
  pub module_suffixes: Option<Vec<String>>,
  pub jsx_factory: Option<String>,
  pub jsx_fragment_factory: Option<String>,
  pub jsx_import_source: Option<String>,
  pub jsx: Option<Jsx>,
  pub experimental_decorators: bool,
  pub use_define_for_class_fields: Option<bool>,
  pub target: Option<String>,
}

#[derive(serde::Deserialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum Jsx {
  React,
  ReactJsx,
  ReactJsxdev,
  Preserve,
  ReactNative,
}

fn deserialize_extends<'de, D>(deserializer: D) -> Result<Vec<Specifier<'static>>, D::Error>
where
  D: serde::Deserializer<'de>,
{
  use serde::Deserialize;

  #[derive(serde::Deserialize)]
  #[serde(untagged)]
  enum StringOrArray {
    String(Specifier<'static>),
    Array(Vec<Specifier<'static>>),
  }

  Ok(match StringOrArray::deserialize(deserializer)? {
    StringOrArray::String(s) => vec![s],
    StringOrArray::Array(a) => a,
  })
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SerializedTsConfigWrapper {
  #[serde(default, deserialize_with = "deserialize_extends")]
  pub extends: Vec<Specifier<'static>>,
  #[serde(default)]
  pub compiler_options: SerializedTsConfig,
}

pub struct TsConfigWrapper {
  pub extends: Vec<Specifier<'static>>,
  pub compiler_options: TsConfig,
}

impl TsConfig {
  pub fn read<F: FnOnce(&mut TsConfigWrapper) -> Result<(), ResolverError>>(
    path: &PathId,
    process: F,
    fs: &dyn FileSystem,
  ) -> Result<TsConfigWrapper, ResolverError> {
    let data = fs.read_to_string(*path)?;
    let mut tsconfig = TsConfig::parse(path.clone(), data)
      .map_err(|e| JsonError::new(path.to_path_buf().to_owned(), e))?;
    process(&mut tsconfig)?;
    Ok(tsconfig)
  }

  pub fn parse(path: PathId, mut data: String) -> serde_json::Result<TsConfigWrapper> {
    let _ = strip_comments_in_place(data.as_mut_str(), Default::default(), true);
    let wrapper: SerializedTsConfigWrapper = serde_json::from_str(&data)?;
    Ok(TsConfigWrapper {
      extends: wrapper.extends,
      compiler_options: TsConfig::from_serialized(path, wrapper.compiler_options),
    })
  }

  fn from_serialized(path: PathId, serialized: SerializedTsConfig) -> TsConfig {
    let base_url = serialized.base_url.map(|base_url| path.resolve(&base_url));

    TsConfig {
      paths_base: if serialized.paths.is_some() {
        base_url.clone().unwrap_or_else(|| path.parent().unwrap())
      } else {
        PathId::new(Path::new(""))
      },
      path: path,
      base_url,
      paths: serialized.paths,
      module_suffixes: serialized.module_suffixes,
      jsx: serialized.jsx,
      jsx_factory: serialized.jsx_factory,
      jsx_fragment_factory: serialized.jsx_fragment_factory,
      jsx_import_source: serialized.jsx_import_source,
      experimental_decorators: serialized.experimental_decorators,
      use_define_for_class_fields: serialized.use_define_for_class_fields,
      target: serialized.target,
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

    if self.jsx.is_none() {
      self.jsx = extended.jsx;
    }
    if self.jsx_factory.is_none() {
      self.jsx_factory = extended.jsx_factory.clone();
    }
    if self.jsx_fragment_factory.is_none() {
      self.jsx_fragment_factory = extended.jsx_fragment_factory.clone();
    }
    if self.jsx_import_source.is_none() {
      self.jsx_import_source = extended.jsx_import_source.clone();
    }
    if self.use_define_for_class_fields.is_none() {
      self.use_define_for_class_fields = extended.use_define_for_class_fields;
    }
    if self.target.is_none() {
      self.target = extended.target.clone();
    }
    // `experimental_decorators` is a plain bool with no "unset" state; inherit by
    // OR so a base that enables it is honored. (Explicit child `false` cannot
    // override a base `true` — documented limitation.)
    self.experimental_decorators = self.experimental_decorators || extended.experimental_decorators;
  }

  pub fn paths<'a>(&'a self, specifier: &'a Specifier) -> impl Iterator<Item = PathId> + 'a {
    if !matches!(specifier, Specifier::Package(..) | Specifier::Builtin(..)) {
      return Either::Right(Either::Right(std::iter::empty()));
    }

    // If there is a base url setting, resolve it relative to the tsconfig.json file.
    // Otherwise, the base for paths is implicitly the directory containing the tsconfig.
    let base_url_iter = if let Some(base_url) = self.base_url {
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
  base_url: &'a PathId,
  paths: &'a [String],
  replacement: Option<(Cow<'a, str>, usize, usize)>,
) -> impl Iterator<Item = PathId> + 'a {
  paths
    .iter()
    .filter(|p| !p.ends_with(".d.ts"))
    .map(move |path| {
      if let Some((replacement, start, end)) = &replacement {
        let path = path.replace('*', &replacement[*start..replacement.len() - *end]);
        base_url.join(Path::new(&path))
      } else {
        base_url.join(Path::new(path))
      }
    })
}

fn base_url_iter<'a>(
  base_url: PathId,
  specifier: &'a Specifier,
) -> impl Iterator<Item = PathId> + 'a {
  std::iter::once_with(move || {
    if let Specifier::Package(module, subpath) = specifier {
      // `module` may be a scoped package name (e.g. `@scope/name`) containing a separator, so
      // join it as a path (splitting into segments) rather than `child` (a single literal segment),
      // otherwise the resulting `PathId` would differ from the same path interned normally.
      base_url
        .join(Path::new(module.as_ref()))
        .join(Path::new(subpath.as_ref()))
    } else {
      base_url
    }
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use indexmap::indexmap;

  fn get_normalized<P: AsRef<Path>>(path: P) -> PathId {
    PathId::new(path.as_ref())
  }

  #[test]
  fn test_paths() {
    let tsconfig = TsConfig::from_serialized(
      get_normalized("/foo/tsconfig.json"),
      SerializedTsConfig {
        base_url: None,
        paths: Some(indexmap! {
          "jquery".into() => vec!["node_modules/jquery/dist/jquery".into()],
          "*".into() => vec!["generated/*".into()],
          "bar/*".into() => vec!["test/*".into()],
          "bar/baz/*".into() => vec!["baz/*".into(), "yo/*".into()],
          "@/components/*".into() => vec!["components/*".into()],
          "url".into() => vec!["node_modules/my-url".into()],
        }),
        module_suffixes: None,
        jsx: None,
        jsx_factory: None,
        jsx_fragment_factory: None,
        jsx_import_source: None,
        experimental_decorators: false,
        use_define_for_class_fields: None,
        target: None,
      },
    );

    let test = |specifier: &str| tsconfig.paths(&specifier.into()).collect::<Vec<PathId>>();

    assert_eq!(
      test("jquery"),
      vec![get_normalized("/foo/node_modules/jquery/dist/jquery")]
    );
    assert_eq!(test("test"), vec![get_normalized("/foo/generated/test")]);
    assert_eq!(
      test("test/hello"),
      vec![get_normalized("/foo/generated/test/hello")]
    );
    assert_eq!(test("bar/hi"), vec![get_normalized("/foo/test/hi")]);
    assert_eq!(
      test("bar/baz/hi"),
      vec![get_normalized("/foo/baz/hi"), get_normalized("/foo/yo/hi")]
    );
    assert_eq!(
      test("@/components/button"),
      vec![get_normalized("/foo/components/button")]
    );
    assert_eq!(test("./jquery"), Vec::<PathId>::new());
    assert_eq!(
      test("url"),
      vec![get_normalized("/foo/node_modules/my-url")]
    );
  }

  #[test]
  fn test_base_url() {
    let tsconfig = TsConfig::from_serialized(
      get_normalized("/foo/tsconfig.json"),
      SerializedTsConfig {
        base_url: Some(PathBuf::from("src")),
        paths: None,
        module_suffixes: None,
        jsx: None,
        jsx_factory: None,
        jsx_fragment_factory: None,
        jsx_import_source: None,
        experimental_decorators: false,
        use_define_for_class_fields: None,
        target: None,
      },
    );

    let test = |specifier: &str| tsconfig.paths(&specifier.into()).collect::<Vec<PathId>>();

    assert_eq!(test("foo"), vec![get_normalized("/foo/src/foo/")]);
    assert_eq!(
      test("components/button"),
      vec![get_normalized("/foo/src/components/button")]
    );
    assert_eq!(test("./jquery"), Vec::<PathId>::new());
  }

  #[test]
  fn test_paths_and_base_url() {
    let tsconfig = TsConfig::from_serialized(
      get_normalized("/foo/tsconfig.json"),
      SerializedTsConfig {
        base_url: Some(Path::new("src").into()),
        paths: Some(indexmap! {
          "*".into() => vec!["generated/*".into()],
          "bar/*".into() => vec!["test/*".into()],
          "bar/baz/*".into() => vec!["baz/*".into(), "yo/*".into()],
          "@/components/*".into() => vec!["components/*".into()],
        }),
        module_suffixes: None,
        jsx: None,
        jsx_factory: None,
        jsx_fragment_factory: None,
        jsx_import_source: None,
        experimental_decorators: false,
        use_define_for_class_fields: None,
        target: None,
      },
    );

    let test = |specifier: &str| tsconfig.paths(&specifier.into()).collect::<Vec<PathId>>();

    assert_eq!(
      test("test"),
      vec![
        get_normalized("/foo/src/generated/test"),
        get_normalized("/foo/src/test/")
      ]
    );
    assert_eq!(
      test("test/hello"),
      vec![
        get_normalized("/foo/src/generated/test/hello"),
        get_normalized("/foo/src/test/hello")
      ]
    );
    assert_eq!(
      test("bar/hi"),
      vec![
        get_normalized("/foo/src/test/hi"),
        get_normalized("/foo/src/bar/hi")
      ]
    );
    assert_eq!(
      test("bar/baz/hi"),
      vec![
        get_normalized("/foo/src/baz/hi"),
        get_normalized("/foo/src/yo/hi"),
        get_normalized("/foo/src/bar/baz/hi")
      ]
    );
    assert_eq!(
      test("@/components/button"),
      vec![
        get_normalized("/foo/src/components/button"),
        get_normalized("/foo/src/@/components/button")
      ]
    );
    assert_eq!(test("./jquery"), Vec::<PathId>::new());
  }

  #[test]
  fn test_extends_inherits_compiler_options() {
    let base = TsConfig::from_serialized(
      get_normalized("/foo/base.json"),
      SerializedTsConfig {
        base_url: None,
        paths: None,
        module_suffixes: None,
        jsx: Some(Jsx::ReactJsx),
        jsx_factory: Some("h".into()),
        jsx_fragment_factory: None,
        jsx_import_source: Some("preact".into()),
        experimental_decorators: true,
        use_define_for_class_fields: Some(true),
        target: Some("es2022".into()),
      },
    );

    let mut child = TsConfig::from_serialized(
      get_normalized("/foo/tsconfig.json"),
      SerializedTsConfig {
        base_url: None,
        paths: None,
        module_suffixes: None,
        jsx: None,
        jsx_factory: None,
        jsx_fragment_factory: None,
        jsx_import_source: None,
        experimental_decorators: false,
        use_define_for_class_fields: None,
        target: None,
      },
    );

    child.extend(&base);

    assert_eq!(child.jsx, Some(Jsx::ReactJsx));
    assert_eq!(child.jsx_factory.as_deref(), Some("h"));
    assert_eq!(child.jsx_import_source.as_deref(), Some("preact"));
    assert_eq!(child.experimental_decorators, true);
    assert_eq!(child.use_define_for_class_fields, Some(true));
    assert_eq!(child.target.as_deref(), Some("es2022"));
  }
}
