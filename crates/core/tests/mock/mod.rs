//! Reusable mock plugins and test infrastructure for `parcel_core` integration tests.
//!
//! Living in a subdirectory (`tests/mock/mod.rs`) means cargo does not treat this file as its
//! own test binary; it is included via `mod mock;` from the test files that need it.

use std::{
  collections::{HashMap, HashSet},
  hash::{Hash, Hasher},
  io::Result as IoResult,
  path::{Path, PathBuf},
  sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
  },
};

use parcel_core::{
  Asset, AssetGraph, AssetIndex, AssetRequest, AssetType, BufferContent, BuildMode, BuildOptions,
  Bundle, BundleBehavior, BundleFlags, BundleGraph, Bundler, Content, Dependency, DependencyFlags,
  DependencyResolution, Diagnostic, DiagnosticList, DirEntry, ExportsCondition, FileKind, FileStat,
  FileSystem, LogLevel, LogMessage, MemoryFileSystem, Namer, Optimizer, ParcelConfig,
  ParcelOptions, PathId, PluginFactory, Priority, Reporter, ReporterEvent, Resolver,
  SourceLocation, SourceUrl, SpecifierType, SubPath, Transformer,
};

// ===========================================================================
// File system helpers
// ===========================================================================

/// Writes `contents` to `path` in `fs`, creating parent directories as needed.
pub fn write_file(fs: &MemoryFileSystem, path: &str, contents: &str) {
  let path = Path::new(path);
  if let Some(parent) = path.parent() {
    fs.create_dir_all(PathId::new(parent)).unwrap();
  }
  fs.write(PathId::new(path), &contents.as_bytes().to_vec())
    .unwrap();
}

/// Builds `BuildOptions` rooted at `/project` backed by the given file systems.
pub fn build_options(
  input_fs: Arc<dyn FileSystem>,
  output_fs: Arc<dyn FileSystem>,
) -> BuildOptions {
  BuildOptions {
    mode: BuildMode::Development,
    optimize: None,
    source_map: Some(Default::default()),
    env: Default::default(),
    log_level: LogLevel::Error,
    input_fs,
    output_fs,
    config: None,
    // Setting cwd to the project directory makes `find_project_root` (which falls back to cwd
    // when no lockfile is found on disk) deterministically resolve the project root to /project.
    cwd: PathId::new(Path::new("/project")),
    dist_dir: None,
    public_url: Default::default(),
    hmr: None,
  }
}

/// A `FileSystem` wrapper that records every `write` and `remove_file` call, delegating all
/// operations to an inner `MemoryFileSystem`. Used to assert exactly which bundle outputs were
/// (re)written during a build.
pub struct RecordingFileSystem {
  inner: MemoryFileSystem,
  writes: Mutex<Vec<PathBuf>>,
  removes: Mutex<Vec<PathBuf>>,
  /// When set, every `write` call fails with a simulated I/O error instead of touching `inner`.
  /// Used to test that packaging failures propagate as a `DiagnosticList` instead of panicking
  /// or silently succeeding.
  fail_writes: AtomicBool,
}

