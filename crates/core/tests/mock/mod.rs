//! Reusable mock plugins and test infrastructure for `parcel_core` integration tests.
//!
//! Living in a subdirectory (`tests/mock/mod.rs`) means cargo does not treat this file as its
//! own test binary; it is included via `mod mock;` from the test files that need it.

use std::{
  collections::HashSet,
  hash::{Hash, Hasher},
  io::Result as IoResult,
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
};

use parcel_core::{
  Asset, AssetGraph, AssetNode, AssetRequest, AssetType, Bundle, BundleBehavior, BundleFlags,
  BundleGraph, Bundler, BuildMode, BuildOptions, BufferContent, Content, Dependency,
  DependencyFlags, DependencyResolution, Diagnostic, DiagnosticList, DirEntry, ExportsCondition,
  FileKind, FileStat, FileSystem, LogLevel, MemoryFileSystem, Namer, Optimizer, ParcelConfig,
  ParcelOptions, PluginFactory, Priority, Resolver, SourceLocation, SourceUrl, SpecifierType,
  Transformer,
};

// ===========================================================================
// File system helpers
// ===========================================================================

/// Writes `contents` to `path` in `fs`, creating parent directories as needed.
pub fn write_file(fs: &MemoryFileSystem, path: &str, contents: &str) {
  let path = Path::new(path);
  if let Some(parent) = path.parent() {
    fs.create_dir_all(parent).unwrap();
  }
  fs.write(path, &contents.as_bytes().to_vec()).unwrap();
}

/// Builds `BuildOptions` rooted at `/project` backed by the given file systems.
pub fn build_options(
  input_fs: Arc<dyn FileSystem>,
  output_fs: Arc<dyn FileSystem>,
) -> BuildOptions {
  BuildOptions {
    mode: BuildMode::Development,
    env: Default::default(),
    log_level: LogLevel::Error,
    input_fs,
    output_fs,
    config: None,
    // Setting cwd to the project directory makes `find_project_root` (which falls back to cwd
    // when no lockfile is found on disk) deterministically resolve the project root to /project.
    cwd: PathBuf::from("/project"),
  }
}

/// Computes the project-relative `SourceUrl` for an absolute path, matching the URLs assets use.
pub fn source_url(project_root: &SourceUrl, path: &str) -> SourceUrl {
  SourceUrl::from_path(Path::new(path), project_root).unwrap()
}

/// A `FileSystem` wrapper that records every `write` and `remove_file` call, delegating all
/// operations to an inner `MemoryFileSystem`. Used to assert exactly which bundle outputs were
/// (re)written during a build.
pub struct RecordingFileSystem {
  inner: MemoryFileSystem,
  writes: Mutex<Vec<PathBuf>>,
  removes: Mutex<Vec<PathBuf>>,
}

impl RecordingFileSystem {
  pub fn new() -> Self {
    RecordingFileSystem {
      inner: MemoryFileSystem::new(),
      writes: Mutex::new(Vec::new()),
      removes: Mutex::new(Vec::new()),
    }
  }

  /// Returns and clears the list of paths written since the last call.
  pub fn take_writes(&self) -> Vec<PathBuf> {
    std::mem::take(&mut *self.writes.lock().unwrap())
  }

  /// Returns and clears the list of paths removed since the last call.
  pub fn take_removes(&self) -> Vec<PathBuf> {
    std::mem::take(&mut *self.removes.lock().unwrap())
  }
}

impl FileSystem for RecordingFileSystem {
  fn read(&self, path: &Path) -> IoResult<Vec<u8>> {
    self.inner.read(path)
  }

  fn kind(&self, path: &Path) -> FileKind {
    self.inner.kind(path)
  }

  fn stat(&self, path: &Path) -> Option<FileStat> {
    self.inner.stat(path)
  }

  fn lstat(&self, path: &Path) -> Option<FileStat> {
    self.inner.lstat(path)
  }

  fn read_link(&self, path: &Path) -> IoResult<PathBuf> {
    self.inner.read_link(path)
  }

