use std::{path::{Path, PathBuf}, borrow::Cow};
use url::{Url};
use percent_encoding::percent_decode_str;

use crate::{SpecifierType, ResolverMode, utils::parse_package_specifier};

#[derive(PartialEq, Eq, Hash, Clone, Debug)]
pub enum Specifier<'a> {
  Relative(Cow<'a, Path>),
  Absolute(Cow<'a, Path>),
  Tilde(Cow<'a, Path>),
  Hash(Cow<'a, str>),
  Package(Cow<'a, str>, Cow<'a, str>),
  Builtin(Cow<'a, str>),
  Url(Url)
}

impl<'a> Specifier<'a> {
  pub fn parse(specifier: &str, specifier_type: SpecifierType, mode: ResolverMode) -> Result<Specifier, ()> {
    Ok(match specifier.as_bytes()[0] {
      b'.' => {
        if specifier.starts_with("./") {
          Specifier::Relative(decode_path(&specifier[2..], specifier_type))
        } else {
          Specifier::Relative(decode_path(specifier, specifier_type))
        }
      },
      b'~' => {
        // Tilde path. Resolve relative to nearest node_modules directory,
        // the nearest directory with package.json or the project root - whichever comes first.
        let mut specifier = &specifier[1..];
        if specifier.starts_with('/') {
          specifier = &specifier[1..];
        }
        Specifier::Tilde(decode_path(specifier, specifier_type))
      }
      b'/' => Specifier::Absolute(decode_path(specifier, specifier_type)),
      b'#' => Specifier::Hash(Cow::Borrowed(&specifier[1..])),
      _ => {
        // Bare specifier.
        match specifier_type {
          SpecifierType::Url | SpecifierType::Esm => {
            match Url::parse(specifier) {
              Ok(url) => {
                match url.scheme() {
                  "npm" if mode == ResolverMode::Parcel => {
                    let specifier = Cow::Owned(percent_decode_str(url.path()).decode_utf8_lossy().as_ref().to_owned());
                    parse_package(specifier)?
                  }
                  "node" => {
                    // Node does not URL decode or support query params here.
                    // See https://github.com/nodejs/node/issues/39710.
                    Specifier::Builtin(Cow::Owned(url.path().to_owned()))
                  }
                  "file" => Specifier::Absolute(Cow::Owned(url.to_file_path()?)),
                  _ => Specifier::Url(url)
                }
              }
              Err(_) => {
                let specifier = percent_decode_str(specifier).decode_utf8_lossy();
                parse_package(specifier)?
              }
            }
          }
          SpecifierType::Cjs => {
            parse_package(Cow::Borrowed(specifier))?
          }
        }
      }
    })
  }
}

fn parse_package<'a>(specifier: Cow<'a, str>) -> Result<Specifier, ()> {
  match specifier {
    Cow::Borrowed(specifier) => {
      let (module, subpath) = parse_package_specifier(specifier)?;
      Ok(Specifier::Package(Cow::Borrowed(module), Cow::Borrowed(subpath)))
    }
    Cow::Owned(specifier) => {
      let (module, subpath) = parse_package_specifier(&specifier)?;
      Ok(Specifier::Package(Cow::Owned(module.to_owned()), Cow::Owned(subpath.to_owned())))
    }
  }
}

fn decode_path<'a>(specifier: &'a str, specifier_type: SpecifierType) -> Cow<'a, Path> {
  match specifier_type {
    SpecifierType::Url | SpecifierType::Esm => {
      match percent_decode_str(specifier).decode_utf8_lossy() {
        Cow::Borrowed(v) => Cow::Borrowed(Path::new(v)),
        Cow::Owned(v) => Cow::Owned(PathBuf::from(v))
      }
    }
    SpecifierType::Cjs => Cow::Borrowed(Path::new(specifier))
  }
}

impl<'a> From<&'a str> for Specifier<'a> {
  fn from(specifier: &'a str) -> Self {
    Specifier::parse(specifier, SpecifierType::Cjs, ResolverMode::Parcel).unwrap()
  }
}

impl<'a, 'de: 'a> serde::Deserialize<'de> for Specifier<'a> {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
      where
          D: serde::Deserializer<'de> {
    use serde::Deserialize;
    let s: &'de str = Deserialize::deserialize(deserializer)?;
    // Specifiers are only deserialized as part of the "alias" and "browser" fields,
    // so we assume CJS specifiers in Parcel mode.
    Specifier::parse(s, SpecifierType::Cjs, ResolverMode::Parcel).map_err(|_| serde::de::Error::custom("Invalid specifier"))
  }
}
