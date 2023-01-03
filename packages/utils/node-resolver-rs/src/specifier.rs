use percent_encoding::percent_decode_str;
use std::{
  borrow::Cow,
  path::{Path, PathBuf},
};
use url::Url;

use crate::{builtins::BUILTINS, ResolverMode, SpecifierType};

#[derive(PartialEq, Eq, Hash, Clone, Debug)]
pub enum Specifier<'a> {
  Relative(Cow<'a, Path>),
  Absolute(Cow<'a, Path>),
  Tilde(Cow<'a, Path>),
  Hash(Cow<'a, str>),
  Package(Cow<'a, str>, Cow<'a, str>),
  Builtin(Cow<'a, str>),
  Url(&'a str),
}

impl<'a> Specifier<'a> {
  pub fn parse(
    specifier: &str,
    specifier_type: SpecifierType,
    mode: ResolverMode,
  ) -> Result<Specifier, ()> {
    Ok(match specifier.as_bytes()[0] {
      b'.' => {
        let specifier = if specifier.starts_with("./") {
          &specifier[2..]
        } else if specifier.starts_with("..") {
          specifier
        } else {
          &specifier[1..]
        };
        Specifier::Relative(decode_path(specifier, specifier_type))
      }
      b'~' => {
        let mut specifier = &specifier[1..];
        if specifier.starts_with('/') {
          specifier = &specifier[1..];
        }
        Specifier::Tilde(decode_path(specifier, specifier_type))
      }
      b'/' => {
        if specifier.starts_with("//") && specifier_type == SpecifierType::Url {
          // A protocol-relative URL, e.g `url('//example.com/foo.png')`.
          Specifier::Url(specifier)
        } else {
          Specifier::Absolute(decode_path(specifier, specifier_type))
        }
      }
      b'#' => Specifier::Hash(Cow::Borrowed(&specifier[1..])),
      _ => {
        // Bare specifier.
        match specifier_type {
          SpecifierType::Url | SpecifierType::Esm => {
            if BUILTINS.contains(&specifier.as_ref()) {
              return Ok(Specifier::Builtin(Cow::Borrowed(specifier)));
            }

            // Check if there is a scheme first.
            if let Ok((scheme, rest)) = parse_scheme(specifier) {
              let (path, _rest) = parse_path(rest);
              match scheme.as_ref() {
                "npm" if mode == ResolverMode::Parcel => {
                  parse_package(percent_decode_str(path).decode_utf8_lossy())?
                }
                "node" => {
                  // Node does not URL decode or support query params here.
                  // See https://github.com/nodejs/node/issues/39710.
                  Specifier::Builtin(Cow::Borrowed(path))
                }
                "file" => {
                  // Fully parsing file urls is somewhat complex, so use the url crate for this.
                  let url = Url::parse(specifier).map_err(|_| ())?;
                  Specifier::Absolute(Cow::Owned(url.to_file_path()?))
                }
                _ => Specifier::Url(specifier),
              }
            } else {
              // If not, then parse as an npm package if this is an ESM specifier,
              // otherwise treat this as a relative path.
              let (path, _rest) = parse_path(specifier);
              if specifier_type == SpecifierType::Esm {
                parse_package(percent_decode_str(path).decode_utf8_lossy())?
              } else {
                Specifier::Relative(decode_path(path, specifier_type))
              }
            }
          }
          SpecifierType::Cjs => {
            if BUILTINS.contains(&specifier.as_ref()) {
              Specifier::Builtin(Cow::Borrowed(specifier))
            } else {
              parse_package(Cow::Borrowed(specifier))?
            }
          }
        }
      }
    })
  }
}

// https://url.spec.whatwg.org/#scheme-state
// https://github.com/servo/rust-url/blob/1c1e406874b3d2aa6f36c5d2f3a5c2ea74af9efb/url/src/parser.rs#L387
fn parse_scheme<'a>(input: &'a str) -> Result<(Cow<'a, str>, &'a str), ()> {
  if input.is_empty() || !input.starts_with(ascii_alpha) {
    return Err(());
  }
  let mut i = 0;
  let mut is_lowercase = true;
  for c in input.chars() {
    match c {
      'A'..='Z' => {
        is_lowercase = false;
      }
      'a'..='z' | '0'..='9' | '+' | '-' | '.' => {}
      ':' => {
        let scheme = &input[0..i];
        let rest = &input[i + 1..];
        return Ok(if is_lowercase {
          (Cow::Borrowed(scheme), rest)
        } else {
          (Cow::Owned(scheme.to_ascii_lowercase()), rest)
        });
      }
      _ => {
        return Err(());
      }
    }
    i += 1;
  }

  // EOF before ':'
  Err(())
}

// https://url.spec.whatwg.org/#path-state
fn parse_path<'a>(input: &'a str) -> (&'a str, &'a str) {
  // We don't really want to normalize the path (e.g. replacing ".." and "." segments).
  // That is done later. For now, we just need to find the end of the path.
  if let Some(pos) = input.chars().position(|c| c == '?' || c == '#') {
    (&input[0..pos], &input[pos..])
  } else {
    (input, "")
  }
}

// https://url.spec.whatwg.org/#query-state
// fn parse_query<'a>(input: &'a str) -> (&'a str, &'a str) {

// }

/// https://url.spec.whatwg.org/#ascii-alpha
#[inline]
fn ascii_alpha(ch: char) -> bool {
  matches!(ch, 'a'..='z' | 'A'..='Z')
}

fn parse_package<'a>(specifier: Cow<'a, str>) -> Result<Specifier, ()> {
  match specifier {
    Cow::Borrowed(specifier) => {
      let (module, subpath) = parse_package_specifier(specifier)?;
      Ok(Specifier::Package(
        Cow::Borrowed(module),
        Cow::Borrowed(subpath),
      ))
    }
    Cow::Owned(specifier) => {
      let (module, subpath) = parse_package_specifier(&specifier)?;
      Ok(Specifier::Package(
        Cow::Owned(module.to_owned()),
        Cow::Owned(subpath.to_owned()),
      ))
    }
  }
}

pub fn parse_package_specifier(specifier: &str) -> Result<(&str, &str), ()> {
  let idx = specifier.chars().position(|p| p == '/');
  if specifier.starts_with('@') {
    let idx = idx.ok_or(())?;
    if let Some(next) = &specifier[idx + 1..].chars().position(|p| p == '/') {
      Ok((
        &specifier[0..idx + 1 + *next],
        &specifier[idx + *next + 2..],
      ))
    } else {
      Ok((&specifier[..], ""))
    }
  } else if let Some(idx) = idx {
    Ok((&specifier[0..idx], &specifier[idx + 1..]))
  } else {
    Ok((&specifier[..], ""))
  }
}

pub fn decode_path<'a>(specifier: &'a str, specifier_type: SpecifierType) -> Cow<'a, Path> {
  match specifier_type {
    SpecifierType::Url | SpecifierType::Esm => {
      let (path, _) = parse_path(specifier);
      match percent_decode_str(path).decode_utf8_lossy() {
        Cow::Borrowed(v) => Cow::Borrowed(Path::new(v)),
        Cow::Owned(v) => Cow::Owned(PathBuf::from(v)),
      }
    }
    SpecifierType::Cjs => Cow::Borrowed(Path::new(specifier)),
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
    D: serde::Deserializer<'de>,
  {
    use serde::Deserialize;
    let s: &'de str = Deserialize::deserialize(deserializer)?;
    // Specifiers are only deserialized as part of the "alias" and "browser" fields,
    // so we assume CJS specifiers in Parcel mode.
    Specifier::parse(s, SpecifierType::Cjs, ResolverMode::Parcel)
      .map_err(|_| serde::de::Error::custom("Invalid specifier"))
  }
}
