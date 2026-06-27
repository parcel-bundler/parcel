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

use mock::{
  MOCK_CONFIG, MockPluginFactory, RecordingFileSystem, build_options, source_url, write_file,
};
use parcel_core::{
  AssetNode, FactoryBuilder, FileSystem, MemoryFileSystem, Parcel, PluginFactory, SourceUrl,
};

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
  let make_factory: Arc<FactoryBuilder> =
    Arc::new(|_fs| Box::new(MockPluginFactory) as Box<dyn PluginFactory>);
  let parcel = Parcel::new(&entries, options, make_factory).expect("Parcel::new failed");
  (parcel, input_fs, output_fs)
}

/// Reads an output bundle as a string. Bundle paths are under `/project/dist/`.
fn read_dist(output_fs: &RecordingFileSystem, name: &str) -> String {
  let path = PathBuf::from(format!("/project/dist/{}", name));
  let bytes = output_fs
    .read(parcel_core::PathId::new(&path))
    .unwrap_or_else(|e| panic!("could not read dist/{}: {}", name, e));
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
  let result = parcel.invalidate(&[url_for(&parcel, "/project/foo.js")], &[]).unwrap();
  assert!(!result.config_changed);
  assert_eq!(result.affected.len(), 1, "exactly one asset should be invalidated");

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
  parcel.invalidate(&[url_for(&parcel, "/project/shared.js")], &[]).unwrap();
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
  let result = parcel.invalidate(&[], &[]).unwrap();
  assert!(!result.needs_rebuild());
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
  parcel.invalidate(&[url_for(&parcel, "/project/index.js")], &[]).unwrap();
  let bundle_graph = parcel.build().expect("incremental build failed");

  // The index bundle's composition grew to include bar.js and was rewritten.
  assert_eq!(bundle_graph.bundles[0].assets.len(), 3);
  assert_eq!(written_names(&output), vec!["index.js"]);
  let out = read_dist(&output, "index.js");
  assert!(out.contains("console.log('bar')"), "got: {out}");
}

#[test]
fn config_file_change_triggers_full_rebuild() {
  // A real `.parcelrc` is read during `Parcel::new`, so editing it must rebuild from scratch
  // rather than incrementally.
  let (mut parcel, input, output) = setup(
    &[
      ("/project/.parcelrc", MOCK_CONFIG),
      ("/project/index.js", "@import ./foo.js\n@async ./page.js"),
      ("/project/foo.js", "console.log('foo v1')"),
      ("/project/page.js", "console.log('page')"),
    ],
    &["/project/index.js"],
  );

  parcel.build().expect("initial build failed");
  assert_eq!(written_names(&output), vec!["index.js", "page.js"]);

  // Editing a source file is an incremental change, not a config change.
  write_file(&input, "/project/foo.js", "console.log('foo v2')");
  let result = parcel.invalidate(&[url_for(&parcel, "/project/foo.js")], &[]).unwrap();
  assert!(!result.config_changed, "a source edit must not be treated as a config change");
  parcel.build().expect("incremental build failed");
  assert_eq!(written_names(&output), vec!["index.js"]);

  // Editing .parcelrc is a config change: the Parcel is recreated and the next build is full.
  write_file(&input, "/project/.parcelrc", MOCK_CONFIG);
  let result = parcel.invalidate(&[url_for(&parcel, "/project/.parcelrc")], &[]).unwrap();
  assert!(result.config_changed, "editing .parcelrc should be detected as a config change");
  assert!(result.affected.is_empty());

  parcel.build().expect("full rebuild failed");

  // A full rebuild re-writes every bundle, and the latest source content is reflected.
  assert_eq!(written_names(&output), vec!["index.js", "page.js"]);
  let out = read_dist(&output, "index.js");
  assert!(out.contains("console.log('foo v2')"), "got: {out}");
}

#[test]
fn dotenv_change_triggers_full_rebuild() {
  // `.env` files are read during `Parcel::new`; changing one rebuilds from scratch.
  let (mut parcel, input, output) = setup(
    &[
      ("/project/.env", "API_URL=https://v1.example.com"),
      ("/project/index.js", "console.log('index')"),
    ],
    &["/project/index.js"],
  );

  parcel.build().expect("initial build failed");
  let _ = written_names(&output);

  write_file(&input, "/project/.env", "API_URL=https://v2.example.com");
  let result = parcel.invalidate(&[url_for(&parcel, "/project/.env")], &[]).unwrap();
  assert!(result.config_changed, "editing .env should be detected as a config change");

  parcel.build().expect("full rebuild failed");
  assert_eq!(written_names(&output), vec!["index.js"]);
}

