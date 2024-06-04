use std::path::Path;

use glob_match::glob_match;

pub fn named_pattern_matcher<'a>(path: &'a Path) -> impl Fn(&str, &str) -> bool + 'a {
  let basename = path.file_name().unwrap().to_str().unwrap();
  let path = path.as_os_str().to_str().unwrap();

  |pattern, pipeline| {
    let (named_pipeline, pattern) = pattern.split_once(':').unwrap_or(("", pattern));
    pipeline == named_pipeline && (glob_match(pattern, basename) || glob_match(pattern, path))
  }
}

pub fn pattern_matcher<'a>(path: &'a Path) -> impl Fn(&str) -> bool + 'a {
  let is_match = named_pattern_matcher(path);

  move |pattern| is_match(pattern, "")
}

#[cfg(test)]
mod tests {
  use std::env;
  use std::path::PathBuf;

  use super::*;

  fn paths(filename: &str) -> Vec<PathBuf> {
    let cwd = env::current_dir().unwrap();
    vec![
      PathBuf::from(filename),
      cwd.join(filename),
      cwd.join("src").join(filename),
    ]
  }

  mod named_pattern_matcher {
    use super::*;

    #[test]
    fn returns_false_when_path_does_not_match_pattern_with_empty_pipeline() {
      for path in paths("a.ts") {
        let is_match = named_pattern_matcher(&path);

        assert_eq!(is_match("*.t", ""), false);
        assert_eq!(is_match("*.tsx", ""), false);
        assert_eq!(is_match("types:*.{ts,tsx}", ""), false);
        assert_eq!(is_match("url:*", ""), false);
      }
    }

    #[test]
    fn returns_false_when_path_does_not_match_pipeline() {
      for path in paths("a.ts") {
        let is_match = named_pattern_matcher(&path);

        assert_eq!(is_match("types:*.{ts,tsx}", "type"), false);
        assert_eq!(is_match("types:*.{ts,tsx}", "typesa"), false);
      }
    }

    #[test]
    fn returns_true_when_path_matches_pattern_with_empty_pipeline() {
      for path in paths("a.ts") {
        let is_match = named_pattern_matcher(&path);

        assert_eq!(is_match("*.{ts,tsx}", ""), true);
        assert_eq!(is_match("*.ts", ""), true);
        assert_eq!(is_match("*", ""), true);
      }
    }

    #[test]
    fn returns_true_when_path_matches_pattern_and_pipeline() {
      for path in paths("a.ts") {
        let is_match = named_pattern_matcher(&path);

        assert_eq!(is_match("types:*.{ts,tsx}", "types"), true);
        assert_eq!(is_match("types:*.ts", "types"), true);
        assert_eq!(is_match("types:*", "types"), true);
      }
    }
  }

  mod pattern_matcher {
    use super::*;

    #[test]
    fn returns_false_when_path_does_not_match_pattern() {
      for path in paths("a.ts") {
        let is_match = pattern_matcher(&path);

        assert_eq!(is_match("*.t"), false);
        assert_eq!(is_match("*.tsx"), false);
        assert_eq!(is_match("types:*.{ts,tsx}"), false);
        assert_eq!(is_match("url:*"), false);
      }
    }

    #[test]
    fn returns_true_when_path_matches_pattern_with_empty_pipeline() {
      for path in paths("a.ts") {
        let is_match = pattern_matcher(&path);

        assert_eq!(is_match("*.{ts,tsx}"), true);
        assert_eq!(is_match("*.ts"), true);
        assert_eq!(is_match("*"), true);
      }
    }
  }
}
