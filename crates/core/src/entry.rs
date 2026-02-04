use std::{
  path::{Path, PathBuf},
  sync::Arc,
};

use glob_match::glob_match;
use serde_json::Value;

use crate::{
  BuildMode, Engines, Environment, EnvironmentContext, EnvironmentFlags, FileKind, FileSystem,
  OutputFormat, ParcelOptions, SourceLocation, SourceType, SourceUrl, Target, Version,
};

#[derive(Debug, PartialEq)]
pub struct Entry {
  pub url: SourceUrl,
  pub target: Target,
  pub asset: Option<usize>,
  pub loc: Option<SourceLocation>,
}

pub fn resolve_entries(entries: Vec<String>, options: &ParcelOptions) -> Vec<Entry> {
  let mut resolved_entries = Vec::new();
  for entry in entries {
    for path in glob(&*options.input_fs, &entry) {
      if options.input_fs.kind(&path).contains(FileKind::IS_DIR) {
        resolved_entries.extend(resolve_package_entries(&*options.input_fs, path));
      } else {
        let mut flags = EnvironmentFlags::empty();
        flags.set(
          EnvironmentFlags::SHOULD_OPTIMIZE,
          options.mode == BuildMode::Production,
        );
        resolved_entries.push(Entry {
          url: SourceUrl::from_path(&path).unwrap(),
          target: Target {
            env: Arc::new(Environment {
              flags,
              ..Default::default()
            }),
            ..Default::default()
          },
          loc: None,
          asset: None,
        });
      }
    }
  }

  resolved_entries
}

fn resolve_package_entries(fs: &dyn FileSystem, dir: PathBuf) -> Vec<Entry> {
  let pkg_path = dir.join("package.json");
  let contents = fs.read(&pkg_path).unwrap();
  let json: Value = serde_json::from_slice(&contents).unwrap();
  let mut entries = Vec::new();

  if let Some(exports) = json.get("exports") {
    extract_exports(
      &dir,
      &json,
      exports,
      None,
      ExportsCondition::empty(),
      &mut entries,
    );
  } else if let Some(Value::String(source)) = json.get("source") {
    for (field, cond) in &[
      ("main", ExportsCondition::DEFAULT),
      ("module", ExportsCondition::MODULE),
      ("browser", ExportsCondition::BROWSER),
      ("types", ExportsCondition::TYPES),
    ] {
      if let Some(Value::String(main)) = json.get(field) {
        entries.push(Entry {
          url: SourceUrl::from_path(&dir.join(source)).unwrap(),
          target: Target {
            name: field.to_string(),
            dist_entry: Some(main.clone()),
            dist_dir: SourceUrl::from_path(&dir).unwrap(),
            env: Arc::new(cond.to_env(&json, main)),
            ..Default::default()
          },
          asset: None,
          loc: None,
        });
      }
    }

    if entries.is_empty() {
      entries.push(Entry {
        url: SourceUrl::from_path(&dir.join(source)).unwrap(),
        target: Target {
          dist_entry: None,
          dist_dir: SourceUrl::from_path(&dir).unwrap(),
          env: Arc::new(Default::default()),
          ..Default::default()
        },
        asset: None,
        loc: None,
      });
    }
  }

  entries
}

