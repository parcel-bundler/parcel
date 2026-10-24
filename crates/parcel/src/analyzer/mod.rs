//! The bundle analysis written by `--analyze`: a self-contained HTML page showing the sizes in
//! `generate_build_metrics` as a treemap, the modules duplicated between bundles, and details of
//! each bundle and module: how bundles are loaded, why modules are included, and which of their
//! exports are used.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::LazyLock;

use parcel_core::{
  AssetFlags, AssetIndex, BundleBehavior, BundleFlags, BundleGraph,
  BundleGraphDependencyResolution, ParcelOptions, PathId, Priority, SpecifierType,
};
use serde::Serialize;

use crate::bundle_report::BundleStats;

static SCRIPT_BYTES: LazyLock<Vec<u8>> =
  LazyLock::new(|| deflate_macro::decompress!("src/analyzer/client.js"));
static STYLE_BYTES: LazyLock<Vec<u8>> =
  LazyLock::new(|| deflate_macro::decompress!("src/analyzer/client.css"));

#[derive(Serialize)]
struct Report {
  title: String,
  /// Source paths relative to the project root, which bundle contents refer to by index.
  paths: Vec<String>,
  bundles: Vec<ReportBundle>,
  /// The assets with source files, which everything else refers to by index.
  assets: Vec<ReportAsset>,
}

