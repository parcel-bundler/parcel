//! Integration tests for `parcel_core` covering full and incremental builds.
//!
//! These tests exercise the whole pipeline (`Parcel::new` → `build` → `bundle`/package)
//! against an in-memory file system using a set of reusable mock plugins defined in the
//! `mock` module. The mock plugins implement a tiny made-up "language":
//!
//! * A line `@import ./foo.js` declares a synchronous dependency.
//! * A line `@async ./foo.js` declares an async (separate-bundle) dependency.
//! * Every other line is treated as code and passed through verbatim.
//!
//! This is enough to build interesting asset/bundle graphs and to verify that incremental
//! rebuilds re-package only the bundles affected by a changed file.

use std::{path::PathBuf, sync::Arc};

mod mock;

use mock::{MockPluginFactory, RecordingFileSystem, build_options, source_url, write_file};
use parcel_core::{AssetNode, FileSystem, MemoryFileSystem, Parcel, SourceUrl};

/// Builds a `Parcel` over an in-memory project containing `files`, using `entries`.
/// Returns the `Parcel`, the input file system (to mutate for incremental tests) and the
/// recording output file system (to inspect which bundles were written).
fn setup(
  files: &[(&str, &str)],
  entries: &[&str],
) -> (Parcel, Arc<MemoryFileSystem>, Arc<RecordingFileSystem>) {
  let input_fs = Arc::new(MemoryFileSystem::new());
  for (path, contents) in files {
    write_file(&input_fs, path, contents);
  }

  let output_fs = Arc::new(RecordingFileSystem::new());
  let options = build_options(input_fs.clone(), output_fs.clone());

  let entries: Vec<String> = entries.iter().map(|e| e.to_string()).collect();
  let parcel = Parcel::new(&entries, options, &MockPluginFactory).expect("Parcel::new failed");
  (parcel, input_fs, output_fs)
}

/// Reads an output bundle as a string. Bundle paths are under `/project/dist/`.
fn read_dist(output_fs: &RecordingFileSystem, name: &str) -> String {
  let path = PathBuf::from(format!("/project/dist/{}", name));
  let bytes =
    output_fs.read(&path).unwrap_or_else(|e| panic!("could not read dist/{}: {}", name, e));
  String::from_utf8(bytes).unwrap()
}

/// Sorts and returns the set of dist file names written since the last `take_writes`.
fn written_names(output_fs: &RecordingFileSystem) -> Vec<String> {
  let mut names: Vec<String> = output_fs
    .take_writes()
    .into_iter()
    .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
    .collect();
  names.sort();
  names
}

// ---------------------------------------------------------------------------
// Full build tests
// ---------------------------------------------------------------------------

#[test]
fn full_build_single_bundle() {
  let (mut parcel, _input, output) = setup(
    &[
      (
        "/project/index.js",
        "@import ./foo.js\n@import ./bar.js\nconsole.log('index')",
      ),
      ("/project/foo.js", "console.log('foo')"),
      ("/project/bar.js", "console.log('bar')"),
    ],
    &["/project/index.js"],
  );

  let bundle_graph = parcel.build().expect("build failed");

  // A single entry with only sync deps produces one bundle.
  assert_eq!(bundle_graph.bundles.len(), 1);

  // The bundle contains the entry plus both of its synchronous dependencies.
  let bundle = &bundle_graph.bundles[0];
  assert_eq!(bundle.name.as_deref(), Some("index.js"));
  assert_eq!(bundle.assets.len(), 3);

  // The packaged output concatenates each asset's transformed code (directives stripped).
  let out = read_dist(&output, "index.js");
  assert!(out.contains("console.log('index')"), "got: {out}");
  assert!(out.contains("console.log('foo')"), "got: {out}");
  assert!(out.contains("console.log('bar')"), "got: {out}");
  assert!(!out.contains("@import"), "directives should be stripped: {out}");

  // Exactly one file was written on the initial build.
  assert_eq!(written_names(&output), vec!["index.js"]);
}