  fn write(&self, path: &Path, contents: &Vec<u8>) -> IoResult<()> {
    self.writes.lock().unwrap().push(path.to_path_buf());
    self.inner.write(path, contents)
  }

  fn remove_file(&self, path: &Path) -> IoResult<()> {
    self.removes.lock().unwrap().push(path.to_path_buf());
    self.inner.remove_file(path)
  }

  fn read_dir(&self, path: &Path) -> IoResult<Vec<DirEntry>> {
    self.inner.read_dir(path)
  }

  fn create_dir_all(&self, path: &Path) -> IoResult<()> {
    self.inner.create_dir_all(path)
  }
}

// ===========================================================================
// Mock content
// ===========================================================================

/// The content produced by `MockTransformer` for a single asset. Its `package` implementation
/// concatenates the transformed code of every asset in the bundle, mirroring how a real JS
/// packager combines modules.
#[derive(Debug)]
struct MockContent {
  code: Vec<u8>,
}

impl Content for MockContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(self.code.clone())
  }

  fn hash(&self, mut state: &mut dyn Hasher) {
    self.code.hash(&mut state);
  }

  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    _get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    _options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    let mut out = Vec::new();
    for &index in &bundle.assets {
      let asset = bundle_graph.asset_graph.assets[index].expect_asset();
      out.extend_from_slice(&asset.content.read()?);
      out.push(b'\n');
    }
    Ok(Arc::new(BufferContent::new(out)))
  }
}

// ===========================================================================
// Mock transformer
// ===========================================================================

/// Parses the tiny mock language: `@import <spec>` / `@async <spec>` lines become dependencies,
/// all other lines are kept as code. Each asset's content is replaced with a `MockContent`
/// holding the stripped code so the packager can concatenate it.
struct MockTransformer;

impl Transformer for MockTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    _options: &ParcelOptions,
  ) -> Result<Asset, DiagnosticList> {
    let content = asset.content.read()?;
    let text = String::from_utf8(content).map_err(Diagnostic::from)?;

    let url = asset.loc.url.clone();
    let target = asset.target.clone();
    let mut code = String::new();

    for line in text.lines() {
      let trimmed = line.trim();
      if let Some(spec) = trimmed.strip_prefix("@import ") {
        asset
          .dependencies
          .push(make_dep(spec.trim(), Priority::Sync, &url, target.clone()));
      } else if let Some(spec) = trimmed.strip_prefix("@async ") {
        asset
          .dependencies
          .push(make_dep(spec.trim(), Priority::Lazy, &url, target.clone()));
      } else {
        code.push_str(line);
        code.push('\n');
      }
    }

    asset.content = Arc::new(MockContent {
      code: code.into_bytes(),
    });
    Ok(asset)
  }
}

fn make_dep(
  specifier: &str,
  priority: Priority,
  from: &SourceUrl,
  target: Arc<parcel_core::Target>,
) -> Dependency {
  Dependency {
    specifier: specifier.to_string(),
    specifier_type: SpecifierType::Esm,
    priority,
    bundle_behavior: BundleBehavior::None,
    flags: DependencyFlags::empty(),
    target,
    loc: None,
    placeholder: None,
    resolve_from: Some(from.clone()),
    range: None,
    conditions: ExportsCondition::empty(),
    resolution: DependencyResolution::None,
  }
}

// ===========================================================================
// Mock resolver
// ===========================================================================

/// Resolves relative specifiers against the importing file, producing an `AssetRequest` that
/// reads the resolved file from the input file system. Every resolved asset is marked with
/// `side_effects: true` so it is always transformed (this keeps the mock graph simple and
/// independent of symbol-level tree shaking).
///
/// Specifiers beginning with `#` are *aliases* resolved through a project-level config file
/// (`aliases.json`). When an alias is used, the config file is recorded as an
/// `invalidate_on_file_change` dependency of the importing asset, so editing the config
/// re-resolves and rebuilds the affected assets — mirroring a real resolver that depends on a
/// configuration file (tsconfig, package.json aliases, etc.).
struct MockResolver;

