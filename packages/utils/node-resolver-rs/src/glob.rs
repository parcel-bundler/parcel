// use std::path::is_separator;

#[derive(Clone, Copy, Debug, Default)]
struct State {
  // These store character indices into the glob and path strings.
  path_index: usize,
  glob_index: usize,

  // When we hit a * or **, we store the state for backtracking.
  next_glob_index: usize,
  next_path_index: usize,

  // These flags are for * and ** matching.
  // allow_sep indicates that path separators are allowed (only in **).
  // needs_sep indicates that a path separator is needed following a ** pattern.
  // saw_globstar indicates that we previously saw a ** pattern.
  allow_sep: bool,
  needs_sep: bool,
  saw_globstar: bool,
}

pub fn glob_match(glob: &str, path: &str) -> bool {
  // This algorithm is based on https://research.swtch.com/glob
  let glob = glob.as_bytes();
  let path = path.as_bytes();

  let mut state = State::default();

  // Store the state when we see an opening '{' brace in a stack.
  // Up to 10 nested braces are supported.
  let mut brace_stack = [State::default(); 10];
  let mut brace_ptr = 0;
  let mut longest_brace_match = 0;

  // First, check if the pattern is negated with a leading '!' character.
  // Multiple negations can occur.
  let mut negated = false;
  while state.glob_index < glob.len() && glob[state.glob_index] == b'!' {
    negated = !negated;
    state.glob_index += 1;
  }

  while state.glob_index < glob.len() || state.path_index < path.len() {
    // println!(
    //   "{:?} {:?} {:?}",
    //   glob_index,
    //   glob.get(glob_index).map(|c| *c as char),
    //   path.get(path_index).map(|c| *c as char)
    // );
    if !state.allow_sep && state.path_index < path.len() && is_separator(path[state.path_index]) {
      state.next_path_index = 0;
      state.allow_sep = true;
    }

    if state.glob_index < glob.len() {
      match glob[state.glob_index] {
        b'*' => {
          state.next_glob_index = state.glob_index;
          state.next_path_index = state.path_index + 1;
          state.glob_index += 1;

          state.allow_sep = state.saw_globstar;
          state.needs_sep = false;

          // ** allows path separators, whereas * does not.
          // However, ** must be a full path component, i.e. a/**/b not a**b.
          if state.glob_index < glob.len() && glob[state.glob_index] == b'*' {
            state.glob_index += 1;
            if glob.len() == state.glob_index {
              state.allow_sep = true;
            } else if (state.glob_index < 3 || is_separator(glob[state.glob_index - 3]))
              && is_separator(glob[state.glob_index])
            {
              // Matched a full /**/ segment. Skip the ending / so we search for the following character.
              // In effect, this makes the whole segment optional so that a/**/b matches a/b.
              state.glob_index += 1;

              // The allows_sep flag allows separator characters in ** matches.
              // The needs_sep flag ensures that the character just before the next matching
              // one is a '/', which prevents a/**/b from matching a/bb.
              state.allow_sep = true;
              state.needs_sep = true;
            }
          }
          if state.allow_sep {
            state.saw_globstar = true;
          }

          // If the next char is a special brace separator,
          // skip to the end of the braces so we don't try to match it.
          if brace_ptr > 0
            && state.glob_index < glob.len()
            && matches!(glob[state.glob_index], b',' | b'}')
          {
            if !skip_braces(glob, &mut state.glob_index) {
              // invalid pattern!
              return false;
            }
          }
          continue;
        }
        b'?' if state.path_index < path.len() => {
          if !is_separator(path[state.path_index]) {
            state.glob_index += 1;
            state.path_index += 1;
            continue;
          }
        }
        b'[' if state.path_index < path.len() => {
          state.glob_index += 1;
          let c = path[state.path_index];
          let mut negated = false;
          if state.glob_index < glob.len() && matches!(glob[state.glob_index], b'^' | b'!') {
            negated = true;
            state.glob_index += 1;
          }

          let start = state.glob_index;
          let mut is_match = false;
          while state.glob_index < glob.len()
            && (state.glob_index == start || glob[state.glob_index] != b']')
          {
            let mut low = glob[state.glob_index];
            if !unescape(&mut low, glob, &mut state.glob_index) {
              // Invalid pattern!
              return false;
            }
            state.glob_index += 1;

            let high = if state.glob_index + 1 < glob.len()
              && glob[state.glob_index] == b'-'
              && glob[state.glob_index + 1] != b']'
            {
              state.glob_index += 1;
              let mut high = glob[state.glob_index];
              if !unescape(&mut high, glob, &mut state.glob_index) {
                // Invalid pattern!
                return false;
              }
              state.glob_index += 1;
              high
            } else {
              low
            };

            if low <= c && c <= high {
              is_match = true;
            }
          }
          if state.glob_index < glob.len() && glob[state.glob_index] != b']' {
            // invalid pattern!
            return false;
          }
          state.glob_index += 1;
          if is_match != negated {
            state.path_index += 1;
            continue;
          }
        }
        b'{' if state.path_index < path.len() => {
          if brace_ptr >= brace_stack.len() {
            // Invalid pattern! Too many nested braces.
            return false;
          }

          // Push old state to the stack, and reset current state.
          brace_stack[brace_ptr] = state;
          brace_ptr += 1;
          state = State {
            path_index: state.path_index,
            glob_index: state.glob_index + 1,
            ..State::default()
          };
          continue;
        }
        b'}' if brace_ptr > 0 => {
          // If we hit the end of the braces, we matched the last option.
          brace_ptr -= 1;
          state.glob_index += 1;
          if state.path_index < longest_brace_match {
            state.path_index = longest_brace_match;
          }
          if brace_ptr == 0 {
            longest_brace_match = 0;
          }
          continue;
        }
        b',' if brace_ptr > 0 => {
          // If we hit a comma, we matched one of the options!
          // But we still need to check the others in case there is a longer match.
          if state.path_index > longest_brace_match {
            longest_brace_match = state.path_index;
          }
          state.path_index = brace_stack[brace_ptr - 1].path_index;
          state.glob_index += 1;
          continue;
        }
        mut c if state.path_index < path.len() => {
          // Match escaped characters as literals.
          if !unescape(&mut c, glob, &mut state.glob_index) {
            // Invalid pattern!
            return false;
          }

          if path[state.path_index] == c
            && (!state.needs_sep
              || (state.path_index > 0 && is_separator(path[state.path_index - 1])))
          {
            state.glob_index += 1;
            state.path_index += 1;
            state.needs_sep = false;
            state.saw_globstar = false;
            continue;
          }
        }
        _ => {}
      }
    }

    // println!(
    //   "MISMATCH {:?} {:?} {:?} {:?} {:?}",
    //   glob_index,
    //   path_index,
    //   glob.get(glob_index).map(|c| *c as char),
    //   path.get(path_index).map(|c| *c as char),
    //   brace_stack
    // );

    // If we didn't match, restore state to the previous star pattern.
    if state.next_path_index > 0 && state.next_path_index <= path.len() {
      state.glob_index = state.next_glob_index;
      state.path_index = state.next_path_index;
      continue;
    }

    if brace_ptr > 0 {
      // If in braces, find next option and reset path to index where we saw the '{'
      let mut idx = state.glob_index;
      let mut found_next = false;
      let mut braces = 1;
      while idx < glob.len() {
        match glob[idx] {
          b',' if braces == 1 => {
            // Start matching from here.
            state.glob_index = idx + 1;
            state.path_index = brace_stack[brace_ptr - 1].path_index;
            found_next = true;
            break;
          }
          b'{' => {
            // Skip nested braces.
            braces += 1;
            idx += 1;
          }
          b'}' => {
            braces -= 1;
            idx += 1;
            if braces == 0 {
              break;
            }
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

      if braces != 0 {
        // Invalid pattern!
        return false;
      }

      // Hit the end. Pop the stack.
      brace_ptr -= 1;

      // If we matched a previous option, use that.
      if longest_brace_match > 0 {
        state = State {
          glob_index: idx,
          path_index: longest_brace_match,
          // Since we matched, preserve these flags.
          allow_sep: state.allow_sep,
          needs_sep: state.needs_sep,
          saw_globstar: state.saw_globstar,
          // But restore star state if needed later.
          next_glob_index: brace_stack[brace_ptr].next_glob_index,
          next_path_index: brace_stack[brace_ptr].next_path_index,
        };
        continue;
      } else {
        // Didn't match. Restore state, and check if we need to jump back to a star pattern.
        state = brace_stack[brace_ptr];
        if state.next_path_index > 0 && state.next_path_index <= path.len() {
          state.glob_index = state.next_glob_index;
          state.path_index = state.next_path_index;
          continue;
        }
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
  let mut braces = 0;
  while *glob_index < glob.len() {
    match glob[*glob_index] {
      // Skip nested braces.
      b'{' => braces += 1,
      b'}' => {
        if braces > 0 {
          braces -= 1;
        } else {
          break;
        }
      }
      _ => {}
    }
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
    assert!(glob_match(
      "some/**/needle.{js,tsx,mdx,ts,jsx,txt}",
      "some/a/bigger/path/to/the/crazy/needle.txt"
    ));
    assert!(glob_match(
      "some/**/{a,b,c}/**/needle.txt",
      "some/foo/a/bigger/path/to/the/crazy/needle.txt"
    ));
    assert!(!glob_match(
      "some/**/{a,b,c}/**/needle.txt",
      "some/foo/d/bigger/path/to/the/crazy/needle.txt"
    ));
    assert!(glob_match("a/{a{a,b},b}", "a/aa"));
    assert!(glob_match("a/{a{a,b},b}", "a/ab"));
    assert!(!glob_match("a/{a{a,b},b}", "a/ac"));
    assert!(glob_match("a/{a{a,b},b}", "a/b"));
    assert!(!glob_match("a/{a{a,b},b}", "a/c"));
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

  #[test]
  fn braces() {
    assert!(glob_match("{a,b,c}", "a"));
    assert!(glob_match("{a,b,c}", "b"));
    assert!(glob_match("{a,b,c}", "c"));
    assert!(!glob_match("{a,b,c}", "aa"));
    assert!(!glob_match("{a,b,c}", "bb"));
    assert!(!glob_match("{a,b,c}", "cc"));

    assert!(glob_match("a/{a,b}", "a/a"));
    assert!(glob_match("a/{a,b}", "a/b"));
    assert!(!glob_match("a/{a,b}", "a/c"));
    assert!(!glob_match("a/{a,b}", "b/b"));
    assert!(!glob_match("a/{a,b,c}", "b/b"));
    assert!(glob_match("a/{a,b,c}", "a/c"));
    assert!(glob_match("a{b,bc}.txt", "abc.txt"));

    assert!(glob_match("foo[{a,b}]baz", "foo{baz"));

    assert!(!glob_match("a{,b}.txt", "abc.txt"));
    assert!(!glob_match("a{a,b,}.txt", "abc.txt"));
    assert!(!glob_match("a{b,}.txt", "abc.txt"));
    assert!(glob_match("a{,b}.txt", "a.txt"));
    assert!(glob_match("a{b,}.txt", "a.txt"));
    assert!(glob_match("a{a,b,}.txt", "aa.txt"));
    assert!(glob_match("a{a,b,}.txt", "aa.txt"));
    assert!(glob_match("a{,b}.txt", "ab.txt"));
    assert!(glob_match("a{b,}.txt", "ab.txt"));

    // assert!(glob_match("{a/,}a/**", "a"));
    assert!(glob_match("a{a,b/}*.txt", "aa.txt"));
    assert!(glob_match("a{a,b/}*.txt", "ab/.txt"));
    assert!(glob_match("a{a,b/}*.txt", "ab/a.txt"));
    // assert!(glob_match("{a/,}a/**", "a/"));
    assert!(glob_match("{a/,}a/**", "a/a/"));
    // assert!(glob_match("{a/,}a/**", "a/a"));
    assert!(glob_match("{a/,}a/**", "a/a/a"));
    assert!(glob_match("{a/,}a/**", "a/a/"));
    assert!(glob_match("{a/,}a/**", "a/a/a/"));
    assert!(glob_match("{a/,}b/**", "a/b/a/"));
    assert!(glob_match("{a/,}b/**", "b/a/"));
    assert!(glob_match("a{,/}*.txt", "a.txt"));
    assert!(glob_match("a{,/}*.txt", "ab.txt"));
    assert!(glob_match("a{,/}*.txt", "a/b.txt"));
    assert!(glob_match("a{,/}*.txt", "a/ab.txt"));

    assert!(glob_match("a{,.*{foo,db},\\(bar\\)}.txt", "a.txt"));
    assert!(!glob_match("a{,.*{foo,db},\\(bar\\)}.txt", "adb.txt"));
    assert!(glob_match("a{,.*{foo,db},\\(bar\\)}.txt", "a.db.txt"));

    assert!(glob_match("a{,*.{foo,db},\\(bar\\)}.txt", "a.txt"));
    assert!(!glob_match("a{,*.{foo,db},\\(bar\\)}.txt", "adb.txt"));
    assert!(glob_match("a{,*.{foo,db},\\(bar\\)}.txt", "a.db.txt"));

    // assert!(glob_match("a{,.*{foo,db},\\(bar\\)}", "a"));
    assert!(!glob_match("a{,.*{foo,db},\\(bar\\)}", "adb"));
    assert!(glob_match("a{,.*{foo,db},\\(bar\\)}", "a.db"));

    // assert!(glob_match("a{,*.{foo,db},\\(bar\\)}", "a"));
    assert!(!glob_match("a{,*.{foo,db},\\(bar\\)}", "adb"));
    assert!(glob_match("a{,*.{foo,db},\\(bar\\)}", "a.db"));

    assert!(!glob_match("{,.*{foo,db},\\(bar\\)}", "a"));
    assert!(!glob_match("{,.*{foo,db},\\(bar\\)}", "adb"));
    assert!(!glob_match("{,.*{foo,db},\\(bar\\)}", "a.db"));
    assert!(glob_match("{,.*{foo,db},\\(bar\\)}", ".db"));

    assert!(!glob_match("{,*.{foo,db},\\(bar\\)}", "a"));
    assert!(glob_match("{*,*.{foo,db},\\(bar\\)}", "a"));
    assert!(!glob_match("{,*.{foo,db},\\(bar\\)}", "adb"));
    assert!(glob_match("{,*.{foo,db},\\(bar\\)}", "a.db"));

    assert!(!glob_match("a/b/**/c{d,e}/**/xyz.md", "a/b/c/xyz.md"));
    assert!(!glob_match("a/b/**/c{d,e}/**/xyz.md", "a/b/d/xyz.md"));
    assert!(glob_match("a/b/**/c{d,e}/**/xyz.md", "a/b/cd/xyz.md"));
    assert!(glob_match("a/b/**/{c,d,e}/**/xyz.md", "a/b/c/xyz.md"));
    assert!(glob_match("a/b/**/{c,d,e}/**/xyz.md", "a/b/d/xyz.md"));

    assert!(glob_match("*{a,b}*", "xax"));
    assert!(glob_match("*{a,b}*", "xxax"));
    assert!(glob_match("*{a,b}*", "xbx"));

    assert!(glob_match("*{*a,b}", "xba"));
    assert!(glob_match("*{*a,b}", "xb"));
  }
}
