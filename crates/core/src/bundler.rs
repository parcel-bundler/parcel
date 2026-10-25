use std::collections::HashSet;

use crate::{
  AssetType, BundleBehavior, CodeFrame, Diagnostic, DiagnosticList, DiagnosticSeverity, LogLevel,
  ParcelOptions, SymbolName, asset_graph::AssetGraph, bundle_graph::BundleGraph,
  config::ParcelConfig, namer::name,
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

  warn_missing_fragment_ids(&bundle_graph, options);

  Ok(bundle_graph)
}

/// Warns about URL fragments naming an element an SVG doesn't have, e.g. a misspelled icon in
/// `<use href="sprite.svg#hom">`, which renders nothing.
fn warn_missing_fragment_ids(bundle_graph: &BundleGraph, options: &ParcelOptions) {
  let asset_graph = &bundle_graph.asset_graph;
  let mut seen = HashSet::new();
  for &asset_index in bundle_graph
    .bundles
    .iter()
    .flat_map(|bundle| &bundle.assets)
  {
    let asset = asset_graph.asset(asset_index);
    for import in &asset.symbols.imports {
      let dep = &asset.dependencies[import.dep_index as usize];
      let SymbolName::Name(id) = &import.symbol else {
        continue;
      };
      let Some((_, svg)) = asset_graph.resolved_asset(dep) else {
        continue;
      };
      // An SVG with scripts exports nothing, since they may create elements.
      if svg.ty != AssetType::Svg
        || svg.symbols.exports.is_empty()
        || dep.fragment_id().as_deref() != Some(&**id)
        || svg
          .symbols
          .exports
          .iter()
          .any(|export| export.exported == import.symbol)
        || !seen.insert((asset_index, import.dep_index))
      {
        continue;
      }

      let file = svg.loc.url.to_file_path().map_or_else(
        |_| svg.loc.url.to_string(),
        |path| {
          path
            .relative(&options.project_root)
            .to_string_lossy()
            .into_owned()
        },
      );
      options.log_diagnostic(
        LogLevel::Warn,
        Diagnostic {
          message: format!("{file} has no element with id '{id}'."),
          origin: Some("@parcel/core".into()),
          severity: DiagnosticSeverity::Warning,
          code_frames: dep
            .loc
            .iter()
            .map(|loc| CodeFrame::from_loc(loc, None))
            .collect(),
          documentation_url: None,
          hints: Vec::new(),
        },
      );
    }
  }
}
