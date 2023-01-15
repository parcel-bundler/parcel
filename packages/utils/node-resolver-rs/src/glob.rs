// use std::path::is_separator;

pub fn glob_match(glob: &str, path: &str) -> bool {
  // This algorithm is based on https://research.swtch.com/glob
  let glob = glob.as_bytes();
  let glob_len = glob.len();
  let path = path.as_bytes();
  let path_len = path.len();
  let mut glob_index = 0;
  let mut path_index = 0;
  let mut next_glob_index = 0;
  let mut next_path_index = 0;
  let mut in_braces = false;
  let mut brace_start = 0;
  let mut allow_sep = true;
  let mut needs_sep = false;
  let mut saw_globstar = false;

  let mut negated = false;
  while glob_index < glob_len && glob[glob_index] == b'!' {
    negated = !negated;
    glob_index += 1;
  }

  while glob_index < glob_len || path_index < path_len {
    if !allow_sep && path_index < path_len && is_separator(path[path_index]) {
      next_path_index = 0;
      allow_sep = true;
    }

    if glob_index < glob_len {
      match glob[glob_index] {
        b'*' => {
          next_glob_index = glob_index;
          next_path_index = path_index + 1;
          glob_index += 1;

          allow_sep = saw_globstar;
          needs_sep = false;

          // ** allows path separators, whereas * does not.
          // However, ** must be a full path component, i.e. a/**/b not a**b.
          if glob_index < glob_len && glob[glob_index] == b'*' {
            glob_index += 1;
            if glob_len == glob_index {
              allow_sep = true;
            } else if (glob_index < 3 || is_separator(glob[glob_index - 3]))
              && is_separator(glob[glob_index])
            {
              // Matched a full /**/ segment. Skip the ending / so we search for the following character.
              // In effect, this makes the whole segment optional so that a/**/b matches a/b.
              glob_index += 1;

              // The allows_sep flag allows separator characters in ** matches.
              // The needs_sep flag ensures that the character just before the next matching
              // one is a '/', which prevents a/**/b from matching a/bb.
              allow_sep = true;
              needs_sep = true;
            }
          }
          if allow_sep {
            saw_globstar = true;
          }

          // If the next char is a special brace separator,
          // skip to the end of the braces so we don't try to match it.
          if in_braces && glob_index < glob_len && matches!(glob[glob_index], b',' | b'}') {
            if !skip_braces(glob, &mut glob_index) {
              // invalid pattern!
              return false;
            }
          }
          continue;
        }
        b'?' if path_index < path_len => {
          if !is_separator(path[path_index]) {
            glob_index += 1;
            path_index += 1;
            continue;
          }
        }
        b'[' if path_index < path_len => {
          glob_index += 1;
          let c = path[path_index];
          let mut negated = false;
          if glob_index < glob_len && matches!(glob[glob_index], b'^' | b'!') {
            negated = true;
            glob_index += 1;
          }

          let start = glob_index;
          let mut is_match = false;
          while glob_index < glob_len && (glob_index == start || glob[glob_index] != b']') {
            // TODO: unescape
            let mut low = glob[glob_index];
            if !unescape(&mut low, glob, &mut glob_index) {
              // Invalid pattern!
              return false;
            }
            glob_index += 1;

            let high = if glob_index + 1 < glob_len
              && glob[glob_index] == b'-'
              && glob[glob_index + 1] != b']'
            {
              glob_index += 1;
              let mut high = glob[glob_index];
              if !unescape(&mut high, glob, &mut glob_index) {
                // Invalid pattern!
                return false;
              }
              glob_index += 1;
              high
            } else {
              low
            };

            if low <= c && c <= high {
              is_match = true;
            }
          }
          if glob_index < glob_len && glob[glob_index] != b']' {
            // invalid pattern!
            return false;
          }
          glob_index += 1;
          if is_match != negated {
            path_index += 1;
            continue;
          }
        }
        b'{' if path_index < path_len => {
          in_braces = true;
          glob_index += 1;
          brace_start = path_index;
          continue;
        }
        b'}' if in_braces => {
          // If we hit the end of the braces, we matched the last option.
          in_braces = false;
          glob_index += 1;
          continue;
        }
        b',' if in_braces => {
          // If we hit a comma, we matched one of the options!
          // Skip forward to the end of the braces.
          if !skip_braces(glob, &mut glob_index) {
            // invalid pattern!
            return false;
          }
          in_braces = false;
          continue;
        }
        mut c if path_index < path_len => {
          // Match escaped characters as literals.
          if !unescape(&mut c, glob, &mut glob_index) {
            // Invalid pattern!
            return false;
          }

          // println!("{} {} {:?}", path[path_index] as char, c as char, allow_sep);
          if path[path_index] == c
            && (!needs_sep || (path_index > 0 && is_separator(path[path_index - 1])))
          {
            glob_index += 1;
            path_index += 1;
            needs_sep = false;
            saw_globstar = false;
            continue;
          }
        }
        _ => {}
      }
    }

    if next_path_index > 0 && next_path_index <= path_len {
      glob_index = next_glob_index;
      path_index = next_path_index;
      continue;
    }

    if in_braces {
      // If in braces, find next option and reset path to index where we saw the '{'
      let mut idx = glob_index;
      let mut found_next = false;
      while idx < glob_len {
        match glob[idx] {
          b',' => {
            // Start matching from here.
            glob_index = idx + 1;
            path_index = brace_start;
            found_next = true;
            break;
          }
          b'}' => {
            break;
          }
          b'\\' => {
            idx += 2;
          }
          _ => idx += 1,
        }
      }

      if found_next {
        continue;
      }
    }

    return negated;
  }

  !negated
}

#[inline(always)]
fn is_separator(b: u8) -> bool {
  b == b'/'
}

#[inline(always)]
fn unescape(c: &mut u8, glob: &[u8], glob_index: &mut usize) -> bool {
  if *c == b'\\' {
    *glob_index += 1;
    if *glob_index >= glob.len() {
      // Invalid pattern!
      return false;
    }
    *c = match glob[*glob_index] {
      b'a' => b'\x61',
      b'b' => b'\x08',
      b'n' => b'\n',
      b'r' => b'\r',
      b't' => b'\t',
      c => c,
    }
  }
  true
}