impl RecordingFileSystem {
  pub fn new() -> Self {
    RecordingFileSystem {
      inner: MemoryFileSystem::new(),
      writes: Mutex::new(Vec::new()),
      removes: Mutex::new(Vec::new()),
      fail_writes: AtomicBool::new(false),
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

  /// When `fail` is true, every subsequent `write` call returns a simulated I/O error instead of
  /// succeeding, to test build-failure propagation for output write errors.
  pub fn set_fail_writes(&self, fail: bool) {
    self.fail_writes.store(fail, Ordering::SeqCst);
  }
}

impl FileSystem for RecordingFileSystem {
  fn read(&self, path: PathId) -> IoResult<Vec<u8>> {
    self.inner.read(path)
  }

  fn kind(&self, path: PathId) -> FileKind {
    self.inner.kind(path)
  }

  fn stat(&self, path: PathId) -> Option<FileStat> {
    self.inner.stat(path)
  }

  fn lstat(&self, path: PathId) -> Option<FileStat> {
    self.inner.lstat(path)
  }

  fn read_link(&self, path: PathId) -> IoResult<PathId> {
    self.inner.read_link(path)
  }

  fn write(&self, path: PathId, contents: &[u8]) -> IoResult<()> {
    if self.fail_writes.load(Ordering::SeqCst) {
      return Err(std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        "simulated write failure",
      ));
    }
    self.writes.lock().unwrap().push(path.to_path_buf());
    self.inner.write(path, contents)
  }

  fn remove_file(&self, path: PathId) -> IoResult<()> {
    self.removes.lock().unwrap().push(path.to_path_buf());
    self.inner.remove_file(path)
  }

  fn read_dir(&self, path: PathId) -> IoResult<Vec<DirEntry>> {
    self.inner.read_dir(path)
  }

  fn create_dir_all(&self, path: PathId) -> IoResult<()> {
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
      let asset = &bundle_graph.asset_graph.asset(index);
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
///
/// A `@config <abs-path>` line reads a file through the per-request `fs` and appends its contents
/// to the output. Because `fs` is a tracking file system, editing that config file automatically
/// re-runs this transform — demonstrating transformer-level invalidation tracking.
struct MockTransformer;

impl Transformer for MockTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    options: &ParcelOptions,
    fs: &Arc<dyn FileSystem>,
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
      } else if let Some(path) = trimmed.strip_prefix("@config ") {
        // Read a config file through the tracking fs. Its absolute path is derived from the
        // project root so the test can edit it via the input file system.
        let config_path = options.project_root.join(Path::new(path.trim()));
        let bytes = fs.read(config_path).map_err(Diagnostic::from)?;
        code.push_str(std::str::from_utf8(&bytes).map_err(Diagnostic::from)?);
        code.push('\n');
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
/// Specifiers beginning with `#` are *aliases* resolved through the nearest `aliases.json`
/// ancestor. When an alias is used, the config file is recorded as an `invalidate_on_file_change`
/// dependency of the importing asset, and closer `aliases.json` files are recorded as
/// create-above invalidations.
///
/// Specifiers beginning with `glob:` resolve to the first file matching the pattern, recording a
/// create-glob invalidation so new matching files can re-resolve the importer.
struct MockResolver;

impl Resolver for MockResolver {
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    _pipeline: Option<&str>,
    options: &ParcelOptions,
    fs: &Arc<dyn FileSystem>,
  ) -> Result<DependencyResolution, DiagnosticList> {
    let base = dep
      .resolve_from
      .clone()
      .or_else(|| dep.loc.as_ref().map(|loc| loc.url.clone()))
      .ok_or_else(|| Diagnostic::from_message("dependency has no base to resolve from".into()))?;

    let resolved = if specifier.starts_with('#') {
      // Alias specifier: look it up in the nearest aliases.json. Both the ancestor search and
      // config read go through `fs`, so the tracking filesystem records create-above and change
      // invalidations for the importer.
      let base_path = base.to_file_path()?;
      let from_dir = base_path.parent().unwrap_or(options.project_root);
      let config_path = fs
        .find_ancestor(
          from_dir,
          &SubPath::file("aliases.json"),
          FileKind::IS_FILE,
          options.project_root,
        )
        .ok_or_else(|| Diagnostic::from_message(format!("no aliases.json for {}", specifier)))?;
      let config_url = SourceUrl::from_path(&config_path);
      let bytes = fs.read(config_path).map_err(Diagnostic::from)?;
      let aliases: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(&bytes).map_err(Diagnostic::from)?;

      let target = aliases
        .get(specifier)
        .and_then(|v| v.as_str())
        .ok_or_else(|| Diagnostic::from_message(format!("no alias for {}", specifier)))?;

      // Alias targets are relative to the config file.
      config_url.join(target)
    } else if let Some(pattern) = specifier.strip_prefix("glob:") {
      let matches = fs.glob(pattern, options.project_root);
      let file_path = matches
        .first()
        .ok_or_else(|| Diagnostic::from_message(format!("no files matched {}", pattern)))?;
      SourceUrl::from_path(file_path)
    } else {
      base.join(specifier)
    };

    let file_path = resolved.to_file_path()?;

    let ty = AssetType::from_url(&resolved);
    let content: Arc<dyn Content> = Arc::new(parcel_core::FileContent::new(
      file_path,
      options.input_fs.clone(),
    ));

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
  fn bundle<'a>(
    &self,
    asset_graph: AssetGraph<'a>,
    _options: &ParcelOptions,
  ) -> Result<BundleGraph<'a>, DiagnosticList> {
    // Bundle roots: start with the entries (in order), then async targets discovered while
    // walking each bundle's synchronous subgraph.
    let mut roots: Vec<(AssetIndex, bool)> = Vec::new();
    let mut seen_roots: HashSet<AssetIndex> = HashSet::new();
    for entry in asset_graph.entries.iter() {
      if let Some(index) = asset_graph.resolved_entry(entry) {
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
      collect_sync(
        &asset_graph,
        root,
        &mut visited,
        &mut assets,
        &mut async_targets,
      );

      for target in async_targets {
        if seen_roots.insert(target) {
          roots.push((target, false));
        }
      }

      let root_asset = &asset_graph.asset(root);
      let mut flags = BundleFlags::empty();
      if is_entry {
        flags |= BundleFlags::ENTRY;
      }

      bundles.push(Bundle {
        ty: root_asset.ty.clone(),
        target: root_asset.target.clone(),
        bundle_behavior: BundleBehavior::None,
        flags,
        dist_path: None,
        assets,
        entry_assets: vec![root],
        main_entry_asset: Some(root),
        referenced_bundles: Vec::new(),
      });
    }

    Ok(BundleGraph::new(
      asset_graph,
      bundles,
      HashMap::new(),
      PathId::root(),
    ))
  }
}

/// Pre-order DFS collecting synchronously-reachable assets into `assets`, recording the targets
/// of async dependencies into `async_targets`.
fn collect_sync(
  graph: &AssetGraph,
  index: AssetIndex,
  visited: &mut HashSet<AssetIndex>,
  assets: &mut Vec<AssetIndex>,
  async_targets: &mut Vec<AssetIndex>,
) {
  if !visited.insert(index) {
    return;
  }
  assets.push(index);

  let asset = &graph.asset(index);
  for dep in &asset.dependencies {
    if let Some((target, _)) = graph.resolved_asset(dep) {
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
  ) -> Result<Option<PathId>, DiagnosticList> {
    let main = bundle
      .main_entry_asset
      .expect("bundle has no main entry asset");

    if let Some(entry) = bundle_graph
      .asset_graph
      .entries
      .iter()
      .find(|e| bundle_graph.asset_graph.resolved_entry(e) == Some(main))
    {
      if let Some(dist_entry) = entry.dist_entry {
        return Ok(Some(dist_entry));
      }
    }

    let asset = &bundle_graph.asset_graph.asset(main);
    let path = asset.loc.url.to_file_path().unwrap();
    let file = path.file_name();
    let stem = file.rsplit_once('.').map(|(s, _)| s).unwrap_or(file);
    Ok(Some(bundle.target.dist_dir.child(&format!(
      "{}.{}",
      stem,
      bundle.ty.extension()
    ))))
  }
}

// ===========================================================================
// Plugin factory
// ===========================================================================

/// A `PluginFactory` wiring up the mock plugins. The default config is built from an inline
/// `.parcelrc`-style JSON that references each mock plugin by name.
#[derive(Default)]
pub struct MockPluginFactory {
  /// Returned for every name in the config's `reporters`. When this is set, the
  /// config gains a `reporters` entry — a build with no reporters starts no
  /// dispatch thread, so tests that do not care about reporting pay nothing.
  pub reporter: Option<Arc<dyn Reporter>>,
}

pub const MOCK_CONFIG: &str = r#"{
  "resolvers": ["@mock/resolver"],
  "transformers": { "*": ["@mock/transformer"] },
  "bundler": "@mock/bundler",
  "namers": ["@mock/namer"],
  "optimizers": {}
}"#;

pub const MOCK_CONFIG_WITH_REPORTER: &str = r#"{
  "resolvers": ["@mock/resolver"],
  "transformers": { "*": ["@mock/transformer"] },
  "bundler": "@mock/bundler",
  "namers": ["@mock/namer"],
  "optimizers": {},
  "reporters": ["@mock/reporter"]
}"#;

/// Records the name of every event it is given.
pub struct MockReporter {
  pub events: Arc<Mutex<Vec<String>>>,
}

impl MockReporter {
  pub fn new() -> (Arc<MockReporter>, Arc<Mutex<Vec<String>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    (
      Arc::new(MockReporter {
        events: events.clone(),
      }),
      events,
    )
  }
}

impl Reporter for MockReporter {
  fn report(&self, event: &ReporterEvent, options: &ParcelOptions) -> Result<(), DiagnosticList> {
    let name = match event {
      ReporterEvent::BuildStart => "buildStart".to_owned(),
      ReporterEvent::BuildSuccess(success) => format!(
        "buildSuccess: {} bundles, {} changed assets",
        success.bundle_graph.bundles.len(),
        success.changed_assets.len()
      ),
      ReporterEvent::BuildFailure { diagnostics } => {
        format!("buildFailure: {}", diagnostics.0.len())
      }
      ReporterEvent::Log(log) => match log.message {
        LogMessage::Text(text) => format!("log {}: {}", log.level, text),
        LogMessage::Diagnostics(diagnostics) => {
          format!("log {}: {} diagnostics", log.level, diagnostics.len())
        }
      },
      _ => "unknown".to_owned(),
    };

    // Proves the options reached the reporter rather than the event being
    // dispatched against a dead `Weak`.
    assert_eq!(options.project_root, PathId::new(Path::new("/project")));

    self.events.lock().unwrap().push(name);
    Ok(())
  }
}

impl PluginFactory for MockPluginFactory {
  fn config(&self, _specifier: &str, from: PathId) -> Result<ParcelConfig, DiagnosticList> {
    let config = match self.reporter {
      Some(_) => MOCK_CONFIG_WITH_REPORTER,
      None => MOCK_CONFIG,
    };
    ParcelConfig::from_json(from, config.as_bytes(), self)
  }