/// The project-relative URL of the alias config file consulted by `MockResolver`.
fn alias_config_url() -> SourceUrl {
  SourceUrl::parse("project:///aliases.json").unwrap()
}

impl Resolver for MockResolver {
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    _pipeline: Option<&str>,
    options: &ParcelOptions,
    invalidations: &mut parcel_core::Invalidations,
  ) -> Result<DependencyResolution, DiagnosticList> {
    let resolved = if specifier.starts_with('#') {
      // Alias specifier: look it up in the config file, recording a dependency on that file so
      // changes to it invalidate (and rebuild) the importer.
      let config_url = alias_config_url();
      invalidations
        .invalidate_on_file_change
        .push(config_url.clone());

      let config_path = config_url.to_file_path(&options.project_root)?;
      let bytes = options.input_fs.read(&config_path).map_err(Diagnostic::from)?;
      let aliases: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(&bytes).map_err(Diagnostic::from)?;

      let target = aliases
        .get(specifier)
        .and_then(|v| v.as_str())
        .ok_or_else(|| Diagnostic::from_message(format!("no alias for {}", specifier)))?;

      // Alias targets are relative to the config file (the project root).
      config_url.join(target)
    } else {
      let base = dep
        .resolve_from
        .clone()
        .or_else(|| dep.loc.as_ref().map(|loc| loc.url.clone()))
        .ok_or_else(|| Diagnostic::from_message("dependency has no base to resolve from".into()))?;
      base.join(specifier)
    };

    let file_path = resolved.to_file_path(&options.project_root)?;

    let ty = AssetType::from_url(&resolved);
    let content: Arc<dyn Content> =
      Arc::new(parcel_core::FileContent::new(file_path, options.input_fs.clone()));

    Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
      loc: SourceLocation {
        url: resolved,
        start: Default::default(),
        end: Default::default(),
      },
      ty,
      pipeline: None,
      target: dep.target.clone(),
      content,
      side_effects: true,
    })))
  }
}

// ===========================================================================
// Mock bundler
// ===========================================================================

/// A minimal bundler: each entry becomes a bundle containing the entry asset and everything
/// reachable through synchronous dependencies. Async dependencies (`Priority != Sync`) start
/// new bundles. Shared sync assets are duplicated into each referencing bundle.
#[derive(Default)]
struct MockBundler;

impl Bundler for MockBundler {
  fn bundle(&self, asset_graph: AssetGraph) -> Result<BundleGraph, DiagnosticList> {
    // Bundle roots: start with the entries (in order), then async targets discovered while
    // walking each bundle's synchronous subgraph.
    let mut roots: Vec<(usize, bool)> = Vec::new();
    let mut seen_roots: HashSet<usize> = HashSet::new();
    for entry in &asset_graph.entries {
      if let Some(index) = entry.asset {
        if seen_roots.insert(index) {
          roots.push((index, true));
        }
      }
    }

    let mut bundles = Vec::new();
    let mut i = 0;
    while i < roots.len() {
      let (root, is_entry) = roots[i];
      i += 1;

      let mut assets = Vec::new();
      let mut visited = HashSet::new();
      let mut async_targets = Vec::new();
      collect_sync(&asset_graph, root, &mut visited, &mut assets, &mut async_targets);

      for target in async_targets {
        if seen_roots.insert(target) {
          roots.push((target, false));
        }
      }

      let root_asset = asset_graph.assets[root].expect_asset();
      let mut flags = BundleFlags::empty();
      if is_entry {
        flags |= BundleFlags::ENTRY;
      }

      bundles.push(Bundle {
        ty: root_asset.ty.clone(),
        target: root_asset.target.clone(),
        bundle_behavior: BundleBehavior::None,
        flags,
        name: None,
        assets,
        entry_assets: vec![root],
        main_entry_asset: Some(root),
        referenced_bundles: Vec::new(),
      });
    }

    Ok(BundleGraph {
      asset_graph,
      bundles,
      project_root: SourceUrl::default(),
    })
  }
}

