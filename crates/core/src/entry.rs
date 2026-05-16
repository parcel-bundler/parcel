use std::{
  collections::HashSet,
  path::{Component, Path, PathBuf},
  sync::Arc,
};

use serde_json::Value;

use crate::{
  BuildMode, BuildOptions, Diagnostic, Engines, Environment, EnvironmentFlags, ExportsCondition,
  FileKind, FileSystem, IncludeNodeModules, OutputFormat, SourceLocation, SourceType, SourceUrl,
  Target, TargetSourceMapOptions, Version, glob, is_glob,
};

#[derive(Debug, PartialEq, Eq, Hash)]
pub struct Entry {
  pub url: SourceUrl,
  pub target: Arc<Target>,
  pub dist_entry: Option<String>,
  pub asset: Option<usize>,
  pub loc: Option<SourceLocation>,
}

pub fn resolve_entries(
  entries: Vec<String>,
  options: &BuildOptions,
) -> Result<Vec<Entry>, Diagnostic> {
  let mut paths = Vec::new();
  for entry in entries {
    for path in glob(&*options.input_fs, &entry, &std::env::current_dir()?) {
      paths.push(path);
    }
  }

  let project_root = find_project_root(&paths);

  let mut entries = EntryResolver::new();
  for path in paths {
    if options.input_fs.kind(&path).contains(FileKind::IS_DIR) {
      entries.resolve_package_entries(&*options.input_fs, path)?;
    } else {
      let (context, engines) = if let Some(pkg) = find_package(&path, &*options.input_fs) {
        let engines = pkg.get("engines");
        let context = if engines.and_then(|e| e.get("node")).is_some() {
          Environment::Node
        } else {
          Environment::Browser
        };
        let engines = package_engines(&pkg, engines, context, OutputFormat::Esmodule);
        (context, engines)
      } else {
        (Environment::Browser, Default::default())
      };

      let mut flags = EnvironmentFlags::empty();
      flags.set(
        EnvironmentFlags::SHOULD_OPTIMIZE,
        options.mode == BuildMode::Production,
      );
      let env = entries.target(Target {
        environment: context,
        engines,
        flags,
        dist_dir: SourceUrl::from_path(&project_root.join("dist")).unwrap(),
        ..Default::default()
      });

      entries.add_entry(Entry {
        url: SourceUrl::from_path(&path).unwrap(),
        target: env,
        dist_entry: None,
        loc: None,
        asset: None,
      });
    }
  }

  Ok(entries.entries)
}

struct EntryResolver {
  entries: Vec<Entry>,
  targets: HashSet<Arc<Target>>,
}

impl EntryResolver {
  fn new() -> Self {
    EntryResolver {
      entries: Vec::new(),
      targets: HashSet::new(),
    }
  }

  fn add_entry(&mut self, entry: Entry) {
    // TODO: hashset?
    if !self.entries.contains(&entry) {
      self.entries.push(entry);
    }
  }

  fn target(&mut self, env: Target) -> Arc<Target> {
    if let Some(existing) = self.targets.get(&env) {
      return existing.clone();
    }

    let arc = Arc::new(env);
    self.targets.insert(arc.clone());
    arc
  }