  fn reporter(
    &self,
    name: &str,
    _config: Option<serde_json::Value>,
    _from: PathId,
  ) -> Result<Arc<dyn Reporter>, DiagnosticList> {
    self
      .reporter
      .clone()
      .ok_or_else(|| Diagnostic::from_message(format!("no mock reporter named {}", name)).into())
  }

  fn resolver(
    &self,
    _name: &str,
    _config: Option<serde_json::Value>,
    _from: PathId,
  ) -> Result<Arc<dyn Resolver>, DiagnosticList> {
    Ok(Arc::new(MockResolver))
  }

  fn transformer(
    &self,
    _name: &str,
    _config: Option<serde_json::Value>,
    _from: PathId,
  ) -> Result<Arc<dyn Transformer>, DiagnosticList> {
    Ok(Arc::new(MockTransformer))
  }

  fn bundler(
    &self,
    _name: &str,
    _config: Option<serde_json::Value>,
    _from: PathId,
  ) -> Result<Arc<dyn Bundler>, DiagnosticList> {
    Ok(Arc::new(MockBundler::default()))
  }

  fn namer(
    &self,
    _name: &str,
    _config: Option<serde_json::Value>,
    _from: PathId,
  ) -> Result<Arc<dyn Namer>, DiagnosticList> {
    Ok(Arc::new(MockNamer))
  }

  fn optimizer(
    &self,
    name: &str,
    _config: Option<serde_json::Value>,
    _from: PathId,
  ) -> Result<Arc<dyn Optimizer>, DiagnosticList> {
    Err(Diagnostic::from_message(format!("no mock optimizer named {}", name)).into())
  }
}
