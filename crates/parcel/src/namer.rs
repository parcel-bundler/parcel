use std::{
  ffi::OsStr,
  path::{Component, Path, PathBuf},
};

use parcel_core::{
  Asset, AssetGraph, AssetType, Bundle, BundleFlags, BundleGraph, Diagnostic, DiagnosticList,
  Environment, EnvironmentFlags, Namer, OutputFormat, PathId,
};
use xxhash_rust::xxh3::Xxh3Default;

pub struct DefaultNamer {}

impl Namer for DefaultNamer {
  fn name(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &parcel_core::Bundle,
    options: &parcel_core::ParcelOptions,
  ) -> Result<Option<PathId>, DiagnosticList> {
    let mut ext = bundle.ty.extension();
    if bundle.ty == AssetType::Js
      && bundle
        .target
        .flags
        .contains(EnvironmentFlags::MODULE_TYPE_EXTENSION)
    {
      if bundle.target.output_format == OutputFormat::Esmodule {
        ext = "mjs";
      } else if bundle.target.output_format == OutputFormat::Commonjs {
        ext = "cjs";
      }
    }

    if let Some(entry) = bundle.main_entry_asset {
      let asset = &bundle_graph.asset_graph.asset(entry);
      if bundle.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
        let relative =
          relative_path(asset, &bundle.target.dist_dir.parent().unwrap())?.with_extension("");
        let name = relative.to_str().unwrap();
        return Ok(Some(format_name(
          &bundle_graph.asset_graph,
          bundle,
          name,
          ext,
          &options.project_root,
        )));
      } else {
        if bundle.flags.contains(BundleFlags::NEEDS_STABLE_NAME) {
          let entry_root = common_root_path(
            bundle_graph
              .bundles
              .iter()
              .filter(|b| {
                b.flags.contains(BundleFlags::NEEDS_STABLE_NAME)
                  && b.main_entry_asset.is_some()
                  && b.target.dist_dir == bundle.target.dist_dir
              })
              .map(|b| {
                bundle_graph
                  .asset_graph
                  .asset(b.main_entry_asset.unwrap())
                  .loc
                  .url
                  .to_file_path()
                  .unwrap()
              }),
          );
          if let Some(entry_root) = entry_root {
            let relative = relative_path(asset, &entry_root)?.with_extension("");
            let name = relative.to_str().unwrap();
            return Ok(Some(format_name(
              &bundle_graph.asset_graph,
              bundle,
              name,
              ext,
              &options.project_root,
            )));
          }
        }

        let file_path = asset.loc.url.to_file_path()?;
        let name = file_path.file_prefix().unwrap();
        return Ok(Some(format_name(
          &bundle_graph.asset_graph,
          bundle,
          name,
          ext,
          &options.project_root,
        )));
      }
    }

    // Group server and client bundles into separate folders.
    // This allows users to easily upload to different places, and avoid exposing
    // server code on public servers.
    // If bundleExtension is set, assume everything is static (rendering at build time).
    let prefix = match bundle.target.environment {
      Environment::ReactServer => bundle.target.dist_dir.child("server"),
      Environment::ReactClient => bundle.target.dist_dir.child("client"),
      _ => bundle.target.dist_dir,
    };

    Ok(Some(prefix.child(&format!(
      "{:016x}.{}",
      hash_bundle(&bundle_graph.asset_graph, bundle, &options.project_root),
      ext
    ))))
  }
}

fn hash_bundle(asset_graph: &AssetGraph, bundle: &Bundle, project_root: &PathId) -> u64 {
  let mut hash = Xxh3Default::new();
  for asset in &bundle.assets {
    let asset = &asset_graph.asset(*asset);
    asset.loc.stable_hash(project_root, &mut hash);
    asset.target.stable_hash(project_root, &mut hash);
  }

  hash.digest()
}

fn relative_path(asset: &Asset, from: &PathId) -> Result<PathBuf, Diagnostic> {
  let path = asset.loc.url.to_file_path()?;
  Ok(
    path
      .relative(from)
      .components()
      .map(|c| match c {
        Component::ParentDir => Component::Normal(OsStr::new("up")),
        _ => c,
      })
      .collect(),
  )
}

/// Formats the final bundle name and joins it onto the target's dist dir. `name` may contain
/// subdirectories (from relative entry paths), so it is joined as a path, not a single segment.
fn format_name(
  asset_graph: &AssetGraph,
  bundle: &Bundle,
  name: &str,
  ext: &str,
  project_root: &PathId,
) -> PathId {
  let name = if bundle.flags.contains(BundleFlags::NEEDS_STABLE_NAME) {
    format!("{}.{}", name, ext)
  } else {
    format!(
      "{}-{:016x}.{}",
      name,
      hash_bundle(asset_graph, bundle, project_root),
      ext
    )
  };
  bundle.target.dist_dir.join(Path::new(&name))
}

fn common_root_path(paths: impl IntoIterator<Item = PathId>) -> Option<PathId> {
  let mut path_iter = paths.into_iter();
  let mut root = path_iter.next()?.parent()?;

  for path in path_iter {
    let path = path.parent()?;
    while !path.ancestors().any(|ancestor| ancestor == root) {
      root = root.parent()?;
    }
  }

  Some(root)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::Path;

  fn path(path: &str) -> PathId {
    PathId::new(Path::new(path))
  }

  fn common(paths: &[&str]) -> Option<PathBuf> {
    common_root_path(paths.iter().map(|path| self::path(path))).map(|path| path.to_path_buf())
  }

  #[test]
  fn common_root_path_returns_parent_for_single_path() {
    assert_eq!(
      common(&["/project/src/index.js"]),
      Some(PathBuf::from("/project/src"))
    );
  }

  #[test]
  fn common_root_path_returns_shared_directory_for_siblings() {
    assert_eq!(
      common(&["/project/src/index.js", "/project/src/app.js"]),
      Some(PathBuf::from("/project/src"))
    );
  }

  #[test]
  fn common_root_path_returns_deepest_shared_parent() {
    assert_eq!(
      common(&[
        "/project/src/routes/home/index.js",
        "/project/src/routes/about/index.js",
        "/project/src/routes/contact/form.js"
      ]),
      Some(PathBuf::from("/project/src/routes"))
    );
  }

  #[test]
  fn common_root_path_walks_up_to_project_root() {
    assert_eq!(
      common(&[
        "/project/src/index.js",
        "/project/assets/logo.svg",
        "/project/package.json"
      ]),
      Some(PathBuf::from("/project"))
    );
  }

  #[test]
  fn common_root_path_returns_filesystem_root_for_unrelated_paths() {
    assert_eq!(
      common(&["/project/src/index.js", "/vendor/lib/index.js"]),
      Some(PathBuf::from("/"))
    );
  }

  #[test]
  fn common_root_path_returns_none_for_empty_input() {
    assert_eq!(common(&[]), None);
  }

  #[test]
  fn common_root_path_returns_none_for_root_input() {
    assert_eq!(common(&["/"]), None);
  }
}