  fn resolve_package_entries(
    &mut self,
    fs: &dyn FileSystem,
    dir: PathBuf,
  ) -> Result<(), Diagnostic> {
    let pkg_path = dir.join("package.json");
    let contents = fs.read(&pkg_path)?;
    let json: Value = serde_json::from_slice(&contents)?;
    let context = ExportsContext {
      condition: ExportsCondition::empty(),
      engines: json.get("engines"),
      context: None,
      output_format: None,
      include_node_modules: None,
    };

    if let Some(exports) = json.get("exports") {
      self.extract_exports(fs, &dir, &json, exports, Vec::new(), &context);
    }

    if let Some(Value::String(source)) = json.get("source") {
      for (field, cond) in &[
        ("main", ExportsCondition::DEFAULT),
        ("module", ExportsCondition::MODULE),
        ("browser", ExportsCondition::BROWSER),
        ("types", ExportsCondition::TYPES),
      ] {
        if let Some(Value::String(main)) = json.get(field) {
          if is_glob(source) {
            // TODO: error
          }

          if let Some(child) = context.child(&json, field) {
            let (dist_dir, dist_entry) = dist_dir_entry(&dir, &main, &dir.join(source));
            let mut env = child.to_env(&json, &dist_dir, &dist_entry);
            if *cond == ExportsCondition::MODULE {
              env.output_format = OutputFormat::Esmodule;
            }

            let env = self.target(env);

            self.add_entry(Entry {
              url: SourceUrl::from_path(&dir.join(source)).unwrap(),
              target: env,
              dist_entry: Some(dist_entry),
              asset: None,
              loc: None,
            });
          }
        }
      }

      if self.entries.is_empty() {
        for source in glob(fs, source, &dir) {
          self.add_entry(Entry {
            url: SourceUrl::from_path(&source).unwrap(),
            target: Arc::new(Target {
              dist_dir: SourceUrl::from_path(&dir).unwrap(),
              ..Default::default()
            }),
            dist_entry: None,
            asset: None,
            loc: None,
          });
        }
      }
    }

    Ok(())
  }

  fn extract_exports(
    &mut self,
    fs: &dyn FileSystem,
    dir: &Path,
    pkg: &Value,
    value: &Value,
    source: Vec<(PathBuf, Option<String>)>,
    context: &ExportsContext,
  ) {
    if let Value::Object(exports) = value {
      let source = if let Some(Value::String(source)) = value.get("source") {
        if source.contains('*') {
          let source_path = dir.join(source);
          let source_bytes = source_path.to_str().unwrap().as_bytes();
          let start = source_bytes.iter().position(|b| *b == b'*').unwrap();
          let end = source_bytes.len() - start;

          let source_glob = if start == 0 || source_bytes[start - 1] == b'/' {
            source.replace('*', "**/*")
          } else {
            source.clone()
          };

          glob(fs, &source_glob, dir)
            .into_iter()
            .map(|path| {
              // Find the part of the path that matched the "*".
              // This will be replaced in the target dist entry.
              let dest_bytes = path.to_str().unwrap().as_bytes();
              let matched =
                String::from_utf8(dest_bytes[start..=dest_bytes.len() - end].to_vec()).unwrap();
              (path, Some(matched))
            })
            .collect()
        } else {
          vec![(dir.join(source), None)]
        }
      } else {
        source
      };

      for (key, value) in exports {
        if key == "source" {
          continue;
        }

        if !key.starts_with('.') {
          if let Some(child) = context.child(pkg, key) {
            self.extract_exports(fs, dir, pkg, value, source.clone(), &child);
          }
        } else {
          self.extract_exports(fs, dir, pkg, value, source.clone(), context);
        }
      }
    } else if let Value::String(value) = value {
      if value.starts_with('.') {
        for (source, part) in source {
          let dist_entry = if let Some(part) = part {
            value.replace('*', &part)
          } else {
            value.clone()
          };

          let (dist_dir, dist_entry) = dist_dir_entry(dir, &dist_entry, &source);
          let env = self.target(context.to_env(pkg, &dist_dir, &dist_entry));

          self.add_entry(Entry {
            url: SourceUrl::from_path(&source).unwrap(),
            target: env,
            dist_entry: Some(dist_entry),
            asset: None,
            loc: None,
          })
        }
      }
    }
  }
}

