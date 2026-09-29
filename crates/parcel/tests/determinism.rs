//! Builds the same project repeatedly and checks every bundle is byte-identical each time. Within a
//! process, each hash map iterates in a different order and parallel transforms can assign asset
//! indices in a different order, so output that depends on either varies between builds.

use std::{
  collections::{BTreeMap, HashMap},
  path::Path,
  sync::Arc,
};

use parcel_core::{BuildMode, BuildOptions, FileSystem, OsFileSystem, OverlayFileSystem, PathId};

const RUNS: usize = 5;

fn build(fixture: &Path, entry: &str, optimize: bool) -> BTreeMap<String, String> {
  let output_fs = Arc::new(OverlayFileSystem::new());
  let options = BuildOptions {
    mode: BuildMode::Production,
    optimize: Some(optimize),
    content_hash: None,
    source_map: Some(Default::default()),
    env: HashMap::from([("NODE_ENV".into(), "test".into())]),
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: output_fs.clone(),
    log_level: parcel_core::LogLevel::Error,
    config: None,
    cwd: PathId::new(fixture),
    dist_dir: None,
    public_url: Default::default(),
    hmr: None,
    reporters: Vec::new(),
  };
  let bundle_graph = parcel::build(&vec![entry.to_string()], options).unwrap();
  bundle_graph
    .bundles
    .iter()
    .filter_map(|bundle| {
      let path = bundle.dist_path();
      let contents = output_fs.read_to_string(path).ok()?;
      Some((format!("{:?}", path), contents))
    })
    .collect()
}

fn assert_deterministic(fixture: &str, entry: &str) {
  let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
    .join("tests/fixtures")
    .join(fixture);
  for optimize in [false, true] {
    let first = build(&fixture, entry, optimize);
    for _ in 1..RUNS {
      let next = build(&fixture, entry, optimize);
      assert_eq!(
        first.keys().collect::<Vec<_>>(),
        next.keys().collect::<Vec<_>>(),
        "bundle names differ between builds of {fixture:?} (optimize: {optimize})"
      );
      for (name, contents) in &first {
        assert!(
          next[name] == *contents,
          "{name} differs between builds of {fixture:?} (optimize: {optimize})"
        );
      }
    }
  }
}

// CSS module exports and `composes` dependencies come from hash maps.
#[test]
#[ignore]
fn css_module_exports_are_deterministic() {
  assert_deterministic("css-modules/composes", "index.js");
  assert_deterministic("css-modules/vars", "index.js");
}

// RSC reference modules are named after their importer.
#[test]
#[ignore]
fn rsc_module_ids_are_deterministic() {
  assert_deterministic("react-server/client-server-references", "index.jsx");
  assert_deterministic("react-server/shared-react", "index.jsx");
}
