use std::{
  borrow::Cow,
  collections::HashSet,
  path::{Component, Path, PathBuf},
};

use dashmap::{DashMap, DashSet};
use es_module_lexer::{lex, ImportKind};
use glob_match::glob_match;
use parcel_resolver::{
  CacheCow, FileSystem, Invalidations, OsFileSystem, Resolution, Resolver, ResolverError,
  SpecifierType,
};
use rayon::prelude::{ParallelBridge, ParallelIterator};

#[derive(Debug)]
pub enum EsmGraphBuilderError {
  IOError(std::io::Error),
  ParseError,
  ResolverError(ResolverError),
  Dynamic,
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

#[derive(Default)]
pub struct Cache {
  entries: DashMap<PathBuf, Invalidations>,
}

struct EsmGraphBuilder<'a, Fs> {
  visited: DashSet<PathBuf>,
  invalidations: Invalidations,
  resolver: &'a Resolver<'a, Fs>,
  cache: &'a Cache,
}

impl<'a, Fs: FileSystem> EsmGraphBuilder<'a, Fs> {
  pub fn build(&self, file: &Path) -> Result<(), EsmGraphBuilderError> {
    if self.visited.contains(file) {
      return Ok(());
    }

    self.visited.insert(file.to_owned());

    if let Some(invalidations) = self.cache.entries.get(file) {
      self.invalidations.extend(&invalidations);
      for p in invalidations
        .invalidate_on_file_change
        .read()
        .unwrap()
        .iter()
      {
        if let Some(ext) = p.extension() {
          if ext == "js" || ext == "cjs" || ext == "mjs" {
            self.build(&p)?;
          }
        }
      }
      return Ok(());
    }

    let invalidations = Invalidations::default();
    let contents = self.resolver.cache.fs.read_to_string(&file)?;
    let module = lex(&contents)?;
    module
      .imports()
      // .par_bridge()
      .map(|import| {
        match import.kind() {
          ImportKind::DynamicExpression => {
            if let Some(mut glob) = specifier_to_glob(&import.specifier()) {
              if glob.starts_with('.') {
                let glob = resolve_path(file, glob);
                println!("GLOB: {:?}", glob);
                // TODO: should also invalidate on update
                invalidations.invalidate_on_glob_create(glob.to_string_lossy());
              } else {
                glob.insert_str(0, "**/node_modules/");
                println!("GLOB: {}", glob);
                invalidations.invalidate_on_glob_create(&glob);
              }
            } else {
              if !glob_match(
                "**/node_modules/browserslist/**",
                file.to_str().unwrap_or_default(),
              ) {
                println!("DYNAMIC: {} {:?}", import.specifier(), file);
                invalidations.invalidate_on_startup();
              }
            }
            if false {
              return Err(EsmGraphBuilderError::Dynamic);
            }
          }
          ImportKind::DynamicString | ImportKind::Standard => {
            // println!(
            //   "IMPORT {} {:?} {:?}",
            //   import.specifier(),
            //   import.kind(),
            //   file,
            // );

            match self.resolver.resolve_with_invalidations(
              &import.specifier(),
              &file,
              SpecifierType::Esm,
              &invalidations,
            ) {
              Ok((Resolution::Path(p), _)) => {
                // println!(
                //   "IMPORT {} {:?} {:?} {:?}",
                //   import.specifier(),
                //   import.kind(),
                //   file,
                //   p
                // );
                invalidations.invalidate_on_file_change(&p);
                if let Some(ext) = p.extension() {
                  if ext == "js" || ext == "cjs" || ext == "mjs" {
                    self.build(&p)?;
                  }
                }
              }
              Err(e) => {
                // println!(
                //   "FAILED TO RESOLVE {:?} {:?} {:?}",
                //   import.specifier(),
                //   file,
                //   e
                // );
              }
              _ => {}
            }
          }
          ImportKind::Meta => {}
        }

        Ok(())
      })
      .collect::<Result<_, _>>()?;

    self.invalidations.extend(&invalidations);
    self.cache.entries.insert(file.to_owned(), invalidations);
    Ok(())
  }
}

fn specifier_to_glob(specifier: &str) -> Option<String> {
  let mut bytes = specifier.as_bytes();
  let mut result = String::new();
  while let Some((s, b)) = read_string(bytes) {
    if result.ends_with("**") && !s.starts_with('/') {
      result.push_str("/*");
    }
    result.push_str(&s);
    bytes = skip_comments_and_whitespace(b);
    if bytes.is_empty() {
      break;
    }

    if bytes[0] == b'+' {
      let mut added = false;
      loop {
        bytes = skip_comments_and_whitespace(&bytes[1..]);
        let ptr = bytes.as_ptr();
        let rest = skip_expression(bytes);
        if !added && ptr != rest.as_ptr() {
          if result.ends_with('/') {
            result.push_str("**");
          } else {
            result.push_str("*/**");
          }
          added = true;
        }
        bytes = skip_comments_and_whitespace(rest);
        if bytes.is_empty() || matches!(bytes[0], b'"' | b'\'') {
          break;
        }
      }
    } else {
      return None;
    }
  }

  if result.is_empty() {
    None
  } else {
    Some(result)
  }
}