fn dist_dir_entry(dir: &Path, dist_entry: &str, source: &Path) -> (PathBuf, String) {
  let dist_entry_path = Path::new(&dist_entry);
  let mut dist_dir = dir.to_path_buf();
  let mut source_components = source.strip_prefix(dir).unwrap().components();
  let mut dist_components = dist_entry_path.components();
  let mut source = source_components.next();
  let mut dist = dist_components.next();
  let mut dist_entry = PathBuf::new();

  // Add components from dist_entry to dist_dir while they match the source path.
  while let (Some(a), Some(b)) = (source, dist) {
    // Skip meaningless "./" segments.
    if a == Component::CurDir {
      source = source_components.next();
      continue;
    }

    if b == Component::CurDir {
      dist = dist_components.next();
      continue;
    }

    if a == b {
      dist_dir.push(a);
    } else {
      // If there is more than one component remaining, add the root dist directory to the dist_dir.
      // This is where non-entry bundles in this target will be placed.
      if let Some(next) = dist_components.next() {
        dist_dir.push(b);
        dist_entry.push(next);
      } else {
        dist_entry.push(b);
      }
      dist_entry.extend(dist_components);
      break;
    }

    source = source_components.next();
    dist = dist_components.next();
  }

  let dist_entry = dist_entry.to_str().unwrap().to_owned();
  (dist_dir, dist_entry)
}

struct ExportsContext<'a> {
  condition: ExportsCondition,
  engines: Option<&'a Value>,
  context: Option<&'a Value>,
  output_format: Option<&'a Value>,
  include_node_modules: Option<&'a Value>,
}

impl<'a> ExportsContext<'a> {
  fn child(&'a self, pkg: &'a Value, condition: &str) -> Option<ExportsContext<'a>> {
    let target = pkg
      .get("targets")
      .and_then(|targets| targets.get(condition));
    if matches!(target, Some(Value::Bool(false))) {
      return None;
    }

    Some(ExportsContext {
      condition: self.condition
        | ExportsCondition::try_from(condition).unwrap_or(ExportsCondition::empty()),
      engines: target
        .and_then(|t| t.get("engines"))
        .or(self.engines.clone()),
      context: target
        .and_then(|t| t.get("context"))
        .or(self.context.clone()),
      output_format: target
        .and_then(|t| t.get("outputFormat"))
        .or(self.output_format.clone()),
      include_node_modules: target
        .and_then(|t| t.get("includeNodeModules"))
        .or(self.include_node_modules.clone()),
    })
  }

  fn to_env(&self, pkg: &Value, dir: &Path, entry: &str) -> Target {
    let context = if let Some(Value::String(context)) = self.context {
      Environment::try_from(context.as_str()).unwrap()
    } else if self.condition.contains(ExportsCondition::REACT_SERVER) {
      Environment::ReactServer
    } else if self.condition.contains(ExportsCondition::ELECTRON) {
      if self.condition.contains(ExportsCondition::NODE) {
        Environment::ElectronMain
      } else {
        Environment::ElectronRenderer
      }
    } else if self.condition.contains(ExportsCondition::NODE) {
      Environment::Node
    } else if self.condition.contains(ExportsCondition::WORKER) {
      Environment::WebWorker
    } else if self.condition.contains(ExportsCondition::WORKLET) {
      Environment::Worklet
    } else if self.condition.contains(ExportsCondition::BROWSER) {
      Environment::Browser
    } else if self.engines.and_then(|e| e.get("node")).is_some() {
      Environment::Node
    } else {
      Environment::Browser
    };

    let output_format = if let Some(Value::String(format)) = self.output_format {
      OutputFormat::try_from(format.as_str()).unwrap()
    } else if entry.ends_with(".mjs") {
      OutputFormat::Esmodule
    } else if entry.ends_with(".cjs") {
      OutputFormat::Commonjs
    } else if let Some(Value::String(ty)) = pkg.get("type") {
      if ty == "module" {
        OutputFormat::Esmodule
      } else {
        OutputFormat::Commonjs
      }
    } else {
      OutputFormat::Commonjs
    };

    // Bundle devDependencies but not dependencies or peerDependencies.
    let include_node_modules = if let Some(include) = self.include_node_modules {
      serde_json::from_value(include.clone()).unwrap()
    } else if let Some(Value::Object(deps)) = pkg.get("devDependencies") {
      IncludeNodeModules::Array(deps.keys().cloned().collect())
    } else {
      IncludeNodeModules::Bool(false)
    };

    let mut flags = EnvironmentFlags::IS_LIBRARY;
    flags.set(
      EnvironmentFlags::MODULE_TYPE_EXTENSION,
      entry.ends_with(".mjs") || entry.ends_with(".cjs"),
    );
    flags.set(
      EnvironmentFlags::SHOULD_OPTIMIZE,
      self.condition.contains(ExportsCondition::PRODUCTION),
    ); // ??

    Target {
      environment: context,
      output_format,
      source_type: SourceType::Module,
      flags,
      source_map: Some(TargetSourceMapOptions::default()),
      loc: None,
      include_node_modules,
      engines: package_engines(pkg, self.engines, context, output_format),
      dist_dir: SourceUrl::from_path(dir).unwrap(),
      public_url: String::new(),
    }
  }
}