#[test]
fn new_file_matching_entry_glob_triggers_full_rebuild() {
  // A glob entry records a create-glob invalidation, so a new file matching it must rebuild and
  // pick up the new entry.
  let (mut parcel, input, output) = setup(
    &[
      ("/project/src/a.js", "console.log('a')"),
      ("/project/src/b.js", "console.log('b')"),
    ],
    &["/project/src/*.js"],
  );

  let bundle_graph = parcel.build().expect("initial build failed");
  assert_eq!(bundle_graph.bundles.len(), 2); // one bundle per matched entry
  let _ = written_names(&output);

  // Create a new file matching the entry glob.
  write_file(&input, "/project/src/c.js", "console.log('c')");
  let result = parcel.invalidate(&[], &[url_for(&parcel, "/project/src/c.js")]).unwrap();
  assert!(
    result.config_changed,
    "a new file matching an entry glob should trigger a full rebuild"
  );

  let bundle_graph = parcel.build().expect("full rebuild failed");
  assert_eq!(bundle_graph.bundles.len(), 3);
  assert!(written_names(&output).contains(&"c.js".to_string()));
}

#[test]
fn editing_existing_glob_matched_entry_is_incremental() {
  // A file matching the entry glob already exists. Editing it is a modification, not a creation,
  // so it must rebuild incrementally rather than being mistaken for a new entry (config change).
  let (mut parcel, input, output) = setup(
    &[
      ("/project/src/a.js", "console.log('a v1')"),
      ("/project/src/b.js", "console.log('b')"),
    ],
    &["/project/src/*.js"],
  );

  parcel.build().expect("initial build failed");
  let _ = written_names(&output);

  write_file(&input, "/project/src/a.js", "console.log('a v2')");
  let result = parcel.invalidate(&[url_for(&parcel, "/project/src/a.js")], &[]).unwrap();
  assert!(
    !result.config_changed,
    "editing an existing glob-matched file must be incremental, not a full rebuild"
  );

  parcel.build().expect("incremental build failed");
  assert_eq!(written_names(&output), vec!["a.js"]);
  let out = read_dist(&output, "a.js");
  assert!(out.contains("console.log('a v2')"), "got: {out}");
}

#[test]
fn new_package_json_above_entry_triggers_full_rebuild() {
  // `find_package` searches upward for package.json via `find_ancestor_file`, which records a
  // `file_create_above` invalidation. Creating a package.json should therefore rebuild (it can
  // change the target environment/engines).
  let (mut parcel, input, output) = setup(
    &[("/project/index.js", "console.log('index')")],
    &["/project/index.js"],
  );

  parcel.build().expect("initial build failed");
  let _ = written_names(&output);

  write_file(&input, "/project/package.json", r#"{"name": "app"}"#);
  let result = parcel.invalidate(&[], &[url_for(&parcel, "/project/package.json")]).unwrap();
  assert!(
    result.config_changed,
    "creating a package.json above an entry should trigger a full rebuild"
  );

  parcel.build().expect("full rebuild failed");
  assert_eq!(written_names(&output), vec!["index.js"]);
}

#[test]
fn incremental_rebuild_when_transformer_read_file_changes() {
  // foo.js reads `theme.txt` through the transformer's tracking fs (`@config theme.txt`). Editing
  // that file must re-transform only foo (and re-package only its bundle), even though the file is
  // neither an entry nor a resolver dependency.
  let (mut parcel, input, output) = setup(
    &[
      ("/project/index.js", "@import ./foo.js\n@async ./page.js"),
      ("/project/foo.js", "@config theme.txt\nconsole.log('foo')"),
      ("/project/page.js", "console.log('page')"),
      ("/project/theme.txt", "// theme v1"),
    ],
    &["/project/index.js"],
  );

  parcel.build().expect("initial build failed");
  let index_out = read_dist(&output, "index.js");
  assert!(index_out.contains("// theme v1"), "got: {index_out}");
  let _ = written_names(&output);

  // Edit the file the transformer read. It is a modification of an existing file.
  write_file(&input, "/project/theme.txt", "// theme v2");
  let result = parcel.invalidate(&[url_for(&parcel, "/project/theme.txt")], &[]).unwrap();
  assert!(
    !result.config_changed,
    "a transformer's file dependency is a per-asset invalidation, not a config change"
  );
  assert_eq!(result.affected.len(), 1, "only foo should be re-transformed");

  parcel.build().expect("incremental build failed");

  // Only the index bundle (which contains foo) is re-packaged.
  assert_eq!(written_names(&output), vec!["index.js"]);
  let index_out = read_dist(&output, "index.js");
  assert!(index_out.contains("// theme v2"), "got: {index_out}");
  assert!(!index_out.contains("// theme v1"), "got: {index_out}");
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
  let result = parcel.invalidate(&[url_for(&parcel, "/project/aliases.json")], &[]).unwrap();
  assert!(
    !result.affected.is_empty(),
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
  parcel.invalidate(&[url_for(&parcel, "/project/index.js")], &[]).unwrap();
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