bitflags::bitflags! {
  #[derive(Clone, Copy, Debug)]
  /// A common package.json "exports" field.
  pub struct ExportsCondition: u32 {
    /// The "import" condition. True when the package was referenced using the ESM `import` syntax.
    const IMPORT = 1 << 0;
    /// The "require" condition. True when the package was referenced using the CommonJS `require` function.
    const REQUIRE = 1 << 1;
    /// The "module" condition. True when the package was referenced from either the ESM `import` syntax or the CommonJS `require` function/
    const MODULE = 1 << 2;
    /// The "node" condition. True when the module will run in a Node environment.
    const NODE = 1 << 3;
    /// The "browser" condition. True when the module will run in a browser environment.
    const BROWSER = 1 << 4;
    /// The "worker" condition. True when the module will run in a web worker or service worker environment.
    const WORKER = 1 << 5;
    /// The "worklet" condition. True when the module will run in a worklet environment.
    const WORKLET = 1 << 6;
    /// The "electron" condition. True when the module will run in an Electron environment.
    const ELECTRON = 1 << 7;
    /// The "development" condition. True when the module will run in a development environment.
    const DEVELOPMENT = 1 << 8;
    /// The "production" condition. True when the module will run in a production environment.
    const PRODUCTION = 1 << 9;
    /// The "types" condition. True when loading TypeScript types.
    const TYPES = 1 << 10;
    /// The "default" condition when no other conditions matched.
    const DEFAULT = 1 << 11;
    /// The "style" condition. True when the package was referenced from a stylesheet (e.g. CSS, Sass, Stylus, etc.).
    const STYLE = 1 << 12;
    /// The "sass" condition. True when the package was referenced from a Sass stylesheet.
    const SASS = 1 << 13;
    /// The "less" condition. True when the package was referenced from a Less stylesheet.
    const LESS = 1 << 14;
    /// The "stylus" condition. True when the package was referenced from a Stylus stylesheet.
    const STYLUS = 1 << 15;
    /// The "react-server" condition.
    const REACT_SERVER = 1 << 16;
    /// The "source" condition.
    const SOURCE = 1 << 17;
  }
}

impl TryFrom<&str> for ExportsCondition {
  type Error = ();
  fn try_from(value: &str) -> Result<Self, Self::Error> {
    Ok(match value {
      "import" => ExportsCondition::IMPORT,
      "require" => ExportsCondition::REQUIRE,
      "module" => ExportsCondition::MODULE,
      "node" => ExportsCondition::NODE,
      "browser" => ExportsCondition::BROWSER,
      "worker" => ExportsCondition::WORKER,
      "worklet" => ExportsCondition::WORKLET,
      "electron" => ExportsCondition::ELECTRON,
      "development" => ExportsCondition::DEVELOPMENT,
      "production" => ExportsCondition::PRODUCTION,
      "types" => ExportsCondition::TYPES,
      "default" => ExportsCondition::DEFAULT,
      "style" => ExportsCondition::STYLE,
      "sass" => ExportsCondition::SASS,
      "less" => ExportsCondition::LESS,
      "stylus" => ExportsCondition::STYLUS,
      "react-server" => ExportsCondition::REACT_SERVER,
      "source" => ExportsCondition::SOURCE,
      _ => return Err(()),
    })
  }
}