#[test]
fn full_build_async_split_into_two_bundles() {
  let (mut parcel, _input, output) = setup(
    &[
      (
        "/project/index.js",
        "@import ./foo.js\n@async ./page.js\nconsole.log('index')",
      ),
      ("/project/foo.js", "console.log('foo')"),
      ("/project/page.js", "@import ./shared.js\nconsole.log('page')"),
      ("/project/shared.js", "console.log('shared')"),
    ],
    &["/project/index.js"],
  );

  let bundle_graph = parcel.build().expect("build failed");

  // The async import splits the graph into two bundles.
  assert_eq!(bundle_graph.bundles.len(), 2);

  // index bundle: index + foo (sync). page bundle: page + shared (sync).
  let index_out = read_dist(&output, "index.js");
  assert!(index_out.contains("console.log('index')"));
  assert!(index_out.contains("console.log('foo')"));
  assert!(!index_out.contains("console.log('page')"));

  let page_out = read_dist(&output, "page.js");
  assert!(page_out.contains("console.log('page')"));
  assert!(page_out.contains("console.log('shared')"));
  assert!(!page_out.contains("console.log('index')"));

  let mut written = written_names(&output);
  written.sort();
  assert_eq!(written, vec!["index.js", "page.js"]);
}

#[test]
fn full_build_shared_dependency_is_deduped() {
  // Both foo and bar import shared.js. Because asset requests are deduplicated by file,
  // there is a single shared asset node referenced by both.
  let (mut parcel, _input, output) = setup(
    &[
      ("/project/index.js", "@import ./foo.js\n@import ./bar.js"),
      ("/project/foo.js", "@import ./shared.js\nconsole.log('foo')"),
      ("/project/bar.js", "@import ./shared.js\nconsole.log('bar')"),
      ("/project/shared.js", "console.log('shared')"),
    ],
    &["/project/index.js"],
  );

  let bundle_graph = parcel.build().expect("build failed");
  assert_eq!(bundle_graph.bundles.len(), 1);

  // index, foo, bar, shared = 4 distinct asset nodes in the graph.
  let asset_count = bundle_graph
    .asset_graph
    .assets
    .iter()
    .filter(|n| matches!(n, AssetNode::Asset(_)))
    .count();
  assert_eq!(asset_count, 4);

  let out = read_dist(&output, "index.js");
  assert!(out.contains("console.log('shared')"));
}

// ---------------------------------------------------------------------------
// Incremental build tests
// ---------------------------------------------------------------------------

/// Computes the project-relative `SourceUrl` for a file, matching the URL the asset graph
/// uses for invalidation.
fn url_for(parcel: &Parcel, path: &str) -> SourceUrl {
  source_url(parcel.project_root(), path)
}

#[test]
fn incremental_rebuild_repackages_only_affected_bundle() {
  let (mut parcel, input, output) = setup(
    &[
      ("/project/index.js", "@import ./foo.js\n@async ./page.js"),
      ("/project/foo.js", "console.log('foo v1')"),
      ("/project/page.js", "console.log('page')"),
    ],
    &["/project/index.js"],
  );

  // Initial build writes both bundles.
  parcel.build().expect("initial build failed");
  assert_eq!(written_names(&output), vec!["index.js", "page.js"]);

  // Change foo.js (which lives in the index bundle).
  write_file(&input, "/project/foo.js", "console.log('foo v2')");
  let affected = parcel.invalidate(&[url_for(&parcel, "/project/foo.js")]);
  assert_eq!(affected.len(), 1, "exactly one asset should be invalidated");

  parcel.build().expect("incremental build failed");

  // Only the index bundle is re-packaged; the page bundle is untouched.
  assert_eq!(written_names(&output), vec!["index.js"]);

  // The index bundle reflects the new content.
  let index_out = read_dist(&output, "index.js");
  assert!(index_out.contains("console.log('foo v2')"), "got: {index_out}");
  assert!(!index_out.contains("console.log('foo v1')"), "got: {index_out}");
}

#[test]
fn incremental_rebuild_change_inside_async_bundle() {
  let (mut parcel, input, output) = setup(
    &[
      ("/project/index.js", "@import ./foo.js\n@async ./page.js"),
      ("/project/foo.js", "console.log('foo')"),
      ("/project/page.js", "@import ./shared.js\nconsole.log('page')"),
      ("/project/shared.js", "console.log('shared v1')"),
    ],
    &["/project/index.js"],
  );

  parcel.build().expect("initial build failed");
  let _ = written_names(&output);

  // Change shared.js, which only lives in the async page bundle.
  write_file(&input, "/project/shared.js", "console.log('shared v2')");
  parcel.invalidate(&[url_for(&parcel, "/project/shared.js")]);
  parcel.build().expect("incremental build failed");

  // Only the page bundle is rewritten.
  assert_eq!(written_names(&output), vec!["page.js"]);
  let page_out = read_dist(&output, "page.js");
  assert!(page_out.contains("console.log('shared v2')"), "got: {page_out}");
}

