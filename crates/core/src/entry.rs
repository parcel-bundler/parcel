use std::{
  collections::HashSet,
  path::{Component, Path, PathBuf},
  sync::Arc,
};

use serde_json::Value;

use crate::{
  AssetNodeIndex, AssetType, BuildMode, BuildOptions, Diagnostic, Engines, Environment,
  EnvironmentFlags, ExportsCondition, FileKind, FileSystem, IncludeNodeModules, OutputFormat,
  PathId, SourceLocation, SourceType, SourceUrl, SubPath, Target, Version, is_glob,
};

#[derive(Debug, PartialEq, Eq, Hash, Clone)]
pub struct Entry {
  pub url: SourceUrl,
  pub target: Arc<Target>,
  /// The full dist path requested for this entry's bundle (e.g. from a package.json `main`
  /// field), used in place of a namer-generated name.
  pub dist_entry: Option<PathId>,
  pub asset: Option<AssetNodeIndex>,
  pub loc: Option<SourceLocation>,
}

pub fn resolve_entries(
  entries: &Vec<String>,
  options: &BuildOptions,
) -> Result<(Vec<Entry>, PathId), Diagnostic> {
  let cwd = options.cwd;
  let mut paths = Vec::new();
  for entry in entries {
    let matches = options.input_fs.glob(entry, cwd);
    if matches.is_empty() {
      return Err(Diagnostic::from_message(format!(
        "Entry {} does not exist",
        entry
      )));
    }
    paths.extend(matches);
  }

  let project_root = find_project_root(&*options.input_fs, &paths, cwd);
  let should_optimize = options
    .optimize
    .unwrap_or(options.mode == BuildMode::Production);

  let mut entries = EntryResolver::new(should_optimize);
  for path in paths {
    if options.input_fs.kind(path).contains(FileKind::IS_DIR) {
      entries.resolve_package_entries(&*options.input_fs, path, &project_root, options)?;
    } else {
      let pkg = find_package(path, &*options.input_fs);
      let dist_dir = options
        .dist_dir
        .unwrap_or_else(|| project_root.child("dist"));
      entries.resolve_file_entry(
        path,
        pkg.as_ref().map(|(dir, pkg)| (*dir, pkg)),
        dist_dir,
        options,
      )?;
    }
  }

  Ok((entries.entries, project_root))
}

struct EntryResolver {
  entries: Vec<Entry>,
  targets: HashSet<Arc<Target>>,
  should_optimize: bool,
}