#[inline(always)]
fn skip_braces(glob: &[u8], glob_index: &mut usize) -> bool {
  while *glob_index < glob.len() && glob[*glob_index] != b'}' {
    *glob_index += 1;
  }

  if *glob_index < glob.len() && glob[*glob_index] != b'}' {
    // invalid pattern!
    return false;
  }

  *glob_index += 1;
  true
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn basic() {
    assert!(glob_match("abc", "abc"));
    assert!(glob_match("*", "abc"));
    assert!(glob_match("*c", "abc"));
    assert!(!glob_match("*b", "abc"));
    assert!(glob_match("a*", "abc"));
    assert!(!glob_match("b*", "abc"));
    assert!(glob_match("a*", "a"));
    assert!(glob_match("*a", "a"));
    assert!(glob_match("a*b*c*d*e*", "axbxcxdxe"));
    assert!(glob_match("a*b*c*d*e*", "axbxcxdxexxx"));
    assert!(glob_match("a*b?c*x", "abxbbxdbxebxczzx"));
    assert!(!glob_match("a*b?c*x", "abxbbxdbxebxczzy"));

    assert!(glob_match("a/*/test", "a/foo/test"));
    assert!(!glob_match("a/*/test", "a/foo/bar/test"));
    assert!(glob_match("a/**/test", "a/foo/test"));
    assert!(glob_match("a/**/test", "a/foo/bar/test"));
    assert!(glob_match("a/**/b/c", "a/foo/bar/b/c"));
    assert!(glob_match("a\\*b", "a*b"));
    assert!(!glob_match("a\\*b", "axb"));

    assert!(glob_match("[abc]", "a"));
    assert!(glob_match("[abc]", "b"));
    assert!(glob_match("[abc]", "c"));
    assert!(!glob_match("[abc]", "d"));
    assert!(glob_match("x[abc]x", "xax"));
    assert!(glob_match("x[abc]x", "xbx"));
    assert!(glob_match("x[abc]x", "xcx"));
    assert!(!glob_match("x[abc]x", "xdx"));
    assert!(!glob_match("x[abc]x", "xay"));
    assert!(glob_match("[?]", "?"));
    assert!(!glob_match("[?]", "a"));
    assert!(glob_match("[*]", "*"));
    assert!(!glob_match("[*]", "a"));

    assert!(glob_match("[a-cx]", "a"));
    assert!(glob_match("[a-cx]", "b"));
    assert!(glob_match("[a-cx]", "c"));
    assert!(!glob_match("[a-cx]", "d"));
    assert!(glob_match("[a-cx]", "x"));

    assert!(!glob_match("[^abc]", "a"));
    assert!(!glob_match("[^abc]", "b"));
    assert!(!glob_match("[^abc]", "c"));
    assert!(glob_match("[^abc]", "d"));
    assert!(!glob_match("[!abc]", "a"));
    assert!(!glob_match("[!abc]", "b"));
    assert!(!glob_match("[!abc]", "c"));
    assert!(glob_match("[!abc]", "d"));
    assert!(glob_match("[\\!]", "!"));

    assert!(glob_match("a*b*[cy]*d*e*", "axbxcxdxexxx"));
    assert!(glob_match("a*b*[cy]*d*e*", "axbxyxdxexxx"));
    assert!(glob_match("a*b*[cy]*d*e*", "axbxxxyxdxexxx"));

    assert!(glob_match("test.{jpg,png}", "test.jpg"));
    assert!(glob_match("test.{jpg,png}", "test.png"));
    assert!(glob_match("test.{j*g,p*g}", "test.jpg"));
    assert!(glob_match("test.{j*g,p*g}", "test.jpxxxg"));
    assert!(glob_match("test.{j*g,p*g}", "test.jxg"));
    assert!(!glob_match("test.{j*g,p*g}", "test.jnt"));
    assert!(glob_match("test.{j*g,j*c}", "test.jnc"));
    assert!(glob_match("test.{jpg,p*g}", "test.png"));
    assert!(glob_match("test.{jpg,p*g}", "test.pxg"));
    assert!(!glob_match("test.{jpg,p*g}", "test.pnt"));
    assert!(glob_match("test.{jpeg,png}", "test.jpeg"));
    assert!(!glob_match("test.{jpeg,png}", "test.jpg"));
    assert!(glob_match("test.{jpeg,png}", "test.png"));
    assert!(glob_match("test.{jp\\,g,png}", "test.jp,g"));
    assert!(!glob_match("test.{jp\\,g,png}", "test.jxg"));
    assert!(glob_match("test/{foo,bar}/baz", "test/foo/baz"));
    assert!(glob_match("test/{foo,bar}/baz", "test/bar/baz"));
    assert!(!glob_match("test/{foo,bar}/baz", "test/baz/baz"));
    assert!(glob_match("test/{foo*,bar*}/baz", "test/foooooo/baz"));
    assert!(glob_match("test/{foo*,bar*}/baz", "test/barrrrr/baz"));
    assert!(glob_match("test/{*foo,*bar}/baz", "test/xxxxfoo/baz"));
    assert!(glob_match("test/{*foo,*bar}/baz", "test/xxxxbar/baz"));
    assert!(glob_match("test/{foo/**,bar}/baz", "test/bar/baz"));
    assert!(!glob_match("test/{foo/**,bar}/baz", "test/bar/test/baz"));

    assert!(!glob_match("*.txt", "some/big/path/to/the/needle.txt"));
    // assert!(glob_match("**.txt", "some/big/path/to/the/needle.txt"));
  }

  // The below tests are based on Bash and micromatch.
  // https://github.com/micromatch/picomatch/blob/master/test/bash.js

  #[test]
  fn bash() {
    // assert\(([!])?isMatch\('(.*?)', ['"](.*?)['"]\)\);
    // assert!($1glob_match("$3", "$2"));
    assert!(!glob_match("a*", "*"));
    assert!(!glob_match("a*", "**"));
    assert!(!glob_match("a*", "\\*"));
    assert!(!glob_match("a*", "a/*"));
    assert!(!glob_match("a*", "b"));
    assert!(!glob_match("a*", "bc"));
    assert!(!glob_match("a*", "bcd"));
    assert!(!glob_match("a*", "bdir/"));
    assert!(!glob_match("a*", "Beware"));
    assert!(glob_match("a*", "a"));
    assert!(glob_match("a*", "ab"));
    assert!(glob_match("a*", "abc"));

    assert!(!glob_match("\\a*", "*"));
    assert!(!glob_match("\\a*", "**"));
    assert!(!glob_match("\\a*", "\\*"));

    assert!(glob_match("\\a*", "a"));
    assert!(!glob_match("\\a*", "a/*"));
    assert!(glob_match("\\a*", "abc"));
    assert!(glob_match("\\a*", "abd"));
    assert!(glob_match("\\a*", "abe"));
    assert!(!glob_match("\\a*", "b"));
    assert!(!glob_match("\\a*", "bb"));
    assert!(!glob_match("\\a*", "bcd"));
    assert!(!glob_match("\\a*", "bdir/"));
    assert!(!glob_match("\\a*", "Beware"));
    assert!(!glob_match("\\a*", "c"));
    assert!(!glob_match("\\a*", "ca"));
    assert!(!glob_match("\\a*", "cb"));
    assert!(!glob_match("\\a*", "d"));
    assert!(!glob_match("\\a*", "dd"));
    assert!(!glob_match("\\a*", "de"));
  }

  #[test]
  fn bash_directories() {
    assert!(!glob_match("b*/", "*"));
    assert!(!glob_match("b*/", "**"));
    assert!(!glob_match("b*/", "\\*"));
    assert!(!glob_match("b*/", "a"));
    assert!(!glob_match("b*/", "a/*"));
    assert!(!glob_match("b*/", "abc"));
    assert!(!glob_match("b*/", "abd"));
    assert!(!glob_match("b*/", "abe"));
    assert!(!glob_match("b*/", "b"));
    assert!(!glob_match("b*/", "bb"));
    assert!(!glob_match("b*/", "bcd"));
    assert!(glob_match("b*/", "bdir/"));
    assert!(!glob_match("b*/", "Beware"));
    assert!(!glob_match("b*/", "c"));
    assert!(!glob_match("b*/", "ca"));
    assert!(!glob_match("b*/", "cb"));
    assert!(!glob_match("b*/", "d"));
    assert!(!glob_match("b*/", "dd"));
    assert!(!glob_match("b*/", "de"));
  }

  #[test]
  fn bash_escaping() {
    assert!(!glob_match("\\^", "*"));
    assert!(!glob_match("\\^", "**"));
    assert!(!glob_match("\\^", "\\*"));
    assert!(!glob_match("\\^", "a"));
    assert!(!glob_match("\\^", "a/*"));
    assert!(!glob_match("\\^", "abc"));
    assert!(!glob_match("\\^", "abd"));
    assert!(!glob_match("\\^", "abe"));
    assert!(!glob_match("\\^", "b"));
    assert!(!glob_match("\\^", "bb"));
    assert!(!glob_match("\\^", "bcd"));
    assert!(!glob_match("\\^", "bdir/"));
    assert!(!glob_match("\\^", "Beware"));
    assert!(!glob_match("\\^", "c"));
    assert!(!glob_match("\\^", "ca"));
    assert!(!glob_match("\\^", "cb"));
    assert!(!glob_match("\\^", "d"));
    assert!(!glob_match("\\^", "dd"));
    assert!(!glob_match("\\^", "de"));

    assert!(glob_match("\\*", "*"));
    // assert!(glob_match("\\*", "\\*"));
    assert!(!glob_match("\\*", "**"));
    assert!(!glob_match("\\*", "a"));
    assert!(!glob_match("\\*", "a/*"));
    assert!(!glob_match("\\*", "abc"));
    assert!(!glob_match("\\*", "abd"));
    assert!(!glob_match("\\*", "abe"));
    assert!(!glob_match("\\*", "b"));
    assert!(!glob_match("\\*", "bb"));
    assert!(!glob_match("\\*", "bcd"));
    assert!(!glob_match("\\*", "bdir/"));
    assert!(!glob_match("\\*", "Beware"));
    assert!(!glob_match("\\*", "c"));
    assert!(!glob_match("\\*", "ca"));
    assert!(!glob_match("\\*", "cb"));
    assert!(!glob_match("\\*", "d"));
    assert!(!glob_match("\\*", "dd"));
    assert!(!glob_match("\\*", "de"));

    assert!(!glob_match("a\\*", "*"));
    assert!(!glob_match("a\\*", "**"));
    assert!(!glob_match("a\\*", "\\*"));
    assert!(!glob_match("a\\*", "a"));
    assert!(!glob_match("a\\*", "a/*"));
    assert!(!glob_match("a\\*", "abc"));
    assert!(!glob_match("a\\*", "abd"));
    assert!(!glob_match("a\\*", "abe"));
    assert!(!glob_match("a\\*", "b"));
    assert!(!glob_match("a\\*", "bb"));
    assert!(!glob_match("a\\*", "bcd"));
    assert!(!glob_match("a\\*", "bdir/"));
    assert!(!glob_match("a\\*", "Beware"));
    assert!(!glob_match("a\\*", "c"));
    assert!(!glob_match("a\\*", "ca"));
    assert!(!glob_match("a\\*", "cb"));
    assert!(!glob_match("a\\*", "d"));
    assert!(!glob_match("a\\*", "dd"));
    assert!(!glob_match("a\\*", "de"));

    assert!(glob_match("*q*", "aqa"));
    assert!(glob_match("*q*", "aaqaa"));
    assert!(!glob_match("*q*", "*"));
    assert!(!glob_match("*q*", "**"));
    assert!(!glob_match("*q*", "\\*"));
    assert!(!glob_match("*q*", "a"));
    assert!(!glob_match("*q*", "a/*"));
    assert!(!glob_match("*q*", "abc"));
    assert!(!glob_match("*q*", "abd"));
    assert!(!glob_match("*q*", "abe"));
    assert!(!glob_match("*q*", "b"));
    assert!(!glob_match("*q*", "bb"));
    assert!(!glob_match("*q*", "bcd"));
    assert!(!glob_match("*q*", "bdir/"));
    assert!(!glob_match("*q*", "Beware"));
    assert!(!glob_match("*q*", "c"));
    assert!(!glob_match("*q*", "ca"));
    assert!(!glob_match("*q*", "cb"));
    assert!(!glob_match("*q*", "d"));
    assert!(!glob_match("*q*", "dd"));
    assert!(!glob_match("*q*", "de"));

    assert!(glob_match("\\**", "*"));
    assert!(glob_match("\\**", "**"));
    assert!(!glob_match("\\**", "\\*"));
    assert!(!glob_match("\\**", "a"));
    assert!(!glob_match("\\**", "a/*"));
    assert!(!glob_match("\\**", "abc"));
    assert!(!glob_match("\\**", "abd"));
    assert!(!glob_match("\\**", "abe"));
    assert!(!glob_match("\\**", "b"));
    assert!(!glob_match("\\**", "bb"));
    assert!(!glob_match("\\**", "bcd"));
    assert!(!glob_match("\\**", "bdir/"));
    assert!(!glob_match("\\**", "Beware"));
    assert!(!glob_match("\\**", "c"));
    assert!(!glob_match("\\**", "ca"));
    assert!(!glob_match("\\**", "cb"));
    assert!(!glob_match("\\**", "d"));
    assert!(!glob_match("\\**", "dd"));
    assert!(!glob_match("\\**", "de"));
  }

  #[test]
  fn bash_classes() {
    assert!(!glob_match("a*[^c]", "*"));
    assert!(!glob_match("a*[^c]", "**"));
    assert!(!glob_match("a*[^c]", "\\*"));
    assert!(!glob_match("a*[^c]", "a"));
    assert!(!glob_match("a*[^c]", "a/*"));
    assert!(!glob_match("a*[^c]", "abc"));
    assert!(glob_match("a*[^c]", "abd"));
    assert!(glob_match("a*[^c]", "abe"));
    assert!(!glob_match("a*[^c]", "b"));
    assert!(!glob_match("a*[^c]", "bb"));
    assert!(!glob_match("a*[^c]", "bcd"));
    assert!(!glob_match("a*[^c]", "bdir/"));
    assert!(!glob_match("a*[^c]", "Beware"));
    assert!(!glob_match("a*[^c]", "c"));
    assert!(!glob_match("a*[^c]", "ca"));
    assert!(!glob_match("a*[^c]", "cb"));
    assert!(!glob_match("a*[^c]", "d"));
    assert!(!glob_match("a*[^c]", "dd"));
    assert!(!glob_match("a*[^c]", "de"));
    assert!(!glob_match("a*[^c]", "baz"));
    assert!(!glob_match("a*[^c]", "bzz"));
    assert!(!glob_match("a*[^c]", "BZZ"));
    assert!(!glob_match("a*[^c]", "beware"));
    assert!(!glob_match("a*[^c]", "BewAre"));

    assert!(glob_match("a[X-]b", "a-b"));
    assert!(glob_match("a[X-]b", "aXb"));

    assert!(!glob_match("[a-y]*[^c]", "*"));
    assert!(glob_match("[a-y]*[^c]", "a*"));
    assert!(!glob_match("[a-y]*[^c]", "**"));
    assert!(!glob_match("[a-y]*[^c]", "\\*"));
    assert!(!glob_match("[a-y]*[^c]", "a"));
    assert!(glob_match("[a-y]*[^c]", "a123b"));
    assert!(!glob_match("[a-y]*[^c]", "a123c"));
    assert!(glob_match("[a-y]*[^c]", "ab"));
    assert!(!glob_match("[a-y]*[^c]", "a/*"));
    assert!(!glob_match("[a-y]*[^c]", "abc"));
    assert!(glob_match("[a-y]*[^c]", "abd"));
    assert!(glob_match("[a-y]*[^c]", "abe"));
    assert!(!glob_match("[a-y]*[^c]", "b"));
    assert!(glob_match("[a-y]*[^c]", "bd"));
    assert!(glob_match("[a-y]*[^c]", "bb"));
    assert!(glob_match("[a-y]*[^c]", "bcd"));
    // assert!(glob_match("[a-y]*[^c]", "bdir/"));
    assert!(!glob_match("[a-y]*[^c]", "Beware"));
    assert!(!glob_match("[a-y]*[^c]", "c"));
    assert!(glob_match("[a-y]*[^c]", "ca"));
    assert!(glob_match("[a-y]*[^c]", "cb"));
    assert!(!glob_match("[a-y]*[^c]", "d"));
    assert!(glob_match("[a-y]*[^c]", "dd"));
    assert!(glob_match("[a-y]*[^c]", "dd"));
    assert!(glob_match("[a-y]*[^c]", "dd"));
    assert!(glob_match("[a-y]*[^c]", "de"));
    assert!(glob_match("[a-y]*[^c]", "baz"));
    assert!(glob_match("[a-y]*[^c]", "bzz"));
    assert!(glob_match("[a-y]*[^c]", "bzz"));
    // assert(!isMatch('bzz', '[a-y]*[^c]', { regex: true }));
    assert!(!glob_match("[a-y]*[^c]", "BZZ"));
    assert!(glob_match("[a-y]*[^c]", "beware"));
    assert!(!glob_match("[a-y]*[^c]", "BewAre"));

    assert!(glob_match("a\\*b/*", "a*b/ooo"));
    assert!(glob_match("a\\*?/*", "a*b/ooo"));

    assert!(!glob_match("a[b]c", "*"));
    assert!(!glob_match("a[b]c", "**"));
    assert!(!glob_match("a[b]c", "\\*"));
    assert!(!glob_match("a[b]c", "a"));
    assert!(!glob_match("a[b]c", "a/*"));
    assert!(glob_match("a[b]c", "abc"));
    assert!(!glob_match("a[b]c", "abd"));
    assert!(!glob_match("a[b]c", "abe"));
    assert!(!glob_match("a[b]c", "b"));
    assert!(!glob_match("a[b]c", "bb"));
    assert!(!glob_match("a[b]c", "bcd"));
    assert!(!glob_match("a[b]c", "bdir/"));
    assert!(!glob_match("a[b]c", "Beware"));
    assert!(!glob_match("a[b]c", "c"));
    assert!(!glob_match("a[b]c", "ca"));
    assert!(!glob_match("a[b]c", "cb"));
    assert!(!glob_match("a[b]c", "d"));
    assert!(!glob_match("a[b]c", "dd"));
    assert!(!glob_match("a[b]c", "de"));
    assert!(!glob_match("a[b]c", "baz"));
    assert!(!glob_match("a[b]c", "bzz"));
    assert!(!glob_match("a[b]c", "BZZ"));
    assert!(!glob_match("a[b]c", "beware"));
    assert!(!glob_match("a[b]c", "BewAre"));

    assert!(!glob_match("a[\"b\"]c", "*"));
    assert!(!glob_match("a[\"b\"]c", "**"));
    assert!(!glob_match("a[\"b\"]c", "\\*"));
    assert!(!glob_match("a[\"b\"]c", "a"));
    assert!(!glob_match("a[\"b\"]c", "a/*"));
    assert!(glob_match("a[\"b\"]c", "abc"));
    assert!(!glob_match("a[\"b\"]c", "abd"));
    assert!(!glob_match("a[\"b\"]c", "abe"));
    assert!(!glob_match("a[\"b\"]c", "b"));
    assert!(!glob_match("a[\"b\"]c", "bb"));
    assert!(!glob_match("a[\"b\"]c", "bcd"));
    assert!(!glob_match("a[\"b\"]c", "bdir/"));
    assert!(!glob_match("a[\"b\"]c", "Beware"));
    assert!(!glob_match("a[\"b\"]c", "c"));
    assert!(!glob_match("a[\"b\"]c", "ca"));
    assert!(!glob_match("a[\"b\"]c", "cb"));
    assert!(!glob_match("a[\"b\"]c", "d"));
    assert!(!glob_match("a[\"b\"]c", "dd"));
    assert!(!glob_match("a[\"b\"]c", "de"));
    assert!(!glob_match("a[\"b\"]c", "baz"));
    assert!(!glob_match("a[\"b\"]c", "bzz"));
    assert!(!glob_match("a[\"b\"]c", "BZZ"));
    assert!(!glob_match("a[\"b\"]c", "beware"));
    assert!(!glob_match("a[\"b\"]c", "BewAre"));

    assert!(!glob_match("a[\\\\b]c", "*"));
    assert!(!glob_match("a[\\\\b]c", "**"));
    assert!(!glob_match("a[\\\\b]c", "\\*"));
    assert!(!glob_match("a[\\\\b]c", "a"));
    assert!(!glob_match("a[\\\\b]c", "a/*"));
    assert!(glob_match("a[\\\\b]c", "abc"));
    assert!(!glob_match("a[\\\\b]c", "abd"));
    assert!(!glob_match("a[\\\\b]c", "abe"));
    assert!(!glob_match("a[\\\\b]c", "b"));
    assert!(!glob_match("a[\\\\b]c", "bb"));
    assert!(!glob_match("a[\\\\b]c", "bcd"));
    assert!(!glob_match("a[\\\\b]c", "bdir/"));
    assert!(!glob_match("a[\\\\b]c", "Beware"));
    assert!(!glob_match("a[\\\\b]c", "c"));
    assert!(!glob_match("a[\\\\b]c", "ca"));
    assert!(!glob_match("a[\\\\b]c", "cb"));
    assert!(!glob_match("a[\\\\b]c", "d"));
    assert!(!glob_match("a[\\\\b]c", "dd"));
    assert!(!glob_match("a[\\\\b]c", "de"));
    assert!(!glob_match("a[\\\\b]c", "baz"));
    assert!(!glob_match("a[\\\\b]c", "bzz"));
    assert!(!glob_match("a[\\\\b]c", "BZZ"));
    assert!(!glob_match("a[\\\\b]c", "beware"));
    assert!(!glob_match("a[\\\\b]c", "BewAre"));

    assert!(!glob_match("a[\\b]c", "*"));
    assert!(!glob_match("a[\\b]c", "**"));
    assert!(!glob_match("a[\\b]c", "\\*"));
    assert!(!glob_match("a[\\b]c", "a"));
    assert!(!glob_match("a[\\b]c", "a/*"));
    assert!(!glob_match("a[\\b]c", "abc"));
    assert!(!glob_match("a[\\b]c", "abd"));
    assert!(!glob_match("a[\\b]c", "abe"));
    assert!(!glob_match("a[\\b]c", "b"));
    assert!(!glob_match("a[\\b]c", "bb"));
    assert!(!glob_match("a[\\b]c", "bcd"));
    assert!(!glob_match("a[\\b]c", "bdir/"));
    assert!(!glob_match("a[\\b]c", "Beware"));
    assert!(!glob_match("a[\\b]c", "c"));
    assert!(!glob_match("a[\\b]c", "ca"));
    assert!(!glob_match("a[\\b]c", "cb"));
    assert!(!glob_match("a[\\b]c", "d"));
    assert!(!glob_match("a[\\b]c", "dd"));
    assert!(!glob_match("a[\\b]c", "de"));
    assert!(!glob_match("a[\\b]c", "baz"));
    assert!(!glob_match("a[\\b]c", "bzz"));
    assert!(!glob_match("a[\\b]c", "BZZ"));
    assert!(!glob_match("a[\\b]c", "beware"));
    assert!(!glob_match("a[\\b]c", "BewAre"));

    assert!(!glob_match("a[b-d]c", "*"));
    assert!(!glob_match("a[b-d]c", "**"));
    assert!(!glob_match("a[b-d]c", "\\*"));
    assert!(!glob_match("a[b-d]c", "a"));
    assert!(!glob_match("a[b-d]c", "a/*"));
    assert!(glob_match("a[b-d]c", "abc"));
    assert!(!glob_match("a[b-d]c", "abd"));
    assert!(!glob_match("a[b-d]c", "abe"));
    assert!(!glob_match("a[b-d]c", "b"));
    assert!(!glob_match("a[b-d]c", "bb"));
    assert!(!glob_match("a[b-d]c", "bcd"));
    assert!(!glob_match("a[b-d]c", "bdir/"));
    assert!(!glob_match("a[b-d]c", "Beware"));
    assert!(!glob_match("a[b-d]c", "c"));
    assert!(!glob_match("a[b-d]c", "ca"));
    assert!(!glob_match("a[b-d]c", "cb"));
    assert!(!glob_match("a[b-d]c", "d"));
    assert!(!glob_match("a[b-d]c", "dd"));
    assert!(!glob_match("a[b-d]c", "de"));
    assert!(!glob_match("a[b-d]c", "baz"));
    assert!(!glob_match("a[b-d]c", "bzz"));
    assert!(!glob_match("a[b-d]c", "BZZ"));
    assert!(!glob_match("a[b-d]c", "beware"));
    assert!(!glob_match("a[b-d]c", "BewAre"));

    assert!(!glob_match("a?c", "*"));
    assert!(!glob_match("a?c", "**"));
    assert!(!glob_match("a?c", "\\*"));
    assert!(!glob_match("a?c", "a"));
    assert!(!glob_match("a?c", "a/*"));
    assert!(glob_match("a?c", "abc"));
    assert!(!glob_match("a?c", "abd"));
    assert!(!glob_match("a?c", "abe"));
    assert!(!glob_match("a?c", "b"));
    assert!(!glob_match("a?c", "bb"));
    assert!(!glob_match("a?c", "bcd"));
    assert!(!glob_match("a?c", "bdir/"));
    assert!(!glob_match("a?c", "Beware"));
    assert!(!glob_match("a?c", "c"));
    assert!(!glob_match("a?c", "ca"));
    assert!(!glob_match("a?c", "cb"));
    assert!(!glob_match("a?c", "d"));
    assert!(!glob_match("a?c", "dd"));
    assert!(!glob_match("a?c", "de"));
    assert!(!glob_match("a?c", "baz"));
    assert!(!glob_match("a?c", "bzz"));
    assert!(!glob_match("a?c", "BZZ"));
    assert!(!glob_match("a?c", "beware"));
    assert!(!glob_match("a?c", "BewAre"));

    assert!(glob_match("*/man*/bash.*", "man/man1/bash.1"));

    assert!(glob_match("[^a-c]*", "*"));
    assert!(glob_match("[^a-c]*", "**"));
    assert!(!glob_match("[^a-c]*", "a"));
    assert!(!glob_match("[^a-c]*", "a/*"));
    assert!(!glob_match("[^a-c]*", "abc"));
    assert!(!glob_match("[^a-c]*", "abd"));
    assert!(!glob_match("[^a-c]*", "abe"));
    assert!(!glob_match("[^a-c]*", "b"));
    assert!(!glob_match("[^a-c]*", "bb"));
    assert!(!glob_match("[^a-c]*", "bcd"));
    assert!(!glob_match("[^a-c]*", "bdir/"));
    assert!(glob_match("[^a-c]*", "Beware"));
    assert!(glob_match("[^a-c]*", "Beware"));
    assert!(!glob_match("[^a-c]*", "c"));
    assert!(!glob_match("[^a-c]*", "ca"));
    assert!(!glob_match("[^a-c]*", "cb"));
    assert!(glob_match("[^a-c]*", "d"));
    assert!(glob_match("[^a-c]*", "dd"));
    assert!(glob_match("[^a-c]*", "de"));
    assert!(!glob_match("[^a-c]*", "baz"));
    assert!(!glob_match("[^a-c]*", "bzz"));
    assert!(glob_match("[^a-c]*", "BZZ"));
    assert!(!glob_match("[^a-c]*", "beware"));
    assert!(glob_match("[^a-c]*", "BewAre"));
  }

  #[test]
  fn bash_wildmatch() {
    assert!(!glob_match("a[]-]b", "aab"));
    assert!(!glob_match("[ten]", "ten"));
    assert!(glob_match("]", "]"));
    assert!(glob_match("a[]-]b", "a-b"));
    assert!(glob_match("a[]-]b", "a]b"));
    assert!(glob_match("a[]]b", "a]b"));
    assert!(glob_match("a[\\]a\\-]b", "aab"));
    assert!(glob_match("t[a-g]n", "ten"));
    assert!(glob_match("t[^a-g]n", "ton"));
  }

  #[test]
  fn bash_slashmatch() {
    // assert!(!glob_match("f[^eiu][^eiu][^eiu][^eiu][^eiu]r", "foo/bar"));
    assert!(glob_match("foo[/]bar", "foo/bar"));
    assert!(glob_match("f[^eiu][^eiu][^eiu][^eiu][^eiu]r", "foo-bar"));
  }

  #[test]
  fn bash_extra_stars() {
    assert!(!glob_match("a**c", "bbc"));
    assert!(glob_match("a**c", "abc"));
    assert!(!glob_match("a**c", "bbd"));

    assert!(!glob_match("a***c", "bbc"));
    assert!(glob_match("a***c", "abc"));
    assert!(!glob_match("a***c", "bbd"));

    assert!(!glob_match("a*****?c", "bbc"));
    assert!(glob_match("a*****?c", "abc"));
    assert!(!glob_match("a*****?c", "bbc"));

    assert!(glob_match("?*****??", "bbc"));
    assert!(glob_match("?*****??", "abc"));

    assert!(glob_match("*****??", "bbc"));
    assert!(glob_match("*****??", "abc"));

    assert!(glob_match("?*****?c", "bbc"));
    assert!(glob_match("?*****?c", "abc"));

    assert!(glob_match("?***?****c", "bbc"));
    assert!(glob_match("?***?****c", "abc"));
    assert!(!glob_match("?***?****c", "bbd"));

    assert!(glob_match("?***?****?", "bbc"));
    assert!(glob_match("?***?****?", "abc"));

    assert!(glob_match("?***?****", "bbc"));
    assert!(glob_match("?***?****", "abc"));

    assert!(glob_match("*******c", "bbc"));
    assert!(glob_match("*******c", "abc"));

    assert!(glob_match("*******?", "bbc"));
    assert!(glob_match("*******?", "abc"));

    assert!(glob_match("a*cd**?**??k", "abcdecdhjk"));
    assert!(glob_match("a**?**cd**?**??k", "abcdecdhjk"));
    assert!(glob_match("a**?**cd**?**??k***", "abcdecdhjk"));
    assert!(glob_match("a**?**cd**?**??***k", "abcdecdhjk"));
    assert!(glob_match("a**?**cd**?**??***k**", "abcdecdhjk"));
    assert!(glob_match("a****c**?**??*****", "abcdecdhjk"));
  }

  #[test]
  fn globstars() {
    assert!(glob_match("**/*.js", "a/b/c/d.js"));
    assert!(glob_match("**/*.js", "a/b/c.js"));
    assert!(glob_match("**/*.js", "a/b.js"));
    assert!(glob_match("a/b/**/*.js", "a/b/c/d/e/f.js"));
    assert!(glob_match("a/b/**/*.js", "a/b/c/d/e.js"));
    assert!(glob_match("a/b/c/**/*.js", "a/b/c/d.js"));
    assert!(glob_match("a/b/**/*.js", "a/b/c/d.js"));
    assert!(glob_match("a/b/**/*.js", "a/b/d.js"));
    assert!(!glob_match("a/b/**/*.js", "a/d.js"));
    assert!(!glob_match("a/b/**/*.js", "d.js"));

    // println!(
    //   "{:?} {:?}",
    //   glob::Pattern::new("a**/b").unwrap().matches("a/b"),
    //   glob_match("a**/b", "a/b")
    // );

    assert!(!glob_match("**c", "a/b/c"));
    assert!(!glob_match("a/**c", "a/b/c"));
    assert!(!glob_match("a/**z", "a/b/c"));
    assert!(!glob_match("a/**b**/c", "a/b/c/b/c"));
    assert!(!glob_match("a/b/c**/*.js", "a/b/c/d/e.js"));
    assert!(glob_match("a/**/b/**/c", "a/b/c/b/c"));
    assert!(glob_match("a/**b**/c", "a/aba/c"));
    assert!(glob_match("a/**b**/c", "a/b/c"));
    assert!(glob_match("a/b/c**/*.js", "a/b/c/d.js"));

    assert!(!glob_match("a/**/*", "a"));
    assert!(!glob_match("a/**/**/*", "a"));
    assert!(!glob_match("a/**/**/**/*", "a"));
    assert!(!glob_match("**/a", "a/"));
    // assert!(!glob_match("a/**/*", "a/"));
    // assert!(!glob_match("a/**/**/*", "a/"));
    // assert!(!glob_match("a/**/**/**/*", "a/"));
    assert!(!glob_match("**/a", "a/b"));
    assert!(!glob_match("a/**/j/**/z/*.md", "a/b/c/j/e/z/c.txt"));
    assert!(!glob_match("a/**/b", "a/bb"));
    assert!(!glob_match("**/a", "a/c"));
    assert!(!glob_match("**/a", "a/b"));
    assert!(!glob_match("**/a", "a/x/y"));
    assert!(!glob_match("**/a", "a/b/c/d"));
    assert!(glob_match("**", "a"));
    // assert!(glob_match("**/a", "a"));
    // assert!(glob_match("a/**", "a"));
    assert!(glob_match("**", "a/"));
    // assert!(glob_match("**/a/**", "a/"));
    assert!(glob_match("a/**", "a/"));
    // assert!(glob_match("a/**/**", "a/"));
    assert!(glob_match("**/a", "a/a"));
    assert!(glob_match("**", "a/b"));
    assert!(glob_match("*/*", "a/b"));
    assert!(glob_match("a/**", "a/b"));
    assert!(glob_match("a/**/*", "a/b"));
    assert!(glob_match("a/**/**/*", "a/b"));
    assert!(glob_match("a/**/**/**/*", "a/b"));
    assert!(glob_match("a/**/b", "a/b"));
    assert!(glob_match("**", "a/b/c"));
    assert!(glob_match("**/*", "a/b/c"));
    assert!(glob_match("**/**", "a/b/c"));
    assert!(glob_match("*/**", "a/b/c"));
    assert!(glob_match("a/**", "a/b/c"));
    assert!(glob_match("a/**/*", "a/b/c"));
    assert!(glob_match("a/**/**/*", "a/b/c"));
    assert!(glob_match("a/**/**/**/*", "a/b/c"));
    assert!(glob_match("**", "a/b/c/d"));
    assert!(glob_match("a/**", "a/b/c/d"));
    assert!(glob_match("a/**/*", "a/b/c/d"));
    assert!(glob_match("a/**/**/*", "a/b/c/d"));
    assert!(glob_match("a/**/**/**/*", "a/b/c/d"));
    assert!(glob_match("a/b/**/c/**/*.*", "a/b/c/d.e"));
    assert!(glob_match("a/**/f/*.md", "a/b/c/d/e/f/g.md"));
    assert!(glob_match("a/**/f/**/k/*.md", "a/b/c/d/e/f/g/h/i/j/k/l.md"));
    assert!(glob_match("a/b/c/*.md", "a/b/c/def.md"));
    assert!(glob_match("a/*/c/*.md", "a/bb.bb/c/ddd.md"));
    assert!(glob_match("a/**/f/*.md", "a/bb.bb/cc/d.d/ee/f/ggg.md"));
    assert!(glob_match("a/**/f/*.md", "a/bb.bb/cc/dd/ee/f/ggg.md"));
    assert!(glob_match("a/*/c/*.md", "a/bb/c/ddd.md"));
    assert!(glob_match("a/*/c/*.md", "a/bbbb/c/ddd.md"));

    assert!(glob_match(
      "foo/bar/**/one/**/*.*",
      "foo/bar/baz/one/image.png"
    ));
    assert!(glob_match(
      "foo/bar/**/one/**/*.*",
      "foo/bar/baz/one/two/image.png"
    ));
    assert!(glob_match(
      "foo/bar/**/one/**/*.*",
      "foo/bar/baz/one/two/three/image.png"
    ));
    assert!(!glob_match("a/b/**/f", "a/b/c/d/"));
    // assert!(glob_match("a/**", "a"));
    assert!(glob_match("**", "a"));
    // assert!(glob_match("a{,/**}", "a"));
    assert!(glob_match("**", "a/"));
    assert!(glob_match("a/**", "a/"));
    assert!(glob_match("**", "a/b/c/d"));
    assert!(glob_match("**", "a/b/c/d/"));
    assert!(glob_match("**/**", "a/b/c/d/"));
    assert!(glob_match("**/b/**", "a/b/c/d/"));
    assert!(glob_match("a/b/**", "a/b/c/d/"));
    assert!(glob_match("a/b/**/", "a/b/c/d/"));
    assert!(glob_match("a/b/**/c/**/", "a/b/c/d/"));
    assert!(glob_match("a/b/**/c/**/d/", "a/b/c/d/"));
    assert!(glob_match("a/b/**/**/*.*", "a/b/c/d/e.f"));
    assert!(glob_match("a/b/**/*.*", "a/b/c/d/e.f"));
    assert!(glob_match("a/b/**/c/**/d/*.*", "a/b/c/d/e.f"));
    assert!(glob_match("a/b/**/d/**/*.*", "a/b/c/d/e.f"));
    assert!(glob_match("a/b/**/d/**/*.*", "a/b/c/d/g/e.f"));
    assert!(glob_match("a/b/**/d/**/*.*", "a/b/c/d/g/g/e.f"));
    assert!(glob_match("a/b-*/**/z.js", "a/b-c/z.js"));
    assert!(glob_match("a/b-*/**/z.js", "a/b-c/d/e/z.js"));

    assert!(glob_match("*/*", "a/b"));
    assert!(glob_match("a/b/c/*.md", "a/b/c/xyz.md"));
    assert!(glob_match("a/*/c/*.md", "a/bb.bb/c/xyz.md"));
    assert!(glob_match("a/*/c/*.md", "a/bb/c/xyz.md"));
    assert!(glob_match("a/*/c/*.md", "a/bbbb/c/xyz.md"));

    assert!(glob_match("**/*", "a/b/c"));
    assert!(glob_match("**/**", "a/b/c"));
    assert!(glob_match("*/**", "a/b/c"));
    assert!(glob_match("a/**/j/**/z/*.md", "a/b/c/d/e/j/n/p/o/z/c.md"));
    assert!(glob_match("a/**/z/*.md", "a/b/c/d/e/z/c.md"));
    assert!(glob_match("a/**/c/*.md", "a/bb.bb/aa/b.b/aa/c/xyz.md"));
    assert!(glob_match("a/**/c/*.md", "a/bb.bb/aa/bb/aa/c/xyz.md"));
    assert!(!glob_match("a/**/j/**/z/*.md", "a/b/c/j/e/z/c.txt"));
    assert!(!glob_match("a/b/**/c{d,e}/**/xyz.md", "a/b/c/xyz.md"));
    assert!(!glob_match("a/b/**/c{d,e}/**/xyz.md", "a/b/d/xyz.md"));
    // assert!(!glob_match("a/**/", "a/b"));
    // assert!(!glob_match("**/*", "a/b/.js/c.txt"));
    // assert!(!glob_match("a/**/", "a/b/c/d"));
    // assert!(!glob_match("a/**/", "a/bb"));
    // assert!(!glob_match("a/**/", "a/cb"));
    assert!(glob_match("/**", "/a/b"));
    assert!(glob_match("**/*", "a.b"));
    assert!(glob_match("**/*", "a.js"));
    assert!(glob_match("**/*.js", "a.js"));
    assert!(glob_match("a/**/", "a/"));
    assert!(glob_match("**/*.js", "a/a.js"));
    assert!(glob_match("**/*.js", "a/a/b.js"));
    assert!(glob_match("a/**/b", "a/b"));
    assert!(glob_match("a/**b", "a/b"));
    assert!(glob_match("**/*.md", "a/b.md"));
    assert!(glob_match("**/*", "a/b/c.js"));
    assert!(glob_match("**/*", "a/b/c.txt"));
    assert!(glob_match("a/**/", "a/b/c/d/"));
    assert!(glob_match("**/*", "a/b/c/d/a.js"));
    assert!(glob_match("a/b/**/*.js", "a/b/c/z.js"));
    assert!(glob_match("a/b/**/*.js", "a/b/z.js"));
    assert!(glob_match("**/*", "ab"));
    assert!(glob_match("**/*", "ab/c"));
    assert!(glob_match("**/*", "ab/c/d"));
    assert!(glob_match("**/*", "abc.js"));

    // assert!(!glob_match("**/", "a"));
    assert!(!glob_match("**/a/*", "a"));
    assert!(!glob_match("**/a/*/*", "a"));
    assert!(!glob_match("*/a/**", "a"));
    assert!(!glob_match("a/**/*", "a"));
    assert!(!glob_match("a/**/**/*", "a"));
    // assert!(!glob_match("**/", "a/b"));
    assert!(!glob_match("**/b/*", "a/b"));
    assert!(!glob_match("**/b/*/*", "a/b"));
    assert!(!glob_match("b/**", "a/b"));
    // assert!(!glob_match("**/", "a/b/c"));
    assert!(!glob_match("**/**/b", "a/b/c"));
    assert!(!glob_match("**/b", "a/b/c"));
    assert!(!glob_match("**/b/*/*", "a/b/c"));
    assert!(!glob_match("b/**", "a/b/c"));
    // assert!(!glob_match("**/", "a/b/c/d"));
    assert!(!glob_match("**/d/*", "a/b/c/d"));
    assert!(!glob_match("b/**", "a/b/c/d"));
    assert!(glob_match("**", "a"));
    assert!(glob_match("**/**", "a"));
    assert!(glob_match("**/**/*", "a"));
    // assert!(glob_match("**/**/a", "a"));
    // assert!(glob_match("**/a", "a"));
    // assert!(glob_match("**/a/**", "a"));
    // assert!(glob_match("a/**", "a"));
    assert!(glob_match("**", "a/b"));
    assert!(glob_match("**/**", "a/b"));
    assert!(glob_match("**/**/*", "a/b"));
    assert!(glob_match("**/**/b", "a/b"));
    assert!(glob_match("**/b", "a/b"));
    // assert!(glob_match("**/b/**", "a/b"));
    // assert!(glob_match("*/b/**", "a/b"));
    assert!(glob_match("a/**", "a/b"));
    assert!(glob_match("a/**/*", "a/b"));
    assert!(glob_match("a/**/**/*", "a/b"));
    assert!(glob_match("**", "a/b/c"));
    assert!(glob_match("**/**", "a/b/c"));
    assert!(glob_match("**/**/*", "a/b/c"));
    assert!(glob_match("**/b/*", "a/b/c"));
    assert!(glob_match("**/b/**", "a/b/c"));
    assert!(glob_match("*/b/**", "a/b/c"));
    assert!(glob_match("a/**", "a/b/c"));
    assert!(glob_match("a/**/*", "a/b/c"));
    assert!(glob_match("a/**/**/*", "a/b/c"));
    assert!(glob_match("**", "a/b/c/d"));
    assert!(glob_match("**/**", "a/b/c/d"));
    assert!(glob_match("**/**/*", "a/b/c/d"));
    assert!(glob_match("**/**/d", "a/b/c/d"));
    assert!(glob_match("**/b/**", "a/b/c/d"));
    assert!(glob_match("**/b/*/*", "a/b/c/d"));
    assert!(glob_match("**/d", "a/b/c/d"));
    assert!(glob_match("*/b/**", "a/b/c/d"));
    assert!(glob_match("a/**", "a/b/c/d"));
    assert!(glob_match("a/**/*", "a/b/c/d"));
    assert!(glob_match("a/**/**/*", "a/b/c/d"));
  }

  #[test]
  fn utf8() {
    assert!(glob_match("フ*/**/*", "フォルダ/aaa.js"));
    assert!(glob_match("フォ*/**/*", "フォルダ/aaa.js"));
    assert!(glob_match("フォル*/**/*", "フォルダ/aaa.js"));
    assert!(glob_match("フ*ル*/**/*", "フォルダ/aaa.js"));
    assert!(glob_match("フォルダ/**/*", "フォルダ/aaa.js"));
  }

  #[test]
  fn negation() {
    assert!(!glob_match("!*", "abc"));
    assert!(!glob_match("!abc", "abc"));
    assert!(!glob_match("*!.md", "bar.md"));
    assert!(!glob_match("foo!.md", "bar.md"));
    assert!(!glob_match("\\!*!*.md", "foo!.md"));
    assert!(!glob_match("\\!*!*.md", "foo!bar.md"));
    assert!(glob_match("*!*.md", "!foo!.md"));
    assert!(glob_match("\\!*!*.md", "!foo!.md"));
    assert!(glob_match("!*foo", "abc"));
    assert!(glob_match("!foo*", "abc"));
    assert!(glob_match("!xyz", "abc"));
    assert!(glob_match("*!*.*", "ba!r.js"));
    assert!(glob_match("*.md", "bar.md"));
    assert!(glob_match("*!*.*", "foo!.md"));
    assert!(glob_match("*!*.md", "foo!.md"));
    assert!(glob_match("*!.md", "foo!.md"));
    assert!(glob_match("*.md", "foo!.md"));
    assert!(glob_match("foo!.md", "foo!.md"));
    assert!(glob_match("*!*.md", "foo!bar.md"));
    assert!(glob_match("*b*.md", "foobar.md"));

    assert!(!glob_match("a!!b", "a"));
    assert!(!glob_match("a!!b", "aa"));
    assert!(!glob_match("a!!b", "a/b"));
    assert!(!glob_match("a!!b", "a!b"));
    assert!(glob_match("a!!b", "a!!b"));
    assert!(!glob_match("a!!b", "a/!!/b"));

    assert!(!glob_match("!a/b", "a/b"));
    assert!(glob_match("!a/b", "a"));
    assert!(glob_match("!a/b", "a.b"));
    assert!(glob_match("!a/b", "a/a"));
    assert!(glob_match("!a/b", "a/c"));
    assert!(glob_match("!a/b", "b/a"));
    assert!(glob_match("!a/b", "b/b"));
    assert!(glob_match("!a/b", "b/c"));

    assert!(!glob_match("!abc", "abc"));
    assert!(glob_match("!!abc", "abc"));
    assert!(!glob_match("!!!abc", "abc"));
    assert!(glob_match("!!!!abc", "abc"));
    assert!(!glob_match("!!!!!abc", "abc"));
    assert!(glob_match("!!!!!!abc", "abc"));
    assert!(!glob_match("!!!!!!!abc", "abc"));
    assert!(glob_match("!!!!!!!!abc", "abc"));

    // assert!(!glob_match("!(*/*)", "a/a"));
    // assert!(!glob_match("!(*/*)", "a/b"));
    // assert!(!glob_match("!(*/*)", "a/c"));
    // assert!(!glob_match("!(*/*)", "b/a"));
    // assert!(!glob_match("!(*/*)", "b/b"));
    // assert!(!glob_match("!(*/*)", "b/c"));
    // assert!(!glob_match("!(*/b)", "a/b"));
    // assert!(!glob_match("!(*/b)", "b/b"));
    // assert!(!glob_match("!(a/b)", "a/b"));
    assert!(!glob_match("!*", "a"));
    assert!(!glob_match("!*", "a.b"));
    assert!(!glob_match("!*/*", "a/a"));
    assert!(!glob_match("!*/*", "a/b"));
    assert!(!glob_match("!*/*", "a/c"));
    assert!(!glob_match("!*/*", "b/a"));
    assert!(!glob_match("!*/*", "b/b"));
    assert!(!glob_match("!*/*", "b/c"));
    assert!(!glob_match("!*/b", "a/b"));
    assert!(!glob_match("!*/b", "b/b"));
    assert!(!glob_match("!*/c", "a/c"));
    assert!(!glob_match("!*/c", "a/c"));
    assert!(!glob_match("!*/c", "b/c"));
    assert!(!glob_match("!*/c", "b/c"));
    assert!(!glob_match("!*a*", "bar"));
    assert!(!glob_match("!*a*", "fab"));
    // assert!(!glob_match("!a/(*)", "a/a"));
    // assert!(!glob_match("!a/(*)", "a/b"));
    // assert!(!glob_match("!a/(*)", "a/c"));
    // assert!(!glob_match("!a/(b)", "a/b"));
    assert!(!glob_match("!a/*", "a/a"));
    assert!(!glob_match("!a/*", "a/b"));
    assert!(!glob_match("!a/*", "a/c"));
    assert!(!glob_match("!f*b", "fab"));
    // assert!(glob_match("!(*/*)", "a"));
    // assert!(glob_match("!(*/*)", "a.b"));
    // assert!(glob_match("!(*/b)", "a"));
    // assert!(glob_match("!(*/b)", "a.b"));
    // assert!(glob_match("!(*/b)", "a/a"));
    // assert!(glob_match("!(*/b)", "a/c"));
    // assert!(glob_match("!(*/b)", "b/a"));
    // assert!(glob_match("!(*/b)", "b/c"));
    // assert!(glob_match("!(a/b)", "a"));
    // assert!(glob_match("!(a/b)", "a.b"));
    // assert!(glob_match("!(a/b)", "a/a"));
    // assert!(glob_match("!(a/b)", "a/c"));
    // assert!(glob_match("!(a/b)", "b/a"));
    // assert!(glob_match("!(a/b)", "b/b"));
    // assert!(glob_match("!(a/b)", "b/c"));
    assert!(glob_match("!*", "a/a"));
    assert!(glob_match("!*", "a/b"));
    assert!(glob_match("!*", "a/c"));
    assert!(glob_match("!*", "b/a"));
    assert!(glob_match("!*", "b/b"));
    assert!(glob_match("!*", "b/c"));
    assert!(glob_match("!*/*", "a"));
    assert!(glob_match("!*/*", "a.b"));
    assert!(glob_match("!*/b", "a"));
    assert!(glob_match("!*/b", "a.b"));
    assert!(glob_match("!*/b", "a/a"));
    assert!(glob_match("!*/b", "a/c"));
    assert!(glob_match("!*/b", "b/a"));
    assert!(glob_match("!*/b", "b/c"));
    assert!(glob_match("!*/c", "a"));
    assert!(glob_match("!*/c", "a.b"));
    assert!(glob_match("!*/c", "a/a"));
    assert!(glob_match("!*/c", "a/b"));
    assert!(glob_match("!*/c", "b/a"));
    assert!(glob_match("!*/c", "b/b"));
    assert!(glob_match("!*a*", "foo"));
    // assert!(glob_match("!a/(*)", "a"));
    // assert!(glob_match("!a/(*)", "a.b"));
    // assert!(glob_match("!a/(*)", "b/a"));
    // assert!(glob_match("!a/(*)", "b/b"));
    // assert!(glob_match("!a/(*)", "b/c"));
    // assert!(glob_match("!a/(b)", "a"));
    // assert!(glob_match("!a/(b)", "a.b"));
    // assert!(glob_match("!a/(b)", "a/a"));
    // assert!(glob_match("!a/(b)", "a/c"));
    // assert!(glob_match("!a/(b)", "b/a"));
    // assert!(glob_match("!a/(b)", "b/b"));
    // assert!(glob_match("!a/(b)", "b/c"));
    assert!(glob_match("!a/*", "a"));
    assert!(glob_match("!a/*", "a.b"));
    assert!(glob_match("!a/*", "b/a"));
    assert!(glob_match("!a/*", "b/b"));
    assert!(glob_match("!a/*", "b/c"));
    assert!(glob_match("!f*b", "bar"));
    assert!(glob_match("!f*b", "foo"));

    assert!(!glob_match("!.md", ".md"));
    assert!(glob_match("!**/*.md", "a.js"));
    // assert!(!glob_match("!**/*.md", "b.md"));
    assert!(glob_match("!**/*.md", "c.txt"));
    assert!(glob_match("!*.md", "a.js"));
    assert!(!glob_match("!*.md", "b.md"));
    assert!(glob_match("!*.md", "c.txt"));
    assert!(!glob_match("!*.md", "abc.md"));
    assert!(glob_match("!*.md", "abc.txt"));
    assert!(!glob_match("!*.md", "foo.md"));
    assert!(glob_match("!.md", "foo.md"));

    assert!(glob_match("!*.md", "a.js"));
    assert!(glob_match("!*.md", "b.txt"));
    assert!(!glob_match("!*.md", "c.md"));
    assert!(!glob_match("!a/*/a.js", "a/a/a.js"));
    assert!(!glob_match("!a/*/a.js", "a/b/a.js"));
    assert!(!glob_match("!a/*/a.js", "a/c/a.js"));
    assert!(!glob_match("!a/*/*/a.js", "a/a/a/a.js"));
    assert!(glob_match("!a/*/*/a.js", "b/a/b/a.js"));
    assert!(glob_match("!a/*/*/a.js", "c/a/c/a.js"));
    assert!(!glob_match("!a/a*.txt", "a/a.txt"));
    assert!(glob_match("!a/a*.txt", "a/b.txt"));
    assert!(glob_match("!a/a*.txt", "a/c.txt"));
    assert!(!glob_match("!a.a*.txt", "a.a.txt"));
    assert!(glob_match("!a.a*.txt", "a.b.txt"));
    assert!(glob_match("!a.a*.txt", "a.c.txt"));
    assert!(!glob_match("!a/*.txt", "a/a.txt"));
    assert!(!glob_match("!a/*.txt", "a/b.txt"));
    assert!(!glob_match("!a/*.txt", "a/c.txt"));

    assert!(glob_match("!*.md", "a.js"));
    assert!(glob_match("!*.md", "b.txt"));
    assert!(!glob_match("!*.md", "c.md"));
    // assert!(!glob_match("!**/a.js", "a/a/a.js"));
    // assert!(!glob_match("!**/a.js", "a/b/a.js"));
    // assert!(!glob_match("!**/a.js", "a/c/a.js"));
    assert!(glob_match("!**/a.js", "a/a/b.js"));
    assert!(!glob_match("!a/**/a.js", "a/a/a/a.js"));
    assert!(glob_match("!a/**/a.js", "b/a/b/a.js"));
    assert!(glob_match("!a/**/a.js", "c/a/c/a.js"));
    assert!(glob_match("!**/*.md", "a/b.js"));
    assert!(glob_match("!**/*.md", "a.js"));
    assert!(!glob_match("!**/*.md", "a/b.md"));
    // assert!(!glob_match("!**/*.md", "a.md"));
    assert!(!glob_match("**/*.md", "a/b.js"));
    assert!(!glob_match("**/*.md", "a.js"));
    assert!(glob_match("**/*.md", "a/b.md"));
    assert!(glob_match("**/*.md", "a.md"));
    assert!(glob_match("!**/*.md", "a/b.js"));
    assert!(glob_match("!**/*.md", "a.js"));
    assert!(!glob_match("!**/*.md", "a/b.md"));
    // assert!(!glob_match("!**/*.md", "a.md"));
    assert!(glob_match("!*.md", "a/b.js"));
    assert!(glob_match("!*.md", "a.js"));
    assert!(glob_match("!*.md", "a/b.md"));
    assert!(!glob_match("!*.md", "a.md"));
    assert!(glob_match("!**/*.md", "a.js"));
    // assert!(!glob_match("!**/*.md", "b.md"));
    assert!(glob_match("!**/*.md", "c.txt"));
  }
}