#[test]
fn incremental_rebuild_no_changes_writes_nothing() {
  let (mut parcel, _input, output) = setup(
    &[
      ("/project/index.js", "@import ./foo.js"),
      ("/project/foo.js", "console.log('foo')"),
    ],
    &["/project/index.js"],
  );

  parcel.build().expect("initial build failed");
  assert_eq!(written_names(&output), vec!["index.js"]);

  // Invalidate with an empty change set, then rebuild: nothing should be re-packaged.
  let affected = parcel.invalidate(&[]);
  assert!(affected.is_empty());
  parcel.build().expect("no-op rebuild failed");
  assert!(
    written_names(&output).is_empty(),
    "a no-op rebuild must not write any bundles"
  );
}

#[test]
fn incremental_rebuild_adding_dependency_changes_composition() {
  let (mut parcel, input, output) = setup(
    &[
      ("/project/index.js", "@import ./foo.js"),
      ("/project/foo.js", "console.log('foo')"),
      ("/project/bar.js", "console.log('bar')"),
    ],
    &["/project/index.js"],
  );

  let bundle_graph = parcel.build().expect("initial build failed");
  assert_eq!(bundle_graph.bundles[0].assets.len(), 2); // index + foo
  let _ = written_names(&output);

  // Add a new sync import of bar.js to the entry.
  write_file(&input, "/project/index.js", "@import ./foo.js\n@import ./bar.js");
  parcel.invalidate(&[url_for(&parcel, "/project/index.js")]);
  let bundle_graph = parcel.build().expect("incremental build failed");

  // The index bundle's composition grew to include bar.js and was rewritten.
  assert_eq!(bundle_graph.bundles[0].assets.len(), 3);
  assert_eq!(written_names(&output), vec!["index.js"]);
  let out = read_dist(&output, "index.js");
  assert!(out.contains("console.log('bar')"), "got: {out}");
}

#[test]
fn incremental_rebuild_when_resolver_config_changes() {
  // The resolver resolves the `#dep` alias through `aliases.json`, recording that config file
  // as a dependency. Editing the config should re-resolve `#dep` and rebuild the importer.
  let (mut parcel, input, output) = setup(
    &[
      ("/project/aliases.json", r##"{"#dep": "./foo.js"}"##),
      ("/project/index.js", "@import #dep\nconsole.log('index')"),
      ("/project/foo.js", "console.log('foo')"),
      ("/project/bar.js", "console.log('bar')"),
    ],
    &["/project/index.js"],
  );

  parcel.build().expect("initial build failed");
  let out = read_dist(&output, "index.js");
  assert!(out.contains("console.log('foo')"), "got: {out}");
  assert!(!out.contains("console.log('bar')"), "got: {out}");
  let _ = written_names(&output);

  // Repoint the alias at bar.js. Only the config file changed — not index.js itself.
  write_file(&input, "/project/aliases.json", r##"{"#dep": "./bar.js"}"##);
  let affected = parcel.invalidate(&[url_for(&parcel, "/project/aliases.json")]);
  assert!(
    !affected.is_empty(),
    "changing the resolver's config file should invalidate the importer"
  );

  parcel.build().expect("incremental build failed");

  // The importer's bundle was re-packaged and now resolves to bar.js.
  assert_eq!(written_names(&output), vec!["index.js"]);
  let out = read_dist(&output, "index.js");
  assert!(out.contains("console.log('bar')"), "got: {out}");
  assert!(!out.contains("console.log('foo')"), "got: {out}");
}

#[test]
fn incremental_rebuild_removing_async_bundle_deletes_output() {
  let (mut parcel, input, output) = setup(
    &[
      ("/project/index.js", "@import ./foo.js\n@async ./page.js"),
      ("/project/foo.js", "console.log('foo')"),
      ("/project/page.js", "console.log('page')"),
    ],
    &["/project/index.js"],
  );

  let bundle_graph = parcel.build().expect("initial build failed");
  assert_eq!(bundle_graph.bundles.len(), 2);
  let _ = written_names(&output);

  // Remove the async import. The page bundle should disappear and its output be deleted.
  write_file(&input, "/project/index.js", "@import ./foo.js");
  parcel.invalidate(&[url_for(&parcel, "/project/index.js")]);
  let bundle_graph = parcel.build().expect("incremental build failed");

  assert_eq!(bundle_graph.bundles.len(), 1);

  // The stale page bundle output was removed.
  let removed = output.take_removes();
  let removed_names: Vec<String> = removed
    .iter()
    .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
    .collect();
  assert!(
    removed_names.contains(&"page.js".to_string()),
    "expected page.js to be removed, got: {removed_names:?}"
  );
}