impl EntryResolver {
  fn new(should_optimize: bool) -> Self {
    EntryResolver {
      entries: Vec::new(),
      targets: HashSet::new(),
      should_optimize,
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

  /// Adds an app entry for a file, building it for each target in its package.json, with
  /// `dist_dir` as the default output directory. `pkg` is the package's directory and contents.
  fn resolve_file_entry(
    &mut self,
    path: PathId,
    pkg: Option<(PathId, &Value)>,
    dist_dir: PathId,
    options: &BuildOptions,
  ) -> Result<(), Diagnostic> {
    let mut flags = EnvironmentFlags::empty();
    flags.set(EnvironmentFlags::SHOULD_OPTIMIZE, self.should_optimize);

    let mut output_format = OutputFormat::default();
    if let Some(ext) = path.extension() {
      flags.set(
        EnvironmentFlags::MODULE_TYPE_EXTENSION,
        ext == "mjs" || ext == "cjs",
      );
      if ext == "mjs" {
        output_format = OutputFormat::Esmodule;
      } else if ext == "cjs" {
        output_format = OutputFormat::Commonjs;
      }
    }

    let Some((pkg_dir, pkg)) = pkg else {
      let env = self.target(Target {
        environment: Environment::Browser,
        engines: Default::default(),
        flags,
        output_format,
        include_node_modules: Default::default(),
        dist_dir,
        source_map: options.source_map.clone(),
        public_url: options.public_url.clone(),
        ..Default::default()
      });

      self.add_entry(Entry {
        url: SourceUrl::from_path(&path),
        target: env,
        dist_entry: None,
        loc: None,
        asset: None,
      });
      return Ok(());
    };

    let is_non_js = path
      .extension()
      .map(|ext| AssetType::from_extension(ext))
      .is_some_and(|ty| !ty.is_js() || ty == AssetType::Svg);

    // Targets set to `false` are skipped.
    let targets: Vec<_> = pkg
      .get("targets")
      .and_then(Value::as_object)
      .into_iter()
      .flatten()
      .filter_map(|(name, target)| Some((name.as_str(), target.as_object()?)))
      .collect();
    let target_count = targets.len();
    let iter = if targets.is_empty() {
      either::Either::Left(std::iter::once(None))
    } else {
      either::Either::Right(targets.into_iter().map(Some))
    };

    // Build all targets.
    for named_target in iter {
      let target = named_target.map(|(_, target)| target);
      let engines = target
        .and_then(|target| target.get("engines"))
        .or_else(|| pkg.get("engines"));
      let context =
        if let Some(Value::String(context)) = target.and_then(|target| target.get("context")) {
          Environment::try_from(context.as_str())?
        } else if engines.and_then(|e| e.get("electron")).is_some() {
          if is_non_js {
            Environment::ElectronRenderer
          } else {
            Environment::ElectronMain
          }
        } else if !is_non_js && engines.and_then(|e| e.get("node")).is_some() {
          Environment::Node
        } else {
          Environment::Browser
        };

      let output_format =
        if let Some(Value::String(format)) = target.and_then(|target| target.get("outputFormat")) {
          OutputFormat::try_from(format.as_str())?
        } else if !matches!(path.extension(), Some("mjs" | "cjs")) {
          match context {
            Environment::ReactClient => OutputFormat::Esmodule,
            // Node loads `.js` files in `"type": "module"` packages as ES modules, and others as
            // CommonJS.
            Environment::Node | Environment::ElectronMain | Environment::ReactServer => {
              if pkg.get("type").and_then(Value::as_str) == Some("module") {
                OutputFormat::Esmodule
              } else {
                OutputFormat::Commonjs
              }
            }
            _ => output_format,
          }
        } else {
          output_format
        };

      let engines = package_engines(pkg, engines, context, output_format);
      let include_node_modules = target
        .and_then(|t| t.get("includeNodeModules"))
        .and_then(|t| serde_json::from_value(t.clone()).ok())
        .unwrap_or_default();

      // As in Parcel 2, a target's `distDir` is relative to the package and takes precedence over
      // `--dist-dir`. Otherwise, each of multiple targets builds into a subdirectory named after it.
      let dist_dir = match named_target {
        Some((name, target)) => match target.get("distDir") {
          Some(Value::String(dir)) => pkg_dir.join(Path::new(dir)),
          _ if target_count > 1 => dist_dir.child(name),
          _ => dist_dir,
        },
        None => dist_dir,
      };

      let env = self.target(Target {
        environment: context,
        engines,
        flags,
        output_format,
        include_node_modules,
        dist_dir,
        source_map: options.source_map.clone(), // TODO
        public_url: options.public_url.clone(),
        ..Default::default() // TODO
      });

      self.add_entry(Entry {
        url: SourceUrl::from_path(&path),
        target: env,
        dist_entry: None,
        loc: None,
        asset: None,
      });
    }

    Ok(())
  }

  fn resolve_package_entries(
    &mut self,
    fs: &dyn FileSystem,
    dir: PathId,
    project_root: &PathId,
    options: &BuildOptions,
  ) -> Result<(), Diagnostic> {
    let pkg_path = dir.child("package.json");
    let contents = fs.read(pkg_path)?;
    let json: Value = serde_json::from_slice(&contents)?;
    let context = ExportsContext {
      condition: ExportsCondition::empty(),
      should_optimize: self.should_optimize,
      engines: json.get("engines"),
      context: None,
      output_format: None,
      include_node_modules: None,
    };

    let start = self.entries.len();
    if let Some(exports) = json.get("exports") {
      self.extract_exports(
        fs,
        dir,
        &json,
        exports,
        Vec::new(),
        &context,
        project_root,
        options,
      )?;
    }

    // The top-level `source` field may list multiple entries.
    let sources: Vec<&str> = match json.get("source") {
      Some(Value::String(source)) => vec![source],
      Some(Value::Array(sources)) => sources.iter().filter_map(Value::as_str).collect(),
      _ => Vec::new(),
    };

    for (field, cond) in &[
      ("main", ExportsCondition::DEFAULT),
      ("module", ExportsCondition::MODULE),
      ("browser", ExportsCondition::BROWSER),
      ("types", ExportsCondition::TYPES),
    ] {
      let Some(Value::String(main)) = json.get(field) else {
        continue;
      };
      let source = match sources.as_slice() {
        [] => continue,
        [source] => source,
        _ => {
          return Err(Diagnostic::from_message(format!(
            "package.json \"source\" must be a single file when used with the {field:?} field"
          )));
        }
      };

      if is_glob(source) {
        // TODO: error
      }

      if let Some(child) = context.child(&json, field) {
        let source_path = dir.join(Path::new(source));
        let (dist_dir, dist_entry) = dist_dir_entry(dir, main, source_path)?;
        let mut env = child.to_env(&json, dist_dir, dist_entry, options)?;
        if *cond == ExportsCondition::MODULE {
          env.output_format = OutputFormat::Esmodule;
        }

        let env = self.target(env);

        self.add_entry(Entry {
          url: SourceUrl::from_path(&source_path),
          target: env,
          dist_entry: Some(dist_entry),
          asset: None,
          loc: None,
        });
      }
    }

    // Without library outputs, the sources are app entries, built like CLI entries but into the
    // package's dist directory by default.
    if self.entries.len() == start {
      let dist_dir = options.dist_dir.unwrap_or_else(|| dir.child("dist"));
      for source in sources {
        for path in fs.glob(source, dir) {
          self.resolve_file_entry(path, Some((dir, &json)), dist_dir, options)?;
        }
      }
    }

    Ok(())
  }

  fn extract_exports(
    &mut self,
    fs: &dyn FileSystem,
    dir: PathId,
    pkg: &Value,
    value: &Value,
    source: Vec<(PathId, Option<String>)>,
    context: &ExportsContext,
    project_root: &PathId,
    options: &BuildOptions,
  ) -> Result<(), Diagnostic> {
    if let Value::Object(exports) = value {
      let source = if let Some(Value::String(source)) = value.get("source") {
        if source.contains('*') {
          // Normalize so the `*`-match byte offsets below align with the glob results, which are
          // interned `PathId`s and therefore normalized (e.g. `./` segments removed).
          let source_path = dir.join(Path::new(source)).to_path_buf();
          let source_bytes = source_path.to_str().unwrap().as_bytes();
          let start = source_bytes.iter().position(|b| *b == b'*').unwrap();
          let end = source_bytes.len() - start;

          let source_glob = if start == 0 || source_bytes[start - 1] == b'/' {
            source.replace('*', "**/*")
          } else {
            source.clone()
          };

          fs.glob(&source_glob, dir)
            .into_iter()
            .map(|path| {
              // Find the part of the path that matched the "*".
              // This will be replaced in the target dist entry.
              let matched = path.with_path(|p| {
                let dest_bytes = p.to_str().unwrap().as_bytes();
                String::from_utf8(dest_bytes[start..=dest_bytes.len() - end].to_vec()).unwrap()
              });
              (path, Some(matched))
            })
            .collect()
        } else {
          vec![(dir.join(Path::new(source)), None)]
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
            self.extract_exports(
              fs,
              dir,
              pkg,
              value,
              source.clone(),
              &child,
              project_root,
              options,
            )?;
          }
        } else {
          self.extract_exports(
            fs,
            dir,
            pkg,
            value,
            source.clone(),
            context,
            project_root,
            options,
          )?;
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

          let (dist_dir, dist_entry) = dist_dir_entry(dir, &dist_entry, source)?;
          let env = self.target(context.to_env(pkg, dist_dir, dist_entry, options)?);

          self.add_entry(Entry {
            url: SourceUrl::from_path(&source),
            target: env,
            dist_entry: Some(dist_entry),
            asset: None,
            loc: None,
          })
        }
      }
    }

    Ok(())
  }
}

fn dist_dir_entry(
  dir: PathId,
  dist_entry: &str,
  source: PathId,
) -> Result<(PathId, PathId), Diagnostic> {
  let dist_entry_path = Path::new(&dist_entry);
  let dist_entry = dir.join(dist_entry_path);
  let mut dist_dir = dir.to_path_buf();
  let source = source.to_path_buf();
  let mut source_components = match source.strip_prefix(&dist_dir) {
    Ok(stripped) => stripped.components(),
    Err(_) => {
      return Err(Diagnostic::from_message(format!(
        "package.json \"source\" {:?} must be inside the package directory {:?}",
        source, dist_dir
      )));
    }
  };
  let mut dist_components = dist_entry_path.components();
  let mut source = source_components.next();
  let mut dist = dist_components.next();

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
      if dist_components.next().is_some() {
        dist_dir.push(b);
      }
      break;
    }