impl ExportsCondition {
  fn to_env(&self, pkg: &Value, entry: &str) -> Environment {
    let engines = pkg.get("engines");
    let context = if self.contains(ExportsCondition::REACT_SERVER) {
      EnvironmentContext::ReactServer
    } else if self.contains(ExportsCondition::ELECTRON) {
      if self.contains(ExportsCondition::NODE) {
        EnvironmentContext::ElectronMain
      } else {
        EnvironmentContext::ElectronRenderer
      }
    } else if self.contains(ExportsCondition::NODE) {
      EnvironmentContext::Node
    } else if self.contains(ExportsCondition::WORKER) {
      EnvironmentContext::WebWorker
    } else if self.contains(ExportsCondition::WORKLET) {
      EnvironmentContext::Worklet
    } else if self.contains(ExportsCondition::BROWSER) {
      EnvironmentContext::Browser
    } else if engines.and_then(|e| e.get("node")).is_some() {
      EnvironmentContext::Node
    } else {
      EnvironmentContext::Browser
    };

    let output_format = if entry.ends_with(".mjs") {
      OutputFormat::Esmodule
    } else if entry.ends_with(".cjs") {
      OutputFormat::Commonjs
    } else if let Some(Value::String(ty)) = pkg.get("type") {
      if ty == "module" {
        OutputFormat::Esmodule
      } else {
        OutputFormat::Commonjs
      }
    } else if context.is_node() {
      OutputFormat::Commonjs
    } else {
      OutputFormat::Esmodule
    };

    Environment {
      context,
      output_format,
      source_type: SourceType::Module,
      flags: EnvironmentFlags::IS_LIBRARY,
      source_map: None,
      loc: None,
      // TODO: include devDependencies but exclude dependencies and peerDependencies for libraries
      include_node_modules: if context.is_node() {
        crate::IncludeNodeModules::Bool(false)
      } else {
        crate::IncludeNodeModules::Bool(true)
      },
      engines: if context.is_browser() {
        if let Some(Value::String(browsers)) = engines.and_then(|e| e.get("browsers")) {
          Engines::from_browserslist(browsers, output_format)
        } else if let Some(Value::String(browsers)) = pkg.get("browserslist") {
          Engines::from_browserslist(browsers, output_format)
        } else {
          Default::default()
        }
      } else if context.is_electron() {
        if let Some(Value::String(version)) = engines.and_then(|e| e.get("electron")) {
          Engines {
            electron: Version::from_semver_range(version).ok(),
            ..Default::default()
          }
        } else {
          Default::default()
        }
      } else if context.is_node() {
        if let Some(Value::String(version)) = engines.and_then(|e| e.get("node")) {
          Engines {
            node: Version::from_semver_range(version).ok(),
            ..Default::default()
          }
        } else {
          Default::default()
        }
      } else {
        Default::default()
      },
    }
  }
}

fn extract_exports(
  dir: &Path,
  pkg: &serde_json::Value,
  value: &serde_json::Value,
  source: Option<SourceUrl>,
  condition: ExportsCondition,
  entries: &mut Vec<Entry>,
) {
  if let Value::Object(exports) = value {
    let source = if let Some(Value::String(source)) = value.get("source") {
      Some(SourceUrl::from_path(&dir.join(source)).unwrap())
    } else {
      source
    };

    for (key, value) in exports {
      if key == "source" {
        continue;
      }

      let cond = if !key.starts_with('.') {
        condition | ExportsCondition::try_from(key.as_str()).unwrap_or(ExportsCondition::empty())
      } else {
        condition
      };
      extract_exports(dir, pkg, value, source.clone(), cond, entries);
    }
  } else if let Value::String(value) = value {
    if value.starts_with('.') {
      if let Some(source) = source {
        entries.push(Entry {
          url: source,
          target: Target {
            dist_dir: SourceUrl::from_path(dir).unwrap(),
            dist_entry: Some(value.clone()),
            env: Arc::new(condition.to_env(pkg, &value)),
            ..Default::default()
          },
          asset: None,
          loc: None,
        })
      }
    }
  }
}

fn glob(fs: &dyn FileSystem, pattern: &str) -> Vec<PathBuf> {
  if !is_glob(pattern) {
    if Path::new(pattern).exists() {
      return vec![Path::new(pattern).to_path_buf()];
    }
    return Vec::new();
  }

  let (dir, file) = pattern.rsplit_once('/').unwrap_or(("", pattern));
  let mut matches = Vec::new();

  if !is_glob(dir) {
    match_dir(fs, Path::new(dir), file, &mut matches);
  } else {
    for dir in glob(fs, dir) {
      match_dir(fs, &dir, file, &mut matches)
    }
  }

  matches
}

#[inline]
fn is_glob(pattern: &str) -> bool {
  pattern.contains(&['*', '?', '[', '{'])
}