fn package_engines(
  pkg: &Value,
  engines: Option<&Value>,
  context: Environment,
  output_format: OutputFormat,
) -> Engines {
  let engines = if context.is_browser() {
    let browsers = engines
      .and_then(|e| e.get("browsers"))
      .or_else(|| pkg.get("browserslist"));
    match browsers {
      Some(Value::String(browsers)) => {
        Engines::from_browserslist(std::iter::once(browsers.as_str()), output_format)
      }
      Some(Value::Array(browsers)) => {
        Engines::from_browserslist(browsers.iter().filter_map(|b| b.as_str()), output_format)
      }
      _ => Default::default(),
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
  };

  engines
}

fn find_project_root(entries: &Vec<PathBuf>) -> PathBuf {
  let root = common_root_path(entries.iter()).unwrap_or_else(|| std::env::current_dir().unwrap());

  for dir in root.ancestors() {
    for file in &[
      "yarn.lock",
      "package-lock.json",
      "pnpm-lock.yaml",
      ".git",
      ".hg",
    ] {
      let p = dir.join(file);
      if p.exists() {
        return dir.to_path_buf();
      }
    }
  }

  std::env::current_dir().unwrap()
}

fn common_root_path<'a>(paths: impl IntoIterator<Item = &'a PathBuf>) -> Option<PathBuf> {
  let mut path_iter = paths.into_iter();
  let mut root = path_iter.next()?.to_path_buf();

  for path in path_iter {
    let mut new_root = PathBuf::new();
    let mut found = false;
    for (a, b) in root.components().zip(path.components()) {
      if a == b {
        found = true;
        new_root.push(a);
      } else {
        break;
      }
    }
    root = new_root;
    if !found {
      return None;
    }
  }

  Some(root)
}

fn find_package(path: &Path, fs: &dyn FileSystem) -> Option<serde_json::Value> {
  for p in path.ancestors() {
    let pkg = p.join("package.json");
    if let Ok(pkg) = fs.read(&pkg) {
      return serde_json::from_slice(&pkg).ok();
    }
  }

  None
}

#[cfg(test)]
mod tests {
  use crate::{
    Entry, Environment, EnvironmentFlags, FileSystem, MemoryFileSystem, SourceUrl, Target, Version,
    entry::resolve_entries,
  };
  use pretty_assertions::assert_eq;
  use std::{collections::HashMap, num::NonZero, path::Path, sync::Arc};