/// Pre-order DFS collecting synchronously-reachable assets into `assets`, recording the targets
/// of async dependencies into `async_targets`.
fn collect_sync(
  graph: &AssetGraph,
  index: usize,
  visited: &mut HashSet<usize>,
  assets: &mut Vec<usize>,
  async_targets: &mut Vec<usize>,
) {
  if !visited.insert(index) {
    return;
  }
  let AssetNode::Asset(asset) = &graph.assets[index] else {
    return;
  };
  assets.push(index);

  for dep in &asset.dependencies {
    if let DependencyResolution::Asset(target) = dep.resolution {
      let target = target as usize;
      if dep.priority == Priority::Sync {
        collect_sync(graph, target, visited, assets, async_targets);
      } else {
        async_targets.push(target);
      }
    }
  }
}

// ===========================================================================
// Mock namer
// ===========================================================================

/// Names a bundle after its main entry asset's file stem and the bundle's type extension
/// (e.g. `index.js`), preferring an entry's explicit `dist_entry` when present.
struct MockNamer;

impl Namer for MockNamer {
  fn name(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    _options: &ParcelOptions,
  ) -> Result<Option<String>, DiagnosticList> {
    let main = bundle.main_entry_asset.expect("bundle has no main entry asset");

    if let Some(entry) = bundle_graph
      .asset_graph
      .entries
      .iter()
      .find(|e| e.asset == Some(main))
    {
      if let Some(dist_entry) = &entry.dist_entry {
        return Ok(Some(dist_entry.clone()));
      }
    }

    let asset = bundle_graph.asset_graph.assets[main].expect_asset();
    let path = asset.loc.url.path();
    let file = path.rsplit('/').next().unwrap_or(path);
    let stem = file.rsplit_once('.').map(|(s, _)| s).unwrap_or(file);
    Ok(Some(format!("{}.{}", stem, bundle.ty.extension())))
  }
}

// ===========================================================================
// Plugin factory
// ===========================================================================

/// A `PluginFactory` wiring up the mock plugins. The default config is built from an inline
/// `.parcelrc`-style JSON that references each mock plugin by name.
pub struct MockPluginFactory;

const MOCK_CONFIG: &str = r#"{
  "resolvers": ["@mock/resolver"],
  "transformers": { "*": ["@mock/transformer"] },
  "bundler": "@mock/bundler",
  "namers": ["@mock/namer"],
  "optimizers": {}
}"#;

impl PluginFactory for MockPluginFactory {
  fn config(&self, _specifier: &str, from: &Path) -> Result<ParcelConfig, DiagnosticList> {
    ParcelConfig::from_json(from, MOCK_CONFIG.as_bytes(), self)
  }

  fn resolver(
    &self,
    _name: &str,
    _config: Option<serde_json::Value>,
    _from: &Path,
  ) -> Result<Arc<dyn Resolver>, DiagnosticList> {
    Ok(Arc::new(MockResolver))
  }

  fn transformer(
    &self,
    _name: &str,
    _config: Option<serde_json::Value>,
    _from: &Path,
  ) -> Result<Arc<dyn Transformer>, DiagnosticList> {
    Ok(Arc::new(MockTransformer))
  }

  fn bundler(
    &self,
    _name: &str,
    _config: Option<serde_json::Value>,
    _from: &Path,
  ) -> Result<Arc<dyn Bundler>, DiagnosticList> {
    Ok(Arc::new(MockBundler::default()))
  }

  fn namer(
    &self,
    _name: &str,
    _config: Option<serde_json::Value>,
    _from: &Path,
  ) -> Result<Arc<dyn Namer>, DiagnosticList> {
    Ok(Arc::new(MockNamer))
  }

  fn optimizer(
    &self,
    name: &str,
    _config: Option<serde_json::Value>,
    _from: &Path,
  ) -> Result<Arc<dyn Optimizer>, DiagnosticList> {
    Err(Diagnostic::from_message(format!("no mock optimizer named {}", name)).into())
  }
}
