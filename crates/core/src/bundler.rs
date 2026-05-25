use std::collections::HashSet;

use crate::{
  Diagnostic, DiagnosticList, ParcelOptions, asset_graph::AssetGraph, bundle_graph::BundleGraph,
  config::ParcelConfig, namer::name,
};

pub trait Bundler: Send + Sync {
  fn bundle(&self, asset_graph: AssetGraph) -> Result<BundleGraph, DiagnosticList>;
}

pub fn bundle(
  asset_graph: AssetGraph,
  config: &ParcelConfig,
  options: &ParcelOptions,
) -> Result<BundleGraph, DiagnosticList> {
  let mut bundle_graph = config.bundler.bundle(asset_graph)?;

  let mut seen_bundles = HashSet::new();
  let mut duplicate_bundles = HashSet::new();
  for bundle in &mut bundle_graph.bundles {
    if bundle.name.is_none() {
      bundle.name = Some(name(&bundle_graph.asset_graph, bundle, config, options)?);
    }

    let name = bundle.name.as_ref().unwrap();
    let full_path = bundle.target.dist_dir.to_file_path()?.join(&name);
    if seen_bundles.contains(&full_path) {
      duplicate_bundles.insert(full_path);
    } else {
      seen_bundles.insert(full_path);
    }
  }

  if !duplicate_bundles.is_empty() {
    let mut duplicates = duplicate_bundles
      .into_iter()
      .map(|p| {
        p.strip_prefix(&options.cwd)
          .unwrap_or_else(|_| &p)
          .to_string_lossy()
          .to_string()
      })
      .collect::<Vec<_>>();
    duplicates.sort();

    return Err(
      Diagnostic::from_message(format!(
        "Multiple bundles with the same name were found:\n  • {}",
        duplicates.join("\n  • ")
      ))
      .into(),
    );
  }

  Ok(bundle_graph)
}