#[derive(Serialize)]
struct ReportBundle {
  /// Relative to the project root.
  name: String,
  size: u64,
  gzip: u64,
  /// Pairs of a path index (null for code from unknown sources) and a size, largest first.
  assets: Vec<(Option<u32>, u64)>,
  entry: bool,
  /// The assets the bundle executes when it loads.
  #[serde(skip_serializing_if = "Vec::is_empty")]
  entries: Vec<u32>,
  /// The bundles that load this one, by index, and how (see `load_kind`).
  #[serde(skip_serializing_if = "Vec::is_empty")]
  loaded_by: Vec<(u32, &'static str)>,
}

/// An asset. A source file can produce several, e.g. when it's built for several targets, through
/// a named pipeline, or when a transformer extracts code from it (e.g. CSS from macros).
#[derive(Serialize, Default)]
struct ReportAsset {
  /// The source file's path index.
  path: u32,
  #[serde(rename = "type")]
  ty: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pipeline: Option<String>,
  /// The environment, if not a browser.
  #[serde(skip_serializing_if = "Option::is_none")]
  env: Option<&'static str>,
  /// Whether a transformer created the asset from another (e.g. inline or macro code).
  #[serde(skip_serializing_if = "std::ops::Not::not")]
  generated: bool,
  /// Indices of the bundles that include this asset.
  bundles: Vec<u32>,
  /// The asset that first imports this one on the shortest path from an entry, the specifier,
  /// and how it's loaded. Following these leads to an entry.
  #[serde(skip_serializing_if = "Option::is_none")]
  via: Option<(u32, String, &'static str)>,
  #[serde(skip_serializing_if = "std::ops::Not::not")]
  entry: bool,
  /// The assets that import this one.
  #[serde(skip_serializing_if = "Vec::is_empty")]
  importers: Vec<u32>,
  /// Pairs of an export name and whether it's used, with re-exports in `reexports`. Absent when
  /// the asset's exports aren't known statically (e.g. CommonJS with dynamic exports).
  #[serde(skip_serializing_if = "Option::is_none")]
  exports: Option<Vec<(String, bool)>>,
  #[serde(skip_serializing_if = "Vec::is_empty")]
  reexports: Vec<(String, bool)>,
  /// Whether the asset's namespace is used, so all of its exports are.
  #[serde(skip_serializing_if = "std::ops::Not::not")]
  namespace: bool,
}

/// Path indices by path.
struct Paths {
  root: PathId,
  paths: Vec<String>,
  indices: HashMap<PathId, u32>,
}

impl Paths {
  fn index(&mut self, path: PathId) -> u32 {
    *self.indices.entry(path).or_insert_with(|| {
      self.paths.push(relative(path, self.root));
      self.paths.len() as u32 - 1
    })
  }
}

/// How a dependency loads the bundle it resolves to. Bundles loaded together with the bundles that
/// reference them (e.g. shared bundles and stylesheets) are `"with"`.
fn load_kind(priority: Priority, specifier_type: SpecifierType) -> &'static str {
  match (priority, specifier_type) {
    (Priority::Lazy, _) => "lazy",
    (Priority::Parallel, _) => "parallel",
    (_, SpecifierType::Url) => "url",
    _ => "sync",
  }
}

/// Writes the analysis of `bundles` to `parcel-bundle-reports/index.html` in the project root, and
/// returns its path.
pub fn write_report(
  bundles: &[BundleStats],
  bundle_graph: &BundleGraph,
  options: &ParcelOptions,
) -> Result<PathId, parcel_core::Diagnostic> {
  let root = options.project_root;
  let mut paths = Paths {
    root,
    paths: Vec::new(),
    indices: HashMap::new(),
  };
  let asset_graph = &bundle_graph.asset_graph;
  let asset_paths: Vec<Option<PathId>> = asset_graph
    .assets
    .iter()
    .map(|asset| asset.loc.url.to_file_path().ok())
    .collect();
  // Assets with source files by their index in the report.
  let mut report_asset: Vec<Option<u32>> = vec![None; asset_graph.assets.len()];
  let mut next_asset = 0;
  for (index, path) in asset_paths.iter().enumerate() {
    if path.is_some() {
      report_asset[index] = Some(next_asset);
      next_asset += 1;
    }
  }

  let mut report_bundles: Vec<ReportBundle> = bundles
    .iter()
    .map(|bundle| ReportBundle {
      name: relative(bundle.path, root),
      size: bundle.size,
      gzip: bundle.gzip_size.unwrap_or(bundle.size),
      assets: bundle
        .assets
        .iter()
        .map(|asset| (asset.path.map(|path| paths.index(path)), asset.size))
        .collect(),
      entry: false,
      entries: Vec::new(),
      loaded_by: Vec::new(),
    })
    .collect();

  // Bundles in the bundle graph by their index in the report. Inline bundles aren't written.
  let report_indices: HashMap<PathId, u32> = bundles
    .iter()
    .enumerate()
    .map(|(index, bundle)| (bundle.path, index as u32))
    .collect();
  let report_index: Vec<Option<u32>> = bundle_graph
    .bundles
    .iter()
    .map(|bundle| {
      (bundle.bundle_behavior != BundleBehavior::Inline)
        .then(|| report_indices.get(&bundle.dist_path()).copied())
        .flatten()
    })
    .collect();
  let mut asset_bundles: Vec<Vec<u32>> = vec![Vec::new(); asset_graph.assets.len()];
  let mut loaded_by: Vec<HashSet<(u32, &'static str)>> = vec![HashSet::new(); bundles.len()];
  for (bundle, &index) in bundle_graph.bundles.iter().zip(&report_index) {
    let Some(index) = index else { continue };
    let report_bundle = &mut report_bundles[index as usize];
    report_bundle.entry |= bundle.flags.contains(BundleFlags::ENTRY);
    report_bundle.entries.extend(
      bundle
        .entry_assets
        .iter()
        .filter_map(|asset| report_asset[asset.index()]),
    );
    for &asset in &bundle.assets {
      asset_bundles[asset.index()].push(index);
    }
    for &referenced in &bundle.referenced_bundles {
      if let Some(referenced) = report_index[referenced].filter(|&r| r != index) {
        loaded_by[referenced as usize].insert((index, "with"));
      }
    }
  }

  // Modules' importers, and bundles loaded through dependencies.
  let mut importers: Vec<Vec<(AssetIndex, usize)>> = vec![Vec::new(); asset_graph.assets.len()];
  for (asset_index, asset) in asset_graph.assets.iter().enumerate() {
    let asset_index = AssetIndex::from_index(asset_index);
    for (dep_index, dep) in asset.dependencies.iter().enumerate() {
      let target = match bundle_graph.dependency_resolution(asset_index, dep_index) {
        BundleGraphDependencyResolution::Asset(target)
        | BundleGraphDependencyResolution::Internalized(target) => target,
        BundleGraphDependencyResolution::Bundle {
          bundle_index,
          asset_index: target,
        } => {
          if let Some(target_bundle) = report_index[bundle_index as usize] {
            let kind = load_kind(dep.priority, dep.specifier_type);
            for &from in &asset_bundles[asset_index.index()] {
              if from != target_bundle {
                loaded_by[target_bundle as usize].insert((from, kind));
              }
            }
          }
          target
        }
        _ => continue,
      };
      importers[target.index()].push((asset_index, dep_index));
    }
  }
  for (bundle, loaded_by) in report_bundles.iter_mut().zip(loaded_by) {
    bundle.loaded_by = loaded_by.into_iter().collect();
    bundle.loaded_by.sort_unstable();
  }

  // The shortest import chain from an entry to each module.
  let mut depth = vec![u32::MAX; asset_graph.assets.len()];
  let mut via: Vec<Option<(AssetIndex, usize)>> = vec![None; asset_graph.assets.len()];
  let mut queue = VecDeque::new();
  for entry in asset_graph.entries.iter() {
    if let Some(asset) = entry
      .asset
      .and_then(|node| asset_graph.asset_nodes[node.index()].asset)
    {
      depth[asset.index()] = 0;
      queue.push_back(asset);
    }
  }
  while let Some(asset_index) = queue.pop_front() {
    let asset = asset_graph.asset(asset_index);
    for dep_index in 0..asset.dependencies.len() {
      let target = match bundle_graph.dependency_resolution(asset_index, dep_index) {
        BundleGraphDependencyResolution::Asset(target)
        | BundleGraphDependencyResolution::Internalized(target)
        | BundleGraphDependencyResolution::Bundle {
          asset_index: target,
          ..
        } => target,
        _ => continue,
      };
      if depth[target.index()] == u32::MAX {
        depth[target.index()] = depth[asset_index.index()] + 1;
        via[target.index()] = Some((asset_index, dep_index));
        queue.push_back(target);
      }
    }
  }

  let mut report_assets = Vec::with_capacity(next_asset as usize);
  for (index, path) in asset_paths.iter().enumerate() {
    let Some(path) = *path else { continue };
    let asset = &asset_graph.assets[index];
    let environment = &asset.target.environment;
    let mut report = ReportAsset {
      path: paths.index(path),
      ty: asset.ty.extension().to_owned(),
      pipeline: asset.pipeline.as_ref().map(|pipeline| pipeline.to_string()),
      env: if environment.is_worker() {
        Some("worker")
      } else if environment.is_node() {
        Some("node")
      } else {
        None
      },
      generated: asset.unique_key.is_some(),
      bundles: asset_bundles[index].clone(),
      entry: depth[index] == 0,
      ..Default::default()
    };
    report.bundles.sort_unstable();
    report.bundles.dedup();
    if let Some((importer, dep_index)) = via[index]
      && let Some(importer_ref) = report_asset[importer.index()]
    {
      let dep = &asset_graph.asset(importer).dependencies[dep_index];
      report.via = Some((
        importer_ref,
        dep.specifier.to_string(),
        load_kind(dep.priority, dep.specifier_type),
      ));
    }
    report.importers = importers[index]
      .iter()
      .filter_map(|(importer, _)| report_asset[importer.index()])
      .collect();
    report.importers.sort_unstable();
    report.importers.dedup();
    // Which exports are used is known for ES modules, and CommonJS modules whose exports are
    // static.
    if asset
      .flags
      .intersects(AssetFlags::IS_ESM | AssetFlags::STATIC_EXPORTS)
    {
      let symbols = &asset.symbols;
      report.exports = Some(
        symbols
          .exports
          .iter()
          .map(|export| (export.exported.as_str().to_owned(), export.requested))
          .collect(),
      );
      report.reexports = symbols
        .indirect
        .iter()
        .map(|export| (export.exported.as_str().to_owned(), export.requested))
        .collect();
      report.namespace = symbols.used_namespace;
    }
    report_assets.push(report);
  }

  let report = Report {
    title: root.file_name().to_owned(),
    paths: paths.paths,
    bundles: report_bundles,
    assets: report_assets,
  };

  // `<` can't end the script element the data is in when escaped.
  let data = serde_json::to_string(&report)?.replace('<', "\\u003c");
  let style = unsafe { std::str::from_utf8_unchecked(&STYLE_BYTES) };
  let script = unsafe { std::str::from_utf8_unchecked(&SCRIPT_BYTES) };
  let html = format!(
    r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bundle analysis · {title}</title>
<style>{style}</style>
</head>
<body>
<header>
  <h1>Bundle analysis <span id="summary"></span></h1>
  <div class="controls">
    <div class="segmented" role="group" aria-label="View">
      <button type="button" id="view-treemap" aria-pressed="true">Treemap</button>
      <button type="button" id="view-duplicates" aria-pressed="false">Duplicates</button>
    </div>
    <div class="segmented" role="group" aria-label="Size">
      <button type="button" id="mode-raw" aria-pressed="true">Raw</button>
      <button type="button" id="mode-gzip" aria-pressed="false">Gzip</button>
    </div>
    <input type="search" id="search" placeholder="Filter modules (/)" aria-label="Filter modules" autocomplete="off" spellcheck="false">
  </div>
</header>
<nav id="breadcrumbs" aria-label="Zoom path"></nav>
<main>
  <div id="views">
    <div id="treemap-view"><canvas id="treemap" role="img" aria-label="Treemap of bundle sizes"></canvas></div>
    <div id="duplicates-view" hidden></div>
  </div>
  <aside id="panel" aria-label="Details" hidden></aside>
  <div id="tooltip" hidden></div>
</main>
<script type="application/json" id="data">{data}</script>
<script>{script}</script>
</body>
</html>
"#,
    title = escape_html(&report.title),
  );

  let dir = root.join(Path::new("parcel-bundle-reports"));
  options.output_fs.create_dir_all(dir)?;
  let path = dir.join(Path::new("index.html"));
  options.output_fs.write(path, html.as_bytes())?;
  Ok(path)
}

/// `path` relative to `root`, with `/` separators.
fn relative(path: PathId, root: PathId) -> String {
  path
    .relative(&root)
    .components()
    .map(|component| component.as_os_str().to_string_lossy())
    .collect::<Vec<_>>()
    .join("/")
}

fn escape_html(text: &str) -> String {
  text
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
}