fn read_string(bytes: &[u8]) -> Option<(Cow<'_, str>, &[u8])> {
  if bytes.is_empty() {
    return None;
  }

  let quote = bytes[0];
  if quote == b'`' {
    return read_template_string(bytes);
  }

  if quote != b'\'' && quote != b'"' {
    return None;
  }

  let mut i = 1;
  while i < bytes.len() {
    match bytes[i] {
      b'\\' => {
        i += 1;
        if i + 1 < bytes.len() && bytes[i] == b'\r' && bytes[i + 1] == b'\n' {
          i += 1;
        }
      }
      b'\r' | b'\n' => break,
      c if c == quote => {
        return Some((
          escape_glob(unsafe { std::str::from_utf8_unchecked(&bytes[1..i]) }),
          &bytes[i + 1..],
        ))
      }
      _ => {}
    }

    i += 1;
  }

  None
}

fn read_template_string(mut bytes: &[u8]) -> Option<(Cow<'_, str>, &[u8])> {
  let mut i = 1;
  let mut braces = 0;
  let mut result = Cow::Borrowed("");
  let mut start = 1;
  while i < bytes.len() {
    match bytes[i] {
      b'$' if braces == 0 && i + 1 < bytes.len() && bytes[i + 1] == b'{' => {
        // Add current segment.
        let s = unsafe { std::str::from_utf8_unchecked(&bytes[start..i]) };
        if !s.is_empty() {
          if result.ends_with("**") && !s.starts_with('/') {
            result += "/*";
          }
          result += escape_glob(unsafe { std::str::from_utf8_unchecked(&bytes[start..i]) });
        }
        if result.ends_with('/') {
          result += "**";
        } else {
          result += "*/**";
        }
        i += 1;
        braces += 1;
      }
      b'}' if braces == 1 => {
        braces -= 1;
        start = i + 1;
      }
      b'\\' if braces == 0 => {
        i += 1;
      }
      b'`' if braces == 0 => {
        // String end. Add last segment.
        let s = escape_glob(unsafe { std::str::from_utf8_unchecked(&bytes[start..i]) });
        if !s.is_empty() {
          if result.ends_with("**") && !s.starts_with('/') {
            result += "/*";
          }
          if result.is_empty() {
            return Some((s, &bytes[i + 1..]));
          }
          result += s;
        }
        return Some((result, &bytes[i + 1..]));
      }
      _ => {}
    }

    i += 1;
    if braces > 0 {
      bytes = skip_comments_and_whitespace(&bytes[i..]);
      i = 0;
    }
  }

  None
}

fn escape_glob<'a>(s: &'a str) -> Cow<'a, str> {
  let mut result = Cow::Borrowed("");
  let mut start = 0;
  for (index, matched) in s.match_indices(&['*', '?', '[', ']', '{', '}', '(', ')', '!', '\\']) {
    result += &s[start..index];
    result += "\\";
    result += matched;
    start = index + 1;
  }

  result += &s[start..];
  result
}

fn skip_comments_and_whitespace(bytes: &[u8]) -> &[u8] {
  let mut i = 0;
  while i < bytes.len() {
    let ch = bytes[i];
    if ch == b'/' {
      if i + 1 < bytes.len() {
        let next_ch = bytes[i + 1];
        i += 2;
        if next_ch == b'/' {
          while i < bytes.len() {
            let ch = bytes[i];
            if matches!(ch, b'\n' | b'\r') {
              break;
            }
            i += 1;
          }
        } else if next_ch == b'*' {
          while i < bytes.len() {
            let ch = bytes[i];
            if ch == b'*' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
              i += 2;
              break;
            }
            i += 1;
          }
        }
      }
    } else if !is_br_or_ws(ch) {
      return &bytes[i..];
    }
    i += 1;
  }

  &bytes[i..]
}

fn skip_expression(mut bytes: &[u8]) -> &[u8] {
  let mut stack: [u8; 1024] = [0; 1024];
  let mut stack_len = 0;
  while !bytes.is_empty() {
    bytes = skip_comments_and_whitespace(bytes);
    if !bytes.is_empty() {
      let ch = bytes[0];

      match ch {
        b'{' | b'(' | b'[' => {
          if stack_len >= stack.len() {
            return bytes;
          }

          stack[stack_len] = ch;
          stack_len += 1;
        }
        ch @ (b'}' | b')' | b']') => {
          let opposite = match ch {
            b'}' => b'{',
            b')' => b'(',
            b']' => b'[',
            _ => unreachable!(),
          };
          if stack_len > 0 && opposite == stack[stack_len - 1] {
            stack_len -= 1;
          } else {
            return bytes;
          }
        }
        b'+' if stack_len == 0 && bytes.len() > 1 => return &bytes[1..],
        b'\'' | b'"' if stack_len == 0 => return bytes,
        _ => {}
      }
    }
    bytes = &bytes[1..]
  }

  bytes
}

