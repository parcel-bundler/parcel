use std::collections::HashSet;

use crate::{
  BundleBehavior, Diagnostic, DiagnosticList, LogLevel, ParcelOptions, asset_graph::AssetGraph,
  bundle_graph::BundleGraph, config::ParcelConfig, namer::name,
};

pub trait Bundler: Send + Sync {
  fn bundle<'a>(
    &self,
    asset_graph: AssetGraph<'a>,
    options: &ParcelOptions,
  ) -> Result<BundleGraph<'a>, DiagnosticList>;
}

pub fn bundle<'a>(
  asset_graph: AssetGraph<'a>,
  config: &ParcelConfig,
  options: &ParcelOptions,
) -> Result<BundleGraph<'a>, DiagnosticList> {
  let mut bundle_graph = config.bundler.bundle(asset_graph, options)?;
  bundle_graph.project_root = options.project_root.clone();

  let mut seen_bundles = HashSet::new();
  let mut duplicate_bundles = HashSet::new();
  for i in 0..bundle_graph.bundles.len() {
    if bundle_graph.bundles[i].dist_path.is_none() {
      bundle_graph.bundles[i].dist_path = Some(name(
        &bundle_graph,
        &bundle_graph.bundles[i],
        config,
        options,
      )?);
    }

    let bundle = &bundle_graph.bundles[i];
    if bundle.bundle_behavior != BundleBehavior::Inline {
      let full_url = bundle.dist_path();
      if seen_bundles.contains(&full_url) {
        duplicate_bundles.insert(full_url);
      } else {
        seen_bundles.insert(full_url);
      }
    }
  }

  // Bundles are identified by id when declaring dependencies (`Content::bundle_dependencies`).
  debug_assert!(
    {
      let mut ids = HashSet::new();
      bundle_graph
        .bundles
        .iter()
        .all(|bundle| ids.insert(bundle.id))
    },
    "bundle ids must be unique"
  );

  // A content hash replaces the hash reference in the file name, so it must be there exactly once.
  // TODO: alternatively we could determine whether the bundle is content hashed based on what the namer returned.
  let mut missing_hash_references = bundle_graph
    .bundles
    .iter()
    .filter(|bundle| {
      bundle.may_be_content_hashed()
        && bundle
          .dist_path()
          .file_name()
          .matches(&bundle.hash_reference())
          .count()
          != 1
    })
    .map(|bundle| bundle.stable_key())
    .collect::<Vec<_>>();
  if !missing_hash_references.is_empty() {
    missing_hash_references.sort();
    options.log_diagnostic(
      LogLevel::Warn,
      Diagnostic::from_message(format!(
        "The file names of these bundles must contain their hash reference exactly once to be content hashed:\n  • {}",
        missing_hash_references.join("\n  • ")
      )),
    );
  }

  if !duplicate_bundles.is_empty() {
    let mut duplicates = duplicate_bundles
      .into_iter()
      .map(|p| p.to_path_buf().to_string_lossy().into_owned())
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