    source = source_components.next();
    dist = dist_components.next();
  }

  let dist_dir = PathId::new(&dist_dir);
  Ok((dist_dir, dist_entry))
}

struct ExportsContext<'a> {
  condition: ExportsCondition,
  should_optimize: bool,
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
      should_optimize: self.should_optimize,
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

  fn to_env(
    &self,
    pkg: &Value,
    dir: PathId,
    entry: PathId,
    options: &BuildOptions,
  ) -> Result<Target, Diagnostic> {
    let context = if let Some(Value::String(context)) = self.context {
      Environment::try_from(context.as_str())?
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
      OutputFormat::try_from(format.as_str())?
    } else if entry.extension() == Some("mjs") {
      OutputFormat::Esmodule
    } else if entry.extension() == Some("cjs") {
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
      serde_json::from_value(include.clone())?
    } else if let Some(Value::Object(deps)) = pkg.get("devDependencies") {
      let empty = serde_json::Map::new();
      let peers = pkg
        .get("peerDependencies")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
      IncludeNodeModules::Array(
        deps
          .keys()
          .filter(|k| !peers.contains_key(*k))
          .cloned()
          .collect(),
      )
    } else {
      IncludeNodeModules::Bool(false)
    };

    let mut flags = EnvironmentFlags::IS_LIBRARY;
    flags.set(
      EnvironmentFlags::MODULE_TYPE_EXTENSION,
      matches!(entry.extension(), Some("mjs" | "cjs")),
    );
    flags.set(
      EnvironmentFlags::SHOULD_OPTIMIZE,
      self.should_optimize && self.condition.contains(ExportsCondition::PRODUCTION), // ??
    );

    Ok(Target {
      environment: context,
      rsc_server_target: None,
      style_condition: None,
      output_format,
      source_type: SourceType::Module,
      flags,
      source_map: options.source_map.clone(),
      include_node_modules,
      engines: package_engines(pkg, self.engines, context, output_format),
      dist_dir: dir,
      public_url: options.public_url.clone(),
    })
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

pub fn find_project_root(fs: &dyn FileSystem, entries: &Vec<PathId>, cwd: PathId) -> PathId {
  let root = common_root_path(entries.iter()).unwrap_or(cwd);

  for dir in root.ancestors() {
    for file in &[
      "yarn.lock",
      "package-lock.json",
      "pnpm-lock.yaml",
      ".git",
      ".hg",
    ] {
      let p = dir.child(file);
      if !fs.kind(p).is_empty() {
        return dir;
      }
    }
  }

  cwd
}

fn common_root_path<'a>(paths: impl IntoIterator<Item = &'a PathId>) -> Option<PathId> {
  let mut path_iter = paths.into_iter();
  let mut root = path_iter.next()?.to_path_buf();

  for path in path_iter {
    let mut new_root = PathBuf::new();
    let mut found = false;
    for (a, b) in root.components().zip(path.to_path_buf().components()) {
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

  Some(PathId::new(&root))
}

/// Finds the package.json that contains `path`, returning its directory and contents.
fn find_package(path: PathId, fs: &dyn FileSystem) -> Option<(PathId, serde_json::Value)> {
  let pkg = fs.find_ancestor(
    path,
    SubPath::package_json(),
    FileKind::IS_FILE,
    PathId::root(),
  )?;
  let contents = fs.read(pkg).ok()?;
  Some((pkg.parent()?, serde_json::from_slice(&contents).ok()?))
}

#[cfg(test)]
mod tests {
  use crate::{
    Entry, Environment, EnvironmentFlags, FileSystem, MemoryFileSystem, PathId, SourceUrl, Target,
    Version, entry::resolve_entries,
  };
  use pretty_assertions::assert_eq;
  use std::{collections::HashMap, num::NonZero, path::Path, sync::Arc};

  fn test(input: &str, expected: Vec<Entry>) {
    let fs = MemoryFileSystem::new();
    fs.mkdir(Path::new("/root")).unwrap();
    fs.write(
      PathId::new(Path::new("/root/package.json")),
      &input.as_bytes().to_owned(),
    )
    .unwrap();
    fs.mkdir(Path::new("/root/src")).unwrap();
    fs.write(PathId::new(Path::new("/root/src/foo.tsx")), &Vec::new())
      .unwrap();
    fs.write(PathId::new(Path::new("/root/src/bar.tsx")), &Vec::new())
      .unwrap();
    let fs = Arc::new(fs);
    let (result, _) = resolve_entries(
      &vec!["/root".into()],
      &crate::BuildOptions {
        input_fs: fs.clone(),
        output_fs: fs,
        env: HashMap::new(),
        log_level: crate::LogLevel::Error,
        mode: crate::BuildMode::Development,
        optimize: None,
        content_hash: None,
        config: None,
        cwd: PathId::new(&std::env::current_dir().unwrap()),
        source_map: Some(Default::default()),
        dist_dir: None,
        public_url: Default::default(),
        hmr: None,
        reporters: Vec::new(),
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
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Array(vec!["foo".into()]),
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/import.mjs"))),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/foo.tsx").unwrap(),
          target: Arc::new(Target {
            output_format: crate::OutputFormat::Commonjs,
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Array(vec!["foo".into()]),
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/require.cjs"))),
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
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/node.js"))),
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
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/browser.js"))),
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
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/node.mjs"))),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/node.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Node,
            output_format: crate::OutputFormat::Commonjs,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/node.cjs"))),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/browser.tsx").unwrap(),
          target: Arc::new(Target {
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/browser.mjs"))),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/browser.tsx").unwrap(),
          target: Arc::new(Target {
            output_format: crate::OutputFormat::Commonjs,
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/browser.cjs"))),
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
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/node.mjs"))),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/entry.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Node,
            output_format: crate::OutputFormat::Commonjs,
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/node.cjs"))),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/entry.tsx").unwrap(),
          target: Arc::new(Target {
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/browser.mjs"))),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/entry.tsx").unwrap(),
          target: Arc::new(Target {
            output_format: crate::OutputFormat::Commonjs,
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/browser.cjs"))),
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
          dist_dir: PathId::new(Path::new("/root")),
          source_map: Some(Default::default()),
          ..Default::default()
        }),
        dist_entry: Some(PathId::new(Path::new("/root/dist.js"))),
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
          dist_dir: PathId::new(Path::new("/root")),
          source_map: Some(Default::default()),
          ..Default::default()
        }),
        dist_entry: Some(PathId::new(Path::new("/root/dist.js"))),
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
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/dist.js"))),
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
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/module.js"))),
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
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/foo.mjs"))),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/bar.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Browser,
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: PathId::new(Path::new("/root")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/bar.mjs"))),
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
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: PathId::new(Path::new("/root/dist")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/dist/bar.mjs"))),
          asset: None,
          loc: None,
        },
        Entry {
          url: SourceUrl::parse("file:///root/src/foo.tsx").unwrap(),
          target: Arc::new(Target {
            environment: Environment::Browser,
            output_format: crate::OutputFormat::Esmodule,
            flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
            include_node_modules: crate::IncludeNodeModules::Bool(false),
            dist_dir: PathId::new(Path::new("/root/dist")),
            source_map: Some(Default::default()),
            ..Default::default()
          }),
          dist_entry: Some(PathId::new(Path::new("/root/dist/foo.mjs"))),
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
          dist_dir: PathId::new(Path::new("/root/dist")),
          source_map: Some(Default::default()),
          ..Default::default()
        }),
        dist_entry: Some(PathId::new(Path::new("/root/dist/index.js"))),
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
          dist_dir: PathId::new(Path::new("/root/dist")),
          source_map: Some(Default::default()),
          ..Default::default()
        }),
        dist_entry: Some(PathId::new(Path::new("/root/dist/index.js"))),
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
          flags: EnvironmentFlags::IS_LIBRARY | EnvironmentFlags::MODULE_TYPE_EXTENSION,
          include_node_modules: crate::IncludeNodeModules::Bool(false),
          dist_dir: PathId::new(Path::new("/root/style/dist")),
          source_map: Some(Default::default()),
          ..Default::default()
        }),
        dist_entry: Some(PathId::new(Path::new("/root/style/dist/index.mjs"))),
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

  #[test]
  fn test_resolve_package_entries_source_outside_package_dir() {
    // A `"source"` field that resolves outside the package directory (e.g. `"../foo.tsx"`)
    // must produce a diagnostic instead of panicking in `dist_dir_entry`'s `strip_prefix`.
    let fs = MemoryFileSystem::new();
    fs.mkdir(Path::new("/root")).unwrap();
    fs.write(
      PathId::new(Path::new("/root/package.json")),
      &br#"
    {
      "source": "../outside.tsx",
      "main": "./dist.js"
    }"#
        .to_vec(),
    )
    .unwrap();
    fs.write(PathId::new(Path::new("/outside.tsx")), &Vec::new())
      .unwrap();
    let fs = Arc::new(fs);
    let result = resolve_entries(
      &vec!["/root".into()],
      &crate::BuildOptions {
        input_fs: fs.clone(),
        output_fs: fs,
        env: HashMap::new(),
        log_level: crate::LogLevel::Error,
        mode: crate::BuildMode::Development,
        optimize: None,
        content_hash: None,
        config: None,
        cwd: PathId::new(&std::env::current_dir().unwrap()),
        source_map: Some(Default::default()),
        dist_dir: None,
        public_url: Default::default(),
        hmr: None,
        reporters: Vec::new(),
      },
    );
    assert!(result.is_err());
  }

  #[test]
  fn test_node_file_entry_output_format_follows_package_type() {
    let output_format = |pkg: &str, entry: &str| {
      let fs = MemoryFileSystem::new();
      fs.mkdir(Path::new("/root")).unwrap();
      fs.write(
        PathId::new(Path::new("/root/package.json")),
        &pkg.as_bytes().to_vec(),
      )
      .unwrap();
      fs.write(PathId::new(&Path::new("/root").join(entry)), &Vec::new())
        .unwrap();
      let fs = Arc::new(fs);
      let (entries, _) = resolve_entries(
        &vec![format!("/root/{entry}")],
        &crate::BuildOptions {
          input_fs: fs.clone(),
          output_fs: fs,
          env: HashMap::new(),
          log_level: crate::LogLevel::Error,
          mode: crate::BuildMode::Development,
          optimize: None,
          content_hash: None,
          config: None,
          cwd: PathId::new(Path::new("/root")),
          source_map: None,
          dist_dir: None,
          public_url: Default::default(),
          hmr: None,
          reporters: Vec::new(),
        },
      )
      .unwrap();
      assert_eq!(entries.len(), 1);
      entries[0].target.output_format
    };

    let node = r#"{"engines":{"node":">=22"}}"#;
    let node_module = r#"{"type":"module","engines":{"node":">=22"}}"#;
    assert_eq!(
      output_format(node_module, "index.js"),
      crate::OutputFormat::Esmodule
    );
    assert_eq!(
      output_format(node_module, "index.cjs"),
      crate::OutputFormat::Commonjs
    );
    assert_eq!(
      output_format(node, "index.js"),
      crate::OutputFormat::Commonjs
    );
    assert_eq!(
      output_format(
        r#"{"type":"module","targets":{"default":{"context":"react-server"}}}"#,
        "index.js"
      ),
      crate::OutputFormat::Esmodule
    );
    // Browser scripts are loaded by pages, which decide how to load them.
    assert_eq!(
      output_format(r#"{"type":"module"}"#, "index.js"),
      crate::OutputFormat::Global
    );
  }

  #[test]
  fn test_default_target_context_for_file_entry() {
    let fs = MemoryFileSystem::new();
    fs.mkdir(Path::new("/root")).unwrap();
    fs.write(
      PathId::new(Path::new("/root/package.json")),
      &br#"{"targets":{"default":{"context":"react-server"}}}"#.to_vec(),
    )
    .unwrap();
    fs.write(PathId::new(Path::new("/root/index.jsx")), &Vec::new())
      .unwrap();
    let fs = Arc::new(fs);
    let (entries, _) = resolve_entries(
      &vec!["/root/index.jsx".into()],
      &crate::BuildOptions {
        input_fs: fs.clone(),
        output_fs: fs,
        env: HashMap::new(),
        log_level: crate::LogLevel::Error,
        mode: crate::BuildMode::Development,
        optimize: None,
        content_hash: None,
        config: None,
        cwd: PathId::new(Path::new("/root")),
        source_map: None,
        dist_dir: None,
        public_url: Default::default(),
        hmr: None,
        reporters: Vec::new(),
      },
    )
    .unwrap();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].target.environment, Environment::ReactServer);
    assert_eq!(
      entries[0].target.output_format,
      crate::OutputFormat::Commonjs
    );
    assert!(
      !entries[0]
        .target
        .flags
        .contains(EnvironmentFlags::IS_LIBRARY)
    );
  }

  /// Resolves `/root/{entry}` with the given package.json, returning each entry's target.
  fn file_entry_targets(pkg: &str, entry: &str, dist_dir: Option<&str>) -> Vec<Arc<Target>> {
    let fs = MemoryFileSystem::new();
    fs.mkdir(Path::new("/root")).unwrap();
    fs.write(
      PathId::new(Path::new("/root/package.json")),
      &pkg.as_bytes().to_vec(),
    )
    .unwrap();
    fs.write(PathId::new(&Path::new("/root").join(entry)), &Vec::new())
      .unwrap();
    let fs = Arc::new(fs);
    let (entries, _) = resolve_entries(
      &vec![format!("/root/{entry}")],
      &crate::BuildOptions {
        input_fs: fs.clone(),
        output_fs: fs,
        env: HashMap::new(),
        log_level: crate::LogLevel::Error,
        mode: crate::BuildMode::Production,
        optimize: None,
        content_hash: None,
        config: None,
        cwd: PathId::new(Path::new("/root")),
        source_map: None,
        dist_dir: dist_dir.map(|dir| PathId::new(Path::new(dir))),
        public_url: Default::default(),
        hmr: None,
        reporters: Vec::new(),
      },
    )
    .unwrap();
    entries.into_iter().map(|entry| entry.target).collect()
  }

  #[test]
  fn test_file_entry_target_dist_dir() {
    let dist_dirs = |pkg: &str, dist_dir: Option<&str>| -> Vec<PathId> {
      file_entry_targets(pkg, "index.html", dist_dir)
        .iter()
        .map(|target| target.dist_dir)
        .collect()
    };
    let dir = |dir: &str| PathId::new(Path::new(dir));

    assert_eq!(dist_dirs(r#"{}"#, None), vec![dir("/root/dist")]);
    assert_eq!(dist_dirs(r#"{}"#, Some("/out")), vec![dir("/out")]);
    assert_eq!(
      dist_dirs(r#"{"targets":{"default":{}}}"#, Some("/out")),
      vec![dir("/out")]
    );

    // Multiple targets build into a subdirectory each, unless they declare a `distDir`, which is
    // relative to the package and takes precedence over `--dist-dir`.
    let pkg = r#"{"targets":{"modern":{},"legacy":{"distDir":"./build/legacy"}}}"#;
    assert_eq!(
      dist_dirs(pkg, None),
      vec![dir("/root/dist/modern"), dir("/root/build/legacy")]
    );
    assert_eq!(
      dist_dirs(pkg, Some("/out")),
      vec![dir("/out/modern"), dir("/root/build/legacy")]
    );

    // Targets set to `false` are skipped.
    assert_eq!(
      dist_dirs(r#"{"targets":{"types":false,"app":{}}}"#, None),
      vec![dir("/root/dist")]
    );
    assert_eq!(
      dist_dirs(r#"{"targets":{"types":false}}"#, None),
      vec![dir("/root/dist")]
    );
  }

  #[test]
  fn test_file_entry_target_engines() {
    let targets = file_entry_targets(
      r#"{
        "browserslist": "Chrome 100",
        "targets": {
          "modern": {},
          "legacy": {"engines": {"browsers": "Chrome 60"}}
        }
      }"#,
      "index.html",
      None,
    );
    let chrome = |target: &Target| target.engines.browsers.chrome.clone();
    assert_eq!(targets.len(), 2);
    assert_eq!(
      chrome(&targets[0]),
      Some(Version::new(NonZero::new(100).unwrap(), 0))
    );
    assert_eq!(
      chrome(&targets[1]),
      Some(Version::new(NonZero::new(60).unwrap(), 0))
    );

    // A target's engines also determine its context.
    let targets = file_entry_targets(
      r#"{"targets": {"server": {"engines": {"node": ">= 20"}}}}"#,
      "index.js",
      None,
    );
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0].environment, Environment::Node);
    assert_eq!(
      targets[0].engines.node,
      Some(Version::new(NonZero::new(20).unwrap(), 0))
    );
  }

  /// Resolves the `/root` package with the given package.json.
  fn package_entries(pkg: &str, dist_dir: Option<&str>) -> Result<Vec<Entry>, crate::Diagnostic> {
    let fs = MemoryFileSystem::new();
    fs.mkdir(Path::new("/root")).unwrap();
    fs.mkdir(Path::new("/root/src")).unwrap();
    fs.write(
      PathId::new(Path::new("/root/package.json")),
      &pkg.as_bytes().to_vec(),
    )
    .unwrap();
    fs.write(PathId::new(Path::new("/root/src/foo.js")), &Vec::new())
      .unwrap();
    fs.write(PathId::new(Path::new("/root/src/bar.html")), &Vec::new())
      .unwrap();
    let fs = Arc::new(fs);
    resolve_entries(
      &vec!["/root".into()],
      &crate::BuildOptions {
        input_fs: fs.clone(),
        output_fs: fs,
        env: HashMap::new(),
        log_level: crate::LogLevel::Error,
        mode: crate::BuildMode::Development,
        optimize: None,
        content_hash: None,
        config: None,
        cwd: PathId::new(Path::new("/root")),
        source_map: None,
        dist_dir: dist_dir.map(|dir| PathId::new(Path::new(dir))),
        public_url: Default::default(),
        hmr: None,
        reporters: Vec::new(),
      },
    )
    .map(|(entries, _)| entries)
  }

  #[test]
  fn test_package_source_app_entries() {
    let entries = package_entries(
      r#"{"source": ["src/foo.js", "src/bar.html"], "browserslist": "Chrome 100"}"#,
      None,
    )
    .unwrap();
    let urls: Vec<_> = entries.iter().map(|e| e.url.to_string()).collect();
    assert_eq!(
      urls,
      vec!["file:///root/src/foo.js", "file:///root/src/bar.html"]
    );
    for entry in &entries {
      assert_eq!(entry.target.dist_dir, PathId::new(Path::new("/root/dist")));
      assert_eq!(
        entry.target.engines.browsers.chrome,
        Some(Version::new(NonZero::new(100).unwrap(), 0))
      );
      assert!(!entry.target.flags.contains(EnvironmentFlags::IS_LIBRARY));
    }

    // `--dist-dir` and targets apply as for CLI entries.
    let entries = package_entries(
      r#"{"source": "src/foo.js", "engines": {"node": ">= 20"}, "targets": {"a": {}, "b": {}}}"#,
      Some("/out"),
    )
    .unwrap();
    let targets: Vec<_> = entries
      .iter()
      .map(|e| (e.target.dist_dir, e.target.environment))
      .collect();
    assert_eq!(
      targets,
      vec![
        (PathId::new(Path::new("/out/a")), Environment::Node),
        (PathId::new(Path::new("/out/b")), Environment::Node)
      ]
    );

    // Library outputs need a single source.
    assert!(
      package_entries(
        r#"{"source": ["src/foo.js"], "main": "dist/main.js"}"#,
        None
      )
      .is_ok()
    );
    assert!(
      package_entries(
        r#"{"source": ["src/foo.js", "src/bar.html"], "main": "dist/main.js"}"#,
        None
      )
      .is_err()
    );
  }
}