#[inline]
fn is_br_or_ws(c: u8) -> bool {
  c > 8 && c < 14 || c == 32 || c == 160
}

pub fn resolve_path<A: AsRef<Path>, B: AsRef<Path>>(base: A, subpath: B) -> PathBuf {
  let subpath = subpath.as_ref();
  let mut components = subpath.components().peekable();
  if subpath.is_absolute() || matches!(components.peek(), Some(Component::Prefix(..))) {
    return subpath.to_path_buf();
  }

  let mut ret = base.as_ref().to_path_buf();
  ret.pop();
  for component in subpath.components() {
    match component {
      Component::Prefix(..) | Component::RootDir => unreachable!(),
      Component::CurDir => {}
      Component::ParentDir => {
        ret.pop();
      }
      Component::Normal(c) => {
        ret.push(c);
      }
    }
  }

  ret
}

pub fn build_esm_graph<'a, Fs: FileSystem>(
  file: &Path,
  resolver: &Resolver<'a, Fs>,
  cache: &Cache,
) -> Result<Invalidations, EsmGraphBuilderError> {
  let visitor = EsmGraphBuilder {
    visited: DashSet::new(),
    invalidations: Invalidations::default(),
    resolver,
    cache,
  };

  visitor.build(file)?;
  Ok(visitor.invalidations)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn root() -> PathBuf {
    // Path::new(env!("CARGO_MANIFEST_DIR"))
    //   .parent()
    //   .unwrap()
    //   .join("node-resolver-core/test/fixture")
    Path::new("/Users/devongovett/Downloads/npm-test").to_path_buf()
  }

  // #[test]
  // fn test_visitor() {
  //   let resolved = Resolver::node_esm(
  //     Cow::Owned(root()),
  //     CacheCow::Owned(Cache::new(OsFileSystem::default())),
  //   )
  //   .resolve("supports-color", &root(), SpecifierType::Esm)
  //   .result
  //   .unwrap()
  //   .0;
  //   println!("{:?}", resolved);
  //   if let Resolution::Path(p) = resolved {
  //     let res = build_esm_graph(&p, root()).unwrap();
  //     println!("{:?}", res);
  //   }
  // }

  #[test]
  fn test_glob() {
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features/' + name + '.js'"),
      Some("caniuse-lite/data/features/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features' + name + '.js'"),
      Some("caniuse-lite/data/features*/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features/' + name + '/index.js'"),
      Some("caniuse-lite/data/features/**/index.js".into())
    );
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features/' + (a + b) + '.js'"),
      Some("caniuse-lite/data/features/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features/' + (a ? 'foo' : 'bar') + '.js'"),
      Some("caniuse-lite/data/features/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features/' + a + b + '.js'"),
      Some("caniuse-lite/data/features/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features/' + a + 'test' + '.js'"),
      Some("caniuse-lite/data/features/**/*test.js".into())
    );
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features/' + a + /* 'hello' */ + '.js'"),
      Some("caniuse-lite/data/features/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features/' + a + \n // 'hello'\n + '.js'"),
      Some("caniuse-lite/data/features/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features/' + foo('hi') + '.js'"),
      Some("caniuse-lite/data/features/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features/' + 'hi' + '.js'"),
      Some("caniuse-lite/data/features/hi.js".into())
    );
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/[features]/' + name + '.js'"),
      Some("caniuse-lite/data/\\[features\\]/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("`caniuse-lite/data/features/${name}.js`"),
      Some("caniuse-lite/data/features/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("`caniuse-lite/data/features${name}.js`"),
      Some("caniuse-lite/data/features*/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("`caniuse-lite/data/[features]/${name}.js`"),
      Some("caniuse-lite/data/\\[features\\]/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("`caniuse-lite/data/features/${/* } */ name}.js`"),
      Some("caniuse-lite/data/features/**/*.js".into())
    );
    assert_eq!(
      specifier_to_glob("`caniuse-lite/data/features/${\n// }\n name}.js`"),
      Some("caniuse-lite/data/features/**/*.js".into())
    );
    assert_eq!(specifier_to_glob("file"), None);
    assert_eq!(specifier_to_glob("file + '.js'"), None);
    assert_eq!(specifier_to_glob("test"), None);
    assert_eq!(
      specifier_to_glob("'caniuse-lite/data/features/' - '.js'"),
      None
    );
  }
}
