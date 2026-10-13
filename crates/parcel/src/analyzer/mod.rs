//! The bundle analysis written by `--analyze`: a self-contained HTML page showing the sizes in
//! `generate_build_metrics` as a treemap, and the modules duplicated between bundles.

use std::collections::HashMap;
use std::path::Path;

use parcel_core::{ParcelOptions, PathId};
use serde::Serialize;

use crate::bundle_report::BundleStats;

const SCRIPT: &str = include_str!("client.js");
const STYLE: &str = include_str!("client.css");

#[derive(Serialize)]
struct Report {
  title: String,
  /// Module paths relative to the project root, shared between bundles.
  paths: Vec<String>,
  bundles: Vec<ReportBundle>,
}

#[derive(Serialize)]
struct ReportBundle {
  /// Relative to the project root.
  name: String,
  size: u64,
  gzip: u64,
  /// Pairs of an index into `paths` (null for code from unknown sources) and a size, largest
  /// first.
  assets: Vec<(Option<u32>, u64)>,
}

/// Writes the analysis of `bundles` to `parcel-bundle-reports/index.html` in the project root, and
/// returns its path.
pub fn write_report(
  bundles: &[BundleStats],
  options: &ParcelOptions,
) -> Result<PathId, parcel_core::Diagnostic> {
  let root = options.project_root;
  let mut paths = Vec::new();
  let mut path_indices = HashMap::new();
  let bundles = bundles
    .iter()
    .map(|bundle| ReportBundle {
      name: relative(bundle.path, root),
      size: bundle.size,
      gzip: bundle.gzip_size.unwrap_or(bundle.size),
      assets: bundle
        .assets
        .iter()
        .map(|asset| {
          let index = asset.path.map(|path| {
            *path_indices.entry(path).or_insert_with(|| {
              paths.push(relative(path, root));
              paths.len() as u32 - 1
            })
          });
          (index, asset.size)
        })
        .collect(),
    })
    .collect();
  let report = Report {
    title: root.file_name().to_owned(),
    paths,
    bundles,
  };

  // `<` can't end the script element the data is in when escaped.
  let data = serde_json::to_string(&report)?.replace('<', "\\u003c");
  let html = format!(
    r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bundle analysis · {title}</title>
<style>{STYLE}</style>
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
  <div id="treemap-view"><canvas id="treemap" role="img" aria-label="Treemap of bundle sizes"></canvas></div>
  <div id="duplicates-view" hidden></div>
  <div id="tooltip" hidden></div>
</main>
<script type="application/json" id="data">{data}</script>
<script>{SCRIPT}</script>
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