fn match_dir(fs: &dyn FileSystem, dir_path: &Path, pattern: &str, matches: &mut Vec<PathBuf>) {
  if let Ok(entries) = fs.read_dir(dir_path) {
    let is_globstar = pattern == "**";
    if is_globstar {
      matches.push(dir_path.to_path_buf());
    }

    for entry in entries {
      if let Some(name) = entry.name.to_str() {
        if is_globstar {
          if entry.kind.contains(FileKind::IS_DIR) {
            match_dir(fs, &dir_path.join(name), pattern, matches);
          } else {
            matches.push(dir_path.join(name));
          }
        } else {
          if glob_match(pattern, name) {
            matches.push(dir_path.join(name));
          }
        }
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use crate::{
    Entry, Environment, EnvironmentContext, FileSystem, MemoryFileSystem, SourceUrl, Target,
    Version, entry::resolve_package_entries,
  };
  use std::{
    num::NonZero,
    path::{Path, PathBuf},
    sync::Arc,
  };

  fn test(input: &str, expected: Vec<Entry>) {
    let mut fs = MemoryFileSystem::new();
    fs.mkdir(Path::new("/root")).unwrap();
    fs.write(
      Path::new("/root/package.json"),
      &input.as_bytes().to_owned(),
    )
    .unwrap();
    let result = resolve_package_entries(&fs, PathBuf::from("/root"));
    assert_eq!(result, expected);
  }

  #[test]
  fn test_resolve_package_entries() {
    test(
      r#"
    {
      "exports": {
        "source": "./foo.tsx",
        "import": "./import.mjs",
        "require": "./require.cjs"
      }
    }"#,
      vec![
        Entry {
          url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./import.mjs".into()),
            env: Arc::new(Environment {
              output_format: crate::OutputFormat::Esmodule,
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./require.cjs".into()),
            env: Arc::new(Environment {
              output_format: crate::OutputFormat::Commonjs,
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
      ],
    );

    test(
      r#"
    {
      "exports": {
        "source": "./foo.tsx",
        "node": "./node.js",
        "browser": "./browser.js"
      }
    }"#,
      vec![
        Entry {
          url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./node.js".into()),
            env: Arc::new(Environment {
              context: EnvironmentContext::Node,
              output_format: crate::OutputFormat::Commonjs,
              include_node_modules: crate::IncludeNodeModules::Bool(false),
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./browser.js".into()),
            env: Arc::new(Environment {
              context: EnvironmentContext::Browser,
              output_format: crate::OutputFormat::Esmodule,
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
      ],
    );

    test(
      r#"
    {
      "exports": {
        "node": {
          "source": "./node.tsx",
          "import": "./node.mjs",
          "require": "./node.cjs"
        },
        "browser": {
          "source": "./browser.tsx",
          "import": "./browser.mjs",
          "require": "./browser.cjs"
        }
      }
    }"#,
      vec![
        Entry {
          url: SourceUrl::parse("file:///root/node.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./node.mjs".into()),
            env: Arc::new(Environment {
              context: EnvironmentContext::Node,
              output_format: crate::OutputFormat::Esmodule,
              include_node_modules: crate::IncludeNodeModules::Bool(false),
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/node.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./node.cjs".into()),
            env: Arc::new(Environment {
              context: EnvironmentContext::Node,
              output_format: crate::OutputFormat::Commonjs,
              include_node_modules: crate::IncludeNodeModules::Bool(false),
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/browser.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./browser.mjs".into()),
            env: Arc::new(Environment {
              output_format: crate::OutputFormat::Esmodule,
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/browser.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./browser.cjs".into()),
            env: Arc::new(Environment {
              output_format: crate::OutputFormat::Commonjs,
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
      ],
    );

    test(
      r#"
    {
      "exports": {
        "source": "./entry.tsx",
        "node": {
          "import": "./node.mjs",
          "require": "./node.cjs"
        },
        "browser": {
          "import": "./browser.mjs",
          "require": "./browser.cjs"
        }
      }
    }"#,
      vec![
        Entry {
          url: SourceUrl::parse("file:///root/entry.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./node.mjs".into()),
            env: Arc::new(Environment {
              context: EnvironmentContext::Node,
              output_format: crate::OutputFormat::Esmodule,
              include_node_modules: crate::IncludeNodeModules::Bool(false),
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/entry.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./node.cjs".into()),
            env: Arc::new(Environment {
              context: EnvironmentContext::Node,
              output_format: crate::OutputFormat::Commonjs,
              include_node_modules: crate::IncludeNodeModules::Bool(false),
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/entry.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./browser.mjs".into()),
            env: Arc::new(Environment {
              output_format: crate::OutputFormat::Esmodule,
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/entry.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./browser.cjs".into()),
            env: Arc::new(Environment {
              output_format: crate::OutputFormat::Commonjs,
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
      ],
    );

    test(
      r#"
    {
      "exports": {
        "source": "./foo.tsx",
        "default": "./dist.js"
      },
      "engines": {
        "node": ">= 20"
      }
    }"#,
      vec![Entry {
        url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
        target: Target {
          dist_dir: SourceUrl::parse("file:///root").unwrap(),
          dist_entry: Some("./dist.js".into()),
          env: Arc::new(Environment {
            context: EnvironmentContext::Node,
            output_format: crate::OutputFormat::Commonjs,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            engines: crate::Engines {
              node: Some(Version::new(NonZero::new(20).unwrap(), 0)),
              ..Default::default()
            },
            ..Default::default()
          }),
          ..Default::default()
        },
        asset: None,
        loc: None,
      }],
    );

    test(
      r#"
    {
      "exports": {
        "source": "./foo.tsx",
        "default": "./dist.js"
      },
      "engines": {
        "browsers": "Chrome 100"
      }
    }"#,
      vec![Entry {
        url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
        target: Target {
          dist_dir: SourceUrl::parse("file:///root").unwrap(),
          dist_entry: Some("./dist.js".into()),
          env: Arc::new(Environment {
            context: EnvironmentContext::Browser,
            output_format: crate::OutputFormat::Esmodule,
            engines: crate::Engines {
              browsers: crate::Browsers {
                chrome: Some(Version::new(NonZero::new(100).unwrap(), 0)),
                ..Default::default()
              },
              ..Default::default()
            },
            ..Default::default()
          }),
          ..Default::default()
        },
        asset: None,
        loc: None,
      }],
    );

    test(
      r#"
    {
      "source": "./foo.tsx",
      "main": "./dist.js",
      "browserslist": "Chrome 100"
    }"#,
      vec![Entry {
        url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
        target: Target {
          dist_dir: SourceUrl::parse("file:///root").unwrap(),
          dist_entry: Some("./dist.js".into()),
          env: Arc::new(Environment {
            context: EnvironmentContext::Browser,
            output_format: crate::OutputFormat::Esmodule,
            engines: crate::Engines {
              browsers: crate::Browsers {
                chrome: Some(Version::new(NonZero::new(100).unwrap(), 0)),
                ..Default::default()
              },
              ..Default::default()
            },
            ..Default::default()
          }),
          ..Default::default()
        },
        asset: None,
        loc: None,
      }],
    );

    test(
      r#"
    {
      "exports": {
        "./foo": {
          "source": "./foo.tsx",
          "default": "./foo.mjs"
        },
        "./bar": {
          "source": "./bar.tsx",
          "default": "./bar.mjs"
        }
      }
    }"#,
      vec![
        Entry {
          url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./foo.mjs".into()),
            env: Arc::new(Environment {
              context: EnvironmentContext::Browser,
              output_format: crate::OutputFormat::Esmodule,
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/bar.tsx").unwrap(),
          target: Target {
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            dist_entry: Some("./bar.mjs".into()),
            env: Arc::new(Environment {
              context: EnvironmentContext::Browser,
              output_format: crate::OutputFormat::Esmodule,
              ..Default::default()
            }),
            ..Default::default()
          },
          asset: None,
          loc: None,
        },
      ],
    );
  }
}
