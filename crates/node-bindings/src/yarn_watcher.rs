use std::collections::{HashMap, HashSet};

use regex::Regex;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct YarnLockEntry {
  version: String,
}

type PackageVersions = HashMap<String, HashSet<String>>;

fn extract_yarn_metadata(yarn_lock_contents: &str) -> PackageVersions {
  let yarn_lock: HashMap<String, YarnLockEntry> = serde_yaml::from_str(yarn_lock_contents).unwrap();

  let mut package_versions: PackageVersions = HashMap::new();

  let yarn_lock_entry_re = Regex::new(r"(.+?)@npm:+").unwrap();

  for (key, value) in &yarn_lock {
    if key == "__metadata" || value.version == "0.0.0-use.local" {
      continue;
    }

    if let Some(captures) = yarn_lock_entry_re.captures(key) {
      assert_eq!(captures.len(), 2, "Should find a single capture");

      let package = captures.get(1).unwrap().as_str();

      if let Some(versions) = package_versions.get_mut(package) {
        versions.insert(value.version.to_owned());
      } else {
        let versions = HashSet::from_iter(vec![value.version.to_owned()]);
        package_versions.insert(package.to_owned(), versions);
      }
    }
  }

  package_versions
}

fn diff_package_versions(a: &PackageVersions, b: &PackageVersions) -> Vec<String> {
  let mut diff = Vec::new();

  for (package, versions) in a {
    if let Some(b_versions) = b.get(package) {
      if versions != b_versions {
        diff.push(package.to_owned());
      }
    } else {
      diff.push(package.to_owned());
    }
  }

  for package in b.keys() {
    if !a.contains_key(package) {
      diff.push(package.to_owned());
    }
  }

  diff
}

#[cfg(test)]
mod tests {
  use super::*;

  macro_rules! assert_eq_package_versions {
    ($m: expr, $match: expr) => {{
      let mut map = HashMap::new();
      for pair in $m {
        map.insert(pair.0, pair.1);
      }
      assert_eq!(map, $match);
    }};
  }

  macro_rules! map(
    { $($key:expr => $value:expr),* } => {
      {
        #[allow(unused_mut)]
        let mut m = HashMap::new();
        $(
          m.insert($key.into(), $value.into_iter().map(|v| v.into()).collect());
        )*
        m
      }
    };
  );

  #[test]
  fn get_package_versions() {
    let yarn_lock = r#"
    __metadata:
        version: 6
        cacheKey: 8

    "@aashutoshrathi/word-wrap@npm:^1.2.3":
        version: 1.2.6
        resolution: "@aashutoshrathi/word-wrap@npm:1.2.6::__archiveUrl=https%3A%2F%2Fpackages.atlassian.com%2Fapi%2Fnpm%2Fnpm-remote%2F%40aashutoshrathi%2Fword-wrap%2F-%2Fword-wrap-1.2.6.tgz"
        checksum: ada901b9e7c680d190f1d012c84217ce0063d8f5c5a7725bb91ec3c5ed99bb7572680eb2d2938a531ccbaec39a95422fcd8a6b4a13110c7d98dd75402f66a0cd
        languageName: node
        linkType: hard
    "#;

    assert_eq_package_versions!(
      extract_yarn_metadata(yarn_lock),
      map! {
        "@aashutoshrathi/word-wrap" => vec!["1.2.6"]
      }
    )
  }

  #[test]
  fn ignore_local_versions() {
    let yarn_lock = r#"
    __metadata:
        version: 6
        cacheKey: 8

    "@aashutoshrathi/word-wrap@npm:^1.2.3":
        version: 1.2.6
        resolution: "@aashutoshrathi/word-wrap@npm:1.2.6::__archiveUrl=https%3A%2F%2Fpackages.atlassian.com%2Fapi%2Fnpm%2Fnpm-remote%2F%40aashutoshrathi%2Fword-wrap%2F-%2Fword-wrap-1.2.6.tgz"
        checksum: ada901b9e7c680d190f1d012c84217ce0063d8f5c5a7725bb91ec3c5ed99bb7572680eb2d2938a531ccbaec39a95422fcd8a6b4a13110c7d98dd75402f66a0cd
        languageName: node
        linkType: hard

    "some-package@npm:^1.2.3":
        version: 0.0.0-use.local
        resolution: "some-package@npm:1.2.6::__archiveUrl=https%3A%2F%2Fpackages.atlassian.com%2Fapi%2Fnpm%2Fnpm-remote%2F%40aashutoshrathi%2Fword-wrap%2F-%2Fword-wrap-1.2.6.tgz"
        checksum: ada901b9e7c680d190f1d012c84217ce0063d8f5c5a7725bb91ec3c5ed99bb7572680eb2d2938a531ccbaec39a95422fcd8a6b4a13110c7d98dd75402f66a0cd
        languageName: node
        linkType: hard
    "#;

    assert_eq_package_versions!(
      extract_yarn_metadata(yarn_lock),
      map! {
        "@aashutoshrathi/word-wrap" => vec!["1.2.6"]
      }
    )
  }