  fn test(input: &str, expected: Vec<Entry>) {
    let fs = MemoryFileSystem::new();
    fs.mkdir(Path::new("/root")).unwrap();
    fs.write(
      Path::new("/root/package.json"),
      &input.as_bytes().to_owned(),
    )
    .unwrap();
    fs.mkdir(Path::new("/root/src")).unwrap();
    fs.write(Path::new("/root/src/foo.tsx"), &Vec::new())
      .unwrap();
    fs.write(Path::new("/root/src/bar.tsx"), &Vec::new())
      .unwrap();
    let fs = Arc::new(fs);
    let result = resolve_entries(
      vec!["/root".into()],
      &crate::BuildOptions {
        input_fs: fs.clone(),
        output_fs: fs,
        env: HashMap::new(),
        log_level: crate::LogLevel::Error,
        mode: crate::BuildMode::Development,
        config: None,
      },
    )
    .unwrap();
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
      },
      "devDependencies": {
        "foo": "*"
      }
    }"#,
      vec![
        Entry {
          url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
          target: Arc::new(Target {
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Array(vec!["foo".into()]),
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("import.mjs".into()),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
          target: Arc::new(Target {
            output_format: crate::OutputFormat::Commonjs,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Array(vec!["foo".into()]),
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("require.cjs".into()),
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
          target: Arc::new(Target {
            environment: Environment::Node,
            output_format: crate::OutputFormat::Commonjs,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            flags: EnvironmentFlags::IS_LIBRARY,
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("node.js".into()),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Browser,
            output_format: crate::OutputFormat::Commonjs,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("browser.js".into()),
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
          target: Arc::new(Target {
            environment: Environment::Node,
            output_format: crate::OutputFormat::Esmodule,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            flags: EnvironmentFlags::IS_LIBRARY,
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("node.mjs".into()),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/node.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Node,
            output_format: crate::OutputFormat::Commonjs,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            flags: EnvironmentFlags::IS_LIBRARY,
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("node.cjs".into()),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/browser.tsx").unwrap(),
          target: Arc::new(Target {
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("browser.mjs".into()),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/browser.tsx").unwrap(),
          target: Arc::new(Target {
            output_format: crate::OutputFormat::Commonjs,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("browser.cjs".into()),
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
          target: Arc::new(Target {
            environment: Environment::Node,
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("node.mjs".into()),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/entry.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Node,
            output_format: crate::OutputFormat::Commonjs,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("node.cjs".into()),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/entry.tsx").unwrap(),
          target: Arc::new(Target {
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("browser.mjs".into()),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/entry.tsx").unwrap(),
          target: Arc::new(Target {
            output_format: crate::OutputFormat::Commonjs,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("browser.cjs".into()),
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
        target: Arc::new(Target {
          environment: Environment::Node,
          output_format: crate::OutputFormat::Commonjs,
          include_node_modules: crate::IncludeNodeModules::Bool(false),
          flags: EnvironmentFlags::IS_LIBRARY,
          engines: crate::Engines {
            node: Some(Version::new(NonZero::new(20).unwrap(), 0)),
            ..Default::default()
          },
          dist_dir: SourceUrl::parse("file:///root").unwrap(),
          ..Default::default()
        }),
        dist_entry: Some("dist.js".into()),
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
        target: Arc::new(Target {
          environment: Environment::Browser,
          output_format: crate::OutputFormat::Commonjs,
          flags: EnvironmentFlags::IS_LIBRARY,
          include_node_modules: crate::IncludeNodeModules::Bool(false),
          engines: crate::Engines {
            browsers: crate::Browsers {
              chrome: Some(Version::new(NonZero::new(100).unwrap(), 0)),
              ..Default::default()
            },
            ..Default::default()
          },
          dist_dir: SourceUrl::parse("file:///root").unwrap(),
          ..Default::default()
        }),
        dist_entry: Some("dist.js".into()),
        asset: None,
        loc: None,
      }],
    );

    test(
      r#"
    {
      "source": "./foo.tsx",
      "main": "./dist.js",
      "module": "./module.js",
      "browserslist": "Chrome 100"
    }"#,
      vec![
        Entry {
          url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Browser,
            output_format: crate::OutputFormat::Commonjs,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            engines: crate::Engines {
              browsers: crate::Browsers {
                chrome: Some(Version::new(NonZero::new(100).unwrap(), 0)),
                ..Default::default()
              },
              ..Default::default()
            },
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("dist.js".into()),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Browser,
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            engines: crate::Engines {
              browsers: crate::Browsers {
                chrome: Some(Version::new(NonZero::new(100).unwrap(), 0)),
                ..Default::default()
              },
              ..Default::default()
            },
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("module.js".into()),
          asset: None,
          loc: None,
        },
      ],
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
          target: Arc::new(Target {
            environment: Environment::Browser,
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("foo.mjs".into()),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/bar.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Browser,
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: SourceUrl::parse("file:///root").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("bar.mjs".into()),
          asset: None,
          loc: None,
        },
      ],
    );

    test(
      r#"
    {
      "exports": {
        "source": "./src/*.tsx",
        "default": "./dist/*.mjs"
      }
    }"#,
      vec![
        Entry {
          url: SourceUrl::parse("file:///root/src/bar.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Browser,
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: SourceUrl::parse("file:///root/dist").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("bar.mjs".into()),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/src/foo.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Browser,
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: SourceUrl::parse("file:///root/dist").unwrap(),
            ..Default::default()
          }),
          dist_entry: Some("foo.mjs".into()),
          asset: None,
          loc: None,
        },
      ],
    );

    test(
      r#"
    {
      "exports": {
        "source": "./src/index.tsx",
        "custom": "./dist/index.js"
      },
      "targets": {
        "custom": {
          "outputFormat": "esmodule",
          "engines": {
            "browsers": "Chrome >= 79"
          }
        }
      }
    }"#,
      vec![Entry {
        url: SourceUrl::parse("file:///root/src/index.tsx").unwrap(),
        target: Arc::new(Target {
          environment: Environment::Browser,
          output_format: crate::OutputFormat::Esmodule,
          flags: EnvironmentFlags::IS_LIBRARY,
          include_node_modules: crate::IncludeNodeModules::Bool(false),
          engines: crate::Engines {
            browsers: crate::Browsers {
              chrome: Some(Version::new(NonZero::new(79).unwrap(), 0)),
              ..Default::default()
            },
            ..Default::default()
          },
          dist_dir: SourceUrl::parse("file:///root/dist").unwrap(),
          ..Default::default()
        }),
        dist_entry: Some("index.js".into()),
        asset: None,
        loc: None,
      }],
    );

    test(
      r#"
    {
      "exports": {
        "source": "./src/index.tsx",
        "custom1": {
          "custom2": "./dist/index.js"
        }
      },
      "targets": {
        "custom1": {
          "outputFormat": "esmodule"
        },
        "custom2": {
          "engines": {
            "browsers": ["Chrome >= 79"]
          }
        }
      }
    }"#,
      vec![Entry {
        url: SourceUrl::parse("file:///root/src/index.tsx").unwrap(),
        target: Arc::new(Target {
          environment: Environment::Browser,
          output_format: crate::OutputFormat::Esmodule,
          flags: EnvironmentFlags::IS_LIBRARY,
          include_node_modules: crate::IncludeNodeModules::Bool(false),
          engines: crate::Engines {
            browsers: crate::Browsers {
              chrome: Some(Version::new(NonZero::new(79).unwrap(), 0)),
              ..Default::default()
            },
            ..Default::default()
          },
          dist_dir: SourceUrl::parse("file:///root/dist").unwrap(),
          ..Default::default()
        }),
        dist_entry: Some("index.js".into()),
        asset: None,
        loc: None,
      }],
    );

    test(
      r#"
    {
      "exports": {
        "source": "./style/index.ts",
        "import": "./style/dist/index.mjs"
      }
    }"#,
      vec![Entry {
        url: SourceUrl::parse("file:///root/style/index.ts").unwrap(),
        target: Arc::new(Target {
          environment: Environment::Browser,
          output_format: crate::OutputFormat::Esmodule,
          flags: EnvironmentFlags::IS_LIBRARY,
          include_node_modules: crate::IncludeNodeModules::Bool(false),
          dist_dir: SourceUrl::parse("file:///root/style/dist").unwrap(),
          ..Default::default()
        }),
        dist_entry: Some("index.mjs".into()),
        asset: None,
        loc: None,
      }],
    );

    test(
      r#"
    {
      "exports": {
        "source": "./style/index.ts",
        "import": "./style/dist/index.mjs"
      },
      "targets": {
        "import": false
      }
    }"#,
      vec![],
    );
  }
}
