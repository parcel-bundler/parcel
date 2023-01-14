use std::path::is_separator;

pub fn glob_match(glob: &str, path: &str) -> bool {
  // This algorithm is based on https://research.swtch.com/glob
  let glob = glob.as_bytes();
  let path = path.as_bytes();
  let mut glob_index = 0;
  let mut path_index = 0;
  let mut next_glob_index = 0;
  let mut next_path_index = 0;
  let mut allow_sep = true;

  while glob_index < glob.len() || path_index < path.len() {
    if glob_index < glob.len() {
      match glob[glob_index] {
        b'*' => {
          next_glob_index = glob_index;
          next_path_index = path_index + 1;
          glob_index += 1;
          allow_sep = glob_index < glob.len() && glob[glob_index] == b'*';
          if allow_sep {
            glob_index += 1;
          }
          continue;
        }
        b'?' if path_index < path.len() => {
          glob_index += 1;
          path_index += 1;
          continue;
        }
        b'[' if path_index < path.len() => {
          glob_index += 1;
          let c = path[path_index];
          let mut negated = false;
          if glob_index < glob.len() && glob[glob_index] == b'^' {
            negated = true;
            glob_index += 1;
          }

          let mut is_match = false;
          while glob_index < glob.len() && glob[glob_index] != b']' {
            // TODO: unescape
            let low = glob[glob_index];
            glob_index += 1;

            let high = if glob_index + 1 < glob.len() && glob[glob_index] == b'-' {
              let high = glob[glob_index + 1];
              glob_index += 2;
              high
            } else {
              low
            };

            if low <= c && c <= high {
              is_match = true;
            }
          }
          if glob_index < glob.len() && glob[glob_index] != b']' {
            // invalid pattern!
            return false;
          }
          glob_index += 1;
          if is_match != negated {
            path_index += 1;
            continue;
          }
        }
        c if path_index < path.len() => {
          // println!("{} {} {:?}", path[path_index] as char, c as char, allow_sep);
          if path[path_index] == c {
            if !allow_sep && is_separator(path[path_index] as char) {
              next_path_index = 0;
              // allow_sep = true;
            }

            glob_index += 1;
            path_index += 1;
            continue;
          }
        }
        _ => {}
      }
    }

    if next_path_index > 0 && next_path_index <= path.len() {
      glob_index = next_glob_index;
      path_index = next_path_index;
      continue;
    }

    return false;
  }

  true
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test() {
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

    assert!(glob_match("[abc]", "a"));
    assert!(glob_match("[abc]", "b"));
    assert!(glob_match("[abc]", "c"));
    assert!(!glob_match("[abc]", "d"));
    assert!(glob_match("x[abc]x", "xax"));
    assert!(glob_match("x[abc]x", "xbx"));
    assert!(glob_match("x[abc]x", "xcx"));
    assert!(!glob_match("x[abc]x", "xdx"));
    assert!(!glob_match("x[abc]x", "xay"));

    assert!(glob_match("[a-cx]", "a"));
    assert!(glob_match("[a-cx]", "b"));
    assert!(glob_match("[a-cx]", "c"));
    assert!(!glob_match("[a-cx]", "d"));
    assert!(glob_match("[a-cx]", "x"));

    assert!(!glob_match("[^abc]", "a"));
    assert!(!glob_match("[^abc]", "b"));
    assert!(!glob_match("[^abc]", "c"));
    assert!(glob_match("[^abc]", "d"));

    assert!(glob_match("a*b*[cy]*d*e*", "axbxcxdxexxx"));
    assert!(glob_match("a*b*[cy]*d*e*", "axbxyxdxexxx"));
    assert!(glob_match("a*b*[cy]*d*e*", "axbxxxyxdxexxx"));
  }
}
