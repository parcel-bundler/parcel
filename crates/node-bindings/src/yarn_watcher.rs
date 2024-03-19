use std::collections::HashMap;

use regex::Regex;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct YarnLockEntry {
  version: String,
}

type PackageVersions = HashMap<String, Vec<String>>;

fn extract_yarn_metadata(yarn_lock_contents: &str) -> PackageVersions {
  let yarn_lock: HashMap<String, YarnLockEntry> = serde_yaml::from_str(yarn_lock_contents).unwrap();

  let mut package_versions: PackageVersions = HashMap::new();

  let yarn_lock_entry_re = Regex::new(r"(.+)@npm:.+").unwrap();

  for (key, value) in &yarn_lock {
    if key == "__metadata" || value.version == "0.0.0-use.local" {
      continue;
    }

    if let Some(captures) = yarn_lock_entry_re.captures(key) {
      assert_eq!(captures.len(), 2, "Should find a single capture");

      let package = captures.get(1).unwrap().as_str();

      if let Some(versions) = package_versions.get_mut(package) {
        versions.push(value.version.to_owned());
      } else {
        let versions = vec![value.version.to_owned()];
        package_versions.insert(package.to_owned(), versions);
      }
    }
  }

  package_versions
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
  fn can_extract_package_versions() {
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

    "react@npm:^2.0.0":
        version: 2.0.0
        resolution: "@aashutoshrathi/word-wrap@npm:1.2.6::__archiveUrl=https%3A%2F%2Fpackages.atlassian.com%2Fapi%2Fnpm%2Fnpm-remote%2F%40aashutoshrathi%2Fword-wrap%2F-%2Fword-wrap-1.2.6.tgz"
        checksum: ada901b9e7c680d190f1d012c84217ce0063d8f5c5a7725bb91ec3c5ed99bb7572680eb2d2938a531ccbaec39a95422fcd8a6b4a13110c7d98dd75402f66a0cd
        languageName: node
        linkType: hard

    "react@npm:^3.0.0":
        version: 3.2.1
        resolution: "@aashutoshrathi/word-wrap@npm:1.2.6::__archiveUrl=https%3A%2F%2Fpackages.atlassian.com%2Fapi%2Fnpm%2Fnpm-remote%2F%40aashutoshrathi%2Fword-wrap%2F-%2Fword-wrap-1.2.6.tgz"
        checksum: ada901b9e7c680d190f1d012c84217ce0063d8f5c5a7725bb91ec3c5ed99bb7572680eb2d2938a531ccbaec39a95422fcd8a6b4a13110c7d98dd75402f66a0cd
        languageName: node
        linkType: hard

    "@af/git-utils@workspace:*, @af/git-utils@workspace:platform/build/monorepo-utils/git-utils":
        version: 0.0.0-use.local
        resolution: "@af/git-utils@workspace:platform/build/monorepo-utils/git-utils"
        dependencies:
            simple-git: ^3.16.0
        languageName: unknown
        linkType: soft
    "#;

    assert_eq_package_versions!(
      extract_yarn_metadata(yarn_lock),
      map! {
        "@aashutoshrathi/word-wrap" => vec!["1.2.6"],
        "react" => vec!["2.0.0", "3.2.1"]
      }
    )
  }
}