  #[test]
  fn multiple_versions() {
    let yarn_lock = r#"
    __metadata:
        version: 6
        cacheKey: 8

    "some-package@npm:^1.0.0":
        version: 1.0.0
        resolution: "some-package@npm:1.2.6::__archiveUrl=https%3A%2F%2Fpackages.atlassian.com%2Fapi%2Fnpm%2Fnpm-remote%2F%40aashutoshrathi%2Fword-wrap%2F-%2Fword-wrap-1.2.6.tgz"
        checksum: ada901b9e7c680d190f1d012c84217ce0063d8f5c5a7725bb91ec3c5ed99bb7572680eb2d2938a531ccbaec39a95422fcd8a6b4a13110c7d98dd75402f66a0cd
        languageName: node
        linkType: hard

    "some-package@npm:^1.2.3":
        version: 1.2.3
        resolution: "some-package@npm:1.2.6::__archiveUrl=https%3A%2F%2Fpackages.atlassian.com%2Fapi%2Fnpm%2Fnpm-remote%2F%40aashutoshrathi%2Fword-wrap%2F-%2Fword-wrap-1.2.6.tgz"
        checksum: ada901b9e7c680d190f1d012c84217ce0063d8f5c5a7725bb91ec3c5ed99bb7572680eb2d2938a531ccbaec39a95422fcd8a6b4a13110c7d98dd75402f66a0cd
        languageName: node
        linkType: hard
    "#;

    assert_eq_package_versions!(
      extract_yarn_metadata(yarn_lock),
      map! {
        "some-package" => vec!["1.0.0", "1.2.3"]
      }
    )
  }

  #[test]
  fn keys_with_multiple_declarations() {
    let yarn_lock = r#"
    __metadata:
        version: 6
        cacheKey: 8

    "@apollo/react-components@npm:^3.1.2, @apollo/react-components@npm:^3.1.3, @apollo/react-components@npm:^3.1.5":
        version: 3.1.5
        resolution: "@apollo/react-components@npm:3.1.5::__archiveUrl=https%3A%2F%2Fpackages.atlassian.com%2Fapi%2Fnpm%2Fnpm-remote%2F%40apollo%2Freact-components%2F-%2Freact-components-3.1.5.tgz"
        checksum: a96911fa191d99398cc565a69789529eca255a8f24c888b1c2f3c1b72c8f2ba41bc818bff70f04993f6788353c0cb72ab35dcf024aaf5f46b07b1bd82b75f4f7
        languageName: node
        linkType: hard
    "#;

    assert_eq_package_versions!(
      extract_yarn_metadata(yarn_lock),
      map! {
        "@apollo/react-components" => vec!["3.1.5"]
      }
    )
  }

  #[test]
  fn diff_with_bump() {
    assert_eq!(
      diff_package_versions(
        &map! {
          "some-package" => vec!["1.0.0"],
          "unchanged-package" => vec!["2.0.0"]
        },
        &map! {
          "some-package" => vec!["1.2.3"],
          "unchanged-package" => vec!["2.0.0"]
        }
      ),
      vec!["some-package"]
    )
  }

  #[test]
  fn diff_with_addition() {
    assert_eq!(
      diff_package_versions(
        &map! {
          "some-package" => vec!["1.0.0"],
          "unchanged-package" => vec!["2.0.0"]
        },
        &map! {
          "some-package" => vec!["1.0.0", "1.2.3"],
          "unchanged-package" => vec!["2.0.0"],
          "new-package" => vec!["3.0.0"]
        }
      ),
      vec!["some-package", "new-package"]
    )
  }

  #[test]
  fn diff_with_removal() {
    assert_eq!(
      diff_package_versions(
        &map! {
          "some-package" => vec!["1.0.0", "1.2.3"],
          "unchanged-package" => vec!["2.0.0"],
          "removed-package" => vec!["3.0.0"]
        },
        &map! {
          "some-package" => vec!["1.0.0"],
          "unchanged-package" => vec!["2.0.0"]
        },
      ),
      vec!["some-package", "removed-package"]
    )
  }
}
