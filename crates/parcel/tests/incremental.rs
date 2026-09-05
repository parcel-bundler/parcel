//! Rebuild-equivalence tests for incremental builds using the real plugin pipeline.
//!
//! Each test builds a project once, then applies a sequence of file changes. After every
//! change the incremental rebuild's complete output (every file in the output file system)
//! is compared byte-for-byte against a *fresh* build of the same input state. This verifies
//! that incremental rebuilds converge to exactly what a from-scratch build would produce:
//! no stale content, no stale output files, no missed invalidations.

use parcel::make_parcel;
use parcel_core::{
  BuildMode, BuildOptions, DiagnosticList, FileKind, FileSystem, LogLevel, MemoryFileSystem,
  Parcel, PathId,
};
use pretty_assertions::assert_eq;
use std::{
  collections::BTreeMap,
  path::{Path, PathBuf},
  sync::Arc,
};

fn write_file(fs: &MemoryFileSystem, path: &str, contents: &str) {
  let path = Path::new(path);
  if let Some(parent) = path.parent() {
    fs.create_dir_all(PathId::new(parent)).unwrap();
  }
  fs.write(PathId::new(path), &contents.as_bytes().to_vec())
    .unwrap();
}

fn make_options(
  input_fs: Arc<MemoryFileSystem>,
  output_fs: Arc<MemoryFileSystem>,
  mode: BuildMode,
) -> BuildOptions {
  BuildOptions {
    mode,
    optimize: None,
    source_map: Some(Default::default()),
    env: Default::default(),
    log_level: LogLevel::Error,
    input_fs,
    output_fs,
    config: None,
    cwd: PathId::new(Path::new("/project")),
    dist_dir: None,
    public_url: Default::default(),
    hmr: None,
  }
}

/// A project being built incrementally, together with a mirror of its current input files so
/// an equivalent fresh build can be produced at any point.
struct IncrementalTest {
  parcel: Parcel,
  input_fs: Arc<MemoryFileSystem>,
  output_fs: Arc<MemoryFileSystem>,
  entries: Vec<String>,
  mode: BuildMode,
  /// Mirror of the current input file state, used both to distinguish created from changed
  /// files and to reconstruct the project for fresh builds.
  files: BTreeMap<String, String>,
}

impl IncrementalTest {
  #[track_caller]
  fn new(files: &[(&str, &str)]) -> Self {
    Self::with_entries(files, &["/project/index.js"])
  }

  #[track_caller]
  fn new_production(files: &[(&str, &str)]) -> Self {
    Self::with_entries_mode(files, &["/project/index.js"], BuildMode::Production)
  }

  #[track_caller]
  fn with_entries(files: &[(&str, &str)], entries: &[&str]) -> Self {
    Self::with_entries_mode(files, entries, BuildMode::Development)
  }

  #[track_caller]
  fn with_entries_mode(files: &[(&str, &str)], entries: &[&str], mode: BuildMode) -> Self {
    let input_fs = Arc::new(MemoryFileSystem::new());
    let output_fs = Arc::new(MemoryFileSystem::new());
    let mut mirror = BTreeMap::new();

    // The JS transformer injects a dependency on this runtime helper for ES module
    // interop; make it resolvable inside the in-memory project.
    let runtime_files = [
      (
        "/project/node_modules/@parcel/parcel3/package.json",
        r#"{"name": "@parcel/parcel3", "version": "3.0.0"}"#,
      ),
      (
        "/project/node_modules/@parcel/parcel3/src/esmodule-helpers.js",
        include_str!("../../../packages/core/parcel3/src/esmodule-helpers.js"),
      ),
    ];
    for (path, contents) in runtime_files {
      mirror.insert(path.to_string(), contents.to_string());
    }
    for (path, contents) in files {
      mirror.insert(path.to_string(), contents.to_string());
    }
    for (path, contents) in &mirror {
      write_file(&input_fs, path, contents);
    }

    let entries: Vec<String> = entries.iter().map(|e| e.to_string()).collect();
    let options = make_options(input_fs.clone(), output_fs.clone(), mode.clone());
    let mut parcel = make_parcel(&entries, options).expect("Parcel::new failed");
    parcel.build().expect("initial build failed");

    IncrementalTest {
      parcel,
      input_fs,
      output_fs,
      entries,
      mode,
      files: mirror,
    }
  }

  /// Applies writes and deletions to the input file system and notifies the incremental build.
  fn apply(&mut self, write: &[(&str, &str)], delete: &[&str]) -> Result<(), DiagnosticList> {
    let mut changed = Vec::new();
    let mut created = Vec::new();
    let mut deleted = Vec::new();

    for (path, contents) in write {
      // A file watcher reports creation events for new directories as well as new files;
      // resolver invalidations can be registered against a directory probe (e.g. a missing
      // `node_modules`), so report ancestors that did not exist before this write.
      let mut ancestor = Path::new(path).parent();
      while let Some(dir) = ancestor {
        let prefix = format!("{}/", dir.to_str().unwrap());
        if self.files.keys().any(|file| file.starts_with(&prefix)) {
          break;
        }
        created.push(PathId::new(dir));
        ancestor = dir.parent();
      }

      write_file(&self.input_fs, path, contents);
      let id = PathId::new(Path::new(path));
      if self
        .files
        .insert(path.to_string(), contents.to_string())
        .is_some()
      {
        changed.push(id);
      } else {
        created.push(id);
      }
    }

    for path in delete {
      self
        .input_fs
        .remove_file(PathId::new(Path::new(path)))
        .expect("failed to delete input file");
      assert!(
        self.files.remove(*path).is_some(),
        "deleted file {path} was not part of the project"
      );
      deleted.push(PathId::new(Path::new(path)));
    }

    // Prune directories left empty by the deletions, as `rm -rf` would, and report them as
    // deleted the way a file watcher does. Resolution can depend on directory existence
    // (e.g. a nested node_modules), so an empty leftover directory would be unrealistic.
    for path in delete {
      let mut ancestor = Path::new(path).parent();
      while let Some(dir) = ancestor {
        let prefix = format!("{}/", dir.to_str().unwrap());
        if self.files.keys().any(|file| file.starts_with(&prefix)) {
          break;
        }
        let id = PathId::new(dir);
        if !deleted.contains(&id) {
          let _ = self.input_fs.remove_file(id);
          deleted.push(id);
        }
        ancestor = dir.parent();
      }
    }

    let result = self.parcel.invalidate(&changed, &created, &deleted)?;
    if !result.needs_rebuild() {
      return Ok(());
    }

    self.parcel.build_with_changes().map(|_| ())
  }

  /// Applies a change, rebuilds incrementally, and asserts the result is identical to a
  /// fresh build of the same input state.
  #[track_caller]
  fn change(&mut self, write: &[(&str, &str)], delete: &[&str]) {
    if let Err(err) = self.apply(write, delete) {
      panic!("incremental build failed: {:?}", err);
    }
    self.assert_matches_fresh();
  }

  /// Applies a change that is expected to fail the incremental build, returning its
  /// diagnostics. A fresh build of the same state must fail as well.
  #[track_caller]
  fn change_expect_error(&mut self, write: &[(&str, &str)], delete: &[&str]) -> DiagnosticList {
    let err = match self.apply(write, delete) {
      Err(err) => err,
      Ok(()) => panic!("expected the incremental build to fail, but it succeeded"),
    };

    let (_, fresh_result) = self.fresh_build();
    assert!(
      fresh_result.is_err(),
      "the incremental build failed but a fresh build of the same state succeeded: {:?}",
      err
    );
    err
  }

  /// Builds the current input state from scratch with a brand-new Parcel into a new output
  /// file system. Returns the outputs and the build result.
  fn fresh_build(&self) -> (BTreeMap<String, String>, Result<(), DiagnosticList>) {
    let input_fs = Arc::new(MemoryFileSystem::new());
    for (path, contents) in &self.files {
      write_file(&input_fs, path, contents);
    }
    let output_fs = Arc::new(MemoryFileSystem::new());
    let options = make_options(input_fs, output_fs.clone(), self.mode.clone());
    let result = parcel::build(&self.entries, options).map(|_| ());
    (read_all_files(&output_fs), result)
  }

  /// Asserts that every output file of the incremental build matches a fresh build of the
  /// same input state, byte for byte, with no extra or missing files.
  #[track_caller]
  fn assert_matches_fresh(&self) {
    let (fresh, fresh_result) = self.fresh_build();
    if let Err(err) = fresh_result {
      panic!(
        "the incremental build succeeded but a fresh build of the same state failed: {:?}",
        err
      );
    }
    let incremental = read_all_files(&self.output_fs);

    assert_eq!(
      incremental.keys().collect::<Vec<_>>(),
      fresh.keys().collect::<Vec<_>>(),
      "incremental build produced a different set of output files than a fresh build"
    );
    assert_eq!(
      incremental, fresh,
      "incremental build output differs from a fresh build"
    );
  }

  /// Reads a single output file, panicking with the list of available outputs when missing.
  #[track_caller]
  fn output(&self, path: &str) -> String {
    let outputs = read_all_files(&self.output_fs);
    outputs.get(path).cloned().unwrap_or_else(|| {
      panic!(
        "no output file {path}; available outputs: {:?}",
        outputs.keys().collect::<Vec<_>>()
      )
    })
  }

  /// Returns the path of the single non-sourcemap output file whose name starts with
  /// `prefix` (bundle names may embed content-independent hash ids, e.g. `page-<id>.js`).
  #[track_caller]
  fn find_output(&self, prefix: &str) -> String {
    let outputs = read_all_files(&self.output_fs);
    let matches: Vec<&String> = outputs
      .keys()
      .filter(|path| {
        !path.ends_with(".map")
          && Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(prefix))
      })
      .collect();
    match matches.as_slice() {
      [path] => (*path).clone(),
      _ => panic!(
        "expected exactly one output starting with {prefix}, got {:?}",
        matches
      ),
    }
  }

  /// All current output files (path → content).
  fn all_outputs(&self) -> BTreeMap<String, String> {
    read_all_files(&self.output_fs)
  }

  /// Returns the path of the single output file with the given extension.
  #[track_caller]
  fn find_output_ext(&self, ext: &str) -> String {
    let outputs = read_all_files(&self.output_fs);
    let matches: Vec<&String> = outputs
      .keys()
      .filter(|path| path.ends_with(&format!(".{ext}")))
      .collect();
    match matches.as_slice() {
      [path] => (*path).clone(),
      _ => panic!("expected exactly one .{ext} output, got {:?}", matches),
    }
  }
}

/// Recursively reads every file in the file system into a path → content map.
fn read_all_files(fs: &MemoryFileSystem) -> BTreeMap<String, String> {
  let mut out = BTreeMap::new();
  let mut stack = vec![PathBuf::from("/")];
  while let Some(dir) = stack.pop() {
    let Ok(entries) = fs.read_dir(PathId::new(&dir)) else {
      continue;
    };
    for entry in entries {
      let path = dir.join(&entry.name);
      if entry.kind.contains(FileKind::IS_DIR) {
        stack.push(path);
      } else if entry.kind.contains(FileKind::IS_FILE) {
        let bytes = fs.read(PathId::new(&path)).unwrap();
        out.insert(
          path.to_string_lossy().into_owned(),
          String::from_utf8_lossy(&bytes).into_owned(),
        );
      }
    }
  }
  out
}

// ---------------------------------------------------------------------------
// Content changes
// ---------------------------------------------------------------------------

#[test]
fn update_module_content() {
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "import './foo.js';\noutput('index');"),
    ("/project/foo.js", "console.log('foo v1');"),
  ]);

  t.change(&[("/project/foo.js", "console.log('foo v2');")], &[]);
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("foo v2"), "got: {out}");
  assert!(!out.contains("foo v1"), "got: {out}");

  // Changing it back must also converge.
  t.change(&[("/project/foo.js", "console.log('foo v1');")], &[]);
}

// ---------------------------------------------------------------------------
// Adding and removing dependencies
// ---------------------------------------------------------------------------

#[test]
fn add_dependency_on_new_file() {
  let mut t = IncrementalTest::new(&[("/project/index.js", "output('index');")]);

  t.change(
    &[
      (
        "/project/index.js",
        "import './foo.js';\noutput('index v2');",
      ),
      ("/project/foo.js", "console.log('foo');"),
    ],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("foo"), "got: {out}");
}

#[test]
fn remove_dependency() {
  let mut t = IncrementalTest::new(&[
    (
      "/project/index.js",
      "import './foo.js';\nimport './bar.js';\noutput('index');",
    ),
    ("/project/foo.js", "console.log('foo');"),
    ("/project/bar.js", "console.log('bar');"),
  ]);

  t.change(
    &[(
      "/project/index.js",
      "import './foo.js';\noutput('index v2');",
    )],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(!out.contains("console.log('bar')"), "got: {out}");

  // Re-adding the dependency must restore it.
  t.change(
    &[(
      "/project/index.js",
      "import './foo.js';\nimport './bar.js';\noutput('index v3');",
    )],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("console.log('bar')"), "got: {out}");
}

#[test]
fn remove_dependency_and_delete_file() {
  // Removing an import and deleting the imported file in the same change set (e.g. a git
  // checkout) must rebuild cleanly: the deleted file is no longer referenced.
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "import './foo.js';\noutput('index');"),
    ("/project/foo.js", "console.log('foo');"),
  ]);

  t.change(
    &[("/project/index.js", "output('index v2');")],
    &["/project/foo.js"],
  );
  let out = t.output("/project/dist/index.js");
  assert!(!out.contains("console.log('foo')"), "got: {out}");

  // Bringing the import and file back must converge as well.
  t.change(
    &[
      (
        "/project/index.js",
        "import './foo.js';\noutput('index v3');",
      ),
      ("/project/foo.js", "console.log('foo restored');"),
    ],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("foo restored"), "got: {out}");
}

#[test]
fn delete_imported_file_then_restore() {
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "import './foo.js';\noutput('index');"),
    ("/project/foo.js", "console.log('foo v1');"),
  ]);

  t.change_expect_error(&[], &["/project/foo.js"]);

  // Restoring the file must recover, and converge to a fresh build.
  t.change(&[("/project/foo.js", "console.log('foo v2');")], &[]);
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("foo v2"), "got: {out}");
}

#[test]
fn syntax_error_then_fix() {
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "import './foo.js';\noutput('index');"),
    ("/project/foo.js", "console.log('foo v1');"),
  ]);

  t.change_expect_error(&[("/project/foo.js", "console.log('foo v2'")], &[]);
  t.change(&[("/project/foo.js", "console.log('foo v3');")], &[]);
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("foo v3"), "got: {out}");
}

// ---------------------------------------------------------------------------
// Changing dependency resolution
// ---------------------------------------------------------------------------

#[test]
fn change_dependency_specifier() {
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "import './a.js';\noutput('index');"),
    ("/project/a.js", "console.log('module a');"),
    ("/project/b.js", "console.log('module b');"),
  ]);

  t.change(
    &[("/project/index.js", "import './b.js';\noutput('index');")],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("module b"), "got: {out}");
  assert!(!out.contains("module a"), "got: {out}");
}

#[test]
fn new_file_changes_resolution() {
  // `./foo` initially resolves to `./foo/index.js`. Creating `./foo.js` must re-resolve the
  // dependency, because a file with an extension takes precedence over a directory index.
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "import './foo';\noutput('index');"),
    ("/project/foo/index.js", "console.log('directory index');"),
  ]);

  t.change(&[("/project/foo.js", "console.log('foo file');")], &[]);
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("foo file"), "got: {out}");
  assert!(!out.contains("directory index"), "got: {out}");
}

#[test]
fn delete_file_changes_resolution() {
  // The reverse: deleting `./foo.js` must fall back to resolving `./foo/index.js`.
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "import './foo';\noutput('index');"),
    ("/project/foo.js", "console.log('foo file');"),
    ("/project/foo/index.js", "console.log('directory index');"),
  ]);

  t.change(&[], &["/project/foo.js"]);
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("directory index"), "got: {out}");
  assert!(!out.contains("foo file"), "got: {out}");

  // Recreating the file must switch the resolution back.
  t.change(
    &[("/project/foo.js", "console.log('foo file again');")],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("foo file again"), "got: {out}");
  assert!(!out.contains("directory index"), "got: {out}");
}

#[test]
fn package_json_main_change_re_resolves() {
  // Changing a package's entry point (its package.json `main`) is a resolver-level
  // invalidation of the importing asset, not a config change.
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "import 'dep';\noutput('index');"),
    (
      "/project/node_modules/dep/package.json",
      r#"{"name": "dep", "main": "one.js"}"#,
    ),
    ("/project/node_modules/dep/one.js", "console.log('one');"),
    ("/project/node_modules/dep/two.js", "console.log('two');"),
  ]);

  t.change(
    &[(
      "/project/node_modules/dep/package.json",
      r#"{"name": "dep", "main": "two.js"}"#,
    )],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(
    out.contains("console.log(\"two\")") || out.contains("console.log('two')"),
    "got: {out}"
  );
}

#[test]
fn nested_node_modules_takes_precedence_then_falls_back() {
  // node_modules resolution walks up from the importing file, so a copy of a package created
  // in a closer node_modules directory must win over the higher-level one — and deleting the
  // closer copy must fall back to the higher-level version again.
  let mut t = IncrementalTest::with_entries(
    &[
      (
        "/project/src/index.js",
        "import { value } from 'dep';\noutput(value);",
      ),
      (
        "/project/node_modules/dep/package.json",
        r#"{"name": "dep", "main": "index.js"}"#,
      ),
      (
        "/project/node_modules/dep/index.js",
        "export const value = 'root-dep';",
      ),
    ],
    &["/project/src/index.js"],
  );

  let out = t.output(&t.find_output("index"));
  assert!(out.contains("root-dep"), "got: {out}");

  // Create a closer copy of the package: it must take precedence.
  t.change(
    &[
      (
        "/project/src/node_modules/dep/package.json",
        r#"{"name": "dep", "main": "index.js"}"#,
      ),
      (
        "/project/src/node_modules/dep/index.js",
        "export const value = 'nested-dep';",
      ),
    ],
    &[],
  );
  let out = t.output(&t.find_output("index"));
  assert!(out.contains("nested-dep"), "got: {out}");
  assert!(!out.contains("root-dep"), "got: {out}");

  // Delete the closer copy: resolution must fall back to the higher-level version.
  t.change(
    &[],
    &[
      "/project/src/node_modules/dep/package.json",
      "/project/src/node_modules/dep/index.js",
    ],
  );
  let out = t.output(&t.find_output("index"));
  assert!(out.contains("root-dep"), "got: {out}");
  assert!(!out.contains("nested-dep"), "got: {out}");
}

// ---------------------------------------------------------------------------
// Changing dependency priority
// ---------------------------------------------------------------------------

#[test]
fn dependency_priority_sync_to_async_and_back() {
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "import './page.js';\noutput('index');"),
    ("/project/page.js", "console.log('page');"),
  ]);

  // Sync -> async: the page splits into its own bundle.
  t.change(
    &[(
      "/project/index.js",
      "import('./page.js');\noutput('index');",
    )],
    &[],
  );
  let page = t.find_output("page");
  assert!(t.output(&page).contains("page"));

  // Async -> sync: the page merges back into the entry bundle.
  t.change(
    &[("/project/index.js", "import './page.js';\noutput('index');")],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("page"), "got: {out}");
}

#[test]
fn async_dependency_target_content_change() {
  // A content change inside an async bundle repackages only that bundle, but the result must
  // still match a fresh build exactly.
  let mut t = IncrementalTest::new(&[
    (
      "/project/index.js",
      "import('./page.js');\noutput('index');",
    ),
    (
      "/project/page.js",
      "import './shared.js';\nconsole.log('page');",
    ),
    ("/project/shared.js", "console.log('shared v1');"),
  ]);

  t.change(&[("/project/shared.js", "console.log('shared v2');")], &[]);
  let page = t.find_output("page");
  assert!(t.output(&page).contains("shared v2"));
}

// ---------------------------------------------------------------------------
// Symbol resolution changes
// ---------------------------------------------------------------------------

/// A side-effect-free package with two modules re-exported from its index, so unused
/// modules are deferred (never transformed) until a symbol from them is requested.
fn side_effect_free_lib() -> Vec<(&'static str, &'static str)> {
  vec![
    (
      "/project/node_modules/lib/package.json",
      r#"{"name": "lib", "main": "index.js", "sideEffects": false}"#,
    ),
    (
      "/project/node_modules/lib/index.js",
      "export * from './a.js';\nexport * from './b.js';",
    ),
    (
      "/project/node_modules/lib/a.js",
      "export const a = 'value-a';",
    ),
    (
      "/project/node_modules/lib/b.js",
      "export const b = 'value-b';",
    ),
  ]
}

#[test]
fn add_used_symbol() {
  // Importing a new symbol must transform the previously deferred module providing it.
  let mut files = side_effect_free_lib();
  files.push(("/project/index.js", "import { a } from 'lib';\noutput(a);"));
  let mut t = IncrementalTest::new(&files);

  let out = t.output("/project/dist/index.js");
  assert!(out.contains("value-a"), "got: {out}");
  assert!(!out.contains("value-b"), "got: {out}");

  t.change(
    &[(
      "/project/index.js",
      "import { a, b } from 'lib';\noutput(a + b);",
    )],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("value-a"), "got: {out}");
  assert!(out.contains("value-b"), "got: {out}");
}

#[test]
fn remove_used_symbol() {
  // Removing the last import of a symbol must re-defer (tree-shake) the module providing it,
  // matching what a fresh build would produce.
  let mut files = side_effect_free_lib();
  files.push((
    "/project/index.js",
    "import { a, b } from 'lib';\noutput(a + b);",
  ));
  let mut t = IncrementalTest::new(&files);

  t.change(
    &[("/project/index.js", "import { a } from 'lib';\noutput(a);")],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("value-a"), "got: {out}");
  assert!(!out.contains("value-b"), "got: {out}");
}

#[test]
fn add_and_remove_used_symbol_production() {
  // The same symbol churn under production scope hoisting, where stale symbol-request state
  // would keep dead code alive (or drop live code).
  let mut files = side_effect_free_lib();
  files.push(("/project/index.js", "import { a } from 'lib';\noutput(a);"));
  let mut t = IncrementalTest::new_production(&files);

  t.change(
    &[(
      "/project/index.js",
      "import { a, b } from 'lib';\noutput(a + b);",
    )],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("value-b"), "got: {out}");

  t.change(
    &[("/project/index.js", "import { a } from 'lib';\noutput(a);")],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("value-a"), "got: {out}");
  assert!(!out.contains("value-b"), "got: {out}");
}

#[test]
fn remove_import_of_individual_export_production() {
  // Both symbols live in a single side-effect-free module. Dropping one symbol from the
  // import list (while keeping the import itself) must tree-shake that export's code from
  // the unchanged module — and adding it back must restore it.
  let mut t = IncrementalTest::new_production(&[
    (
      "/project/node_modules/lib/package.json",
      r#"{"name": "lib", "main": "index.js", "sideEffects": false}"#,
    ),
    (
      "/project/node_modules/lib/index.js",
      "export const a = 'value-a';\nexport const b = 'value-b';",
    ),
    (
      "/project/index.js",
      "import { a, b } from 'lib';\noutput(a + b);",
    ),
  ]);

  let out = t.output("/project/dist/index.js");
  assert!(out.contains("value-a"), "got: {out}");
  assert!(out.contains("value-b"), "got: {out}");

  t.change(
    &[("/project/index.js", "import { a } from 'lib';\noutput(a);")],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("value-a"), "got: {out}");
  assert!(
    !out.contains("value-b"),
    "the no-longer-imported export should be tree shaken, got: {out}"
  );

  t.change(
    &[(
      "/project/index.js",
      "import { a, b } from 'lib';\noutput(a + b);",
    )],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("value-b"), "got: {out}");
}

#[test]
fn change_reexport_target_production() {
  let mut t = IncrementalTest::new_production(&[
    (
      "/project/index.js",
      "import { value } from './lib.js';\noutput(value);",
    ),
    ("/project/lib.js", "export { value } from './a.js';"),
    ("/project/a.js", "export const value = 'from-a';"),
    ("/project/b.js", "export const value = 'from-b';"),
  ]);

  t.change(
    &[("/project/lib.js", "export { value } from './b.js';")],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("from-b"), "got: {out}");
  assert!(!out.contains("from-a"), "got: {out}");
}

#[test]
fn change_reexport_target() {
  // Updating a re-export to point at a different module must re-resolve the symbol through
  // the changed module.
  let mut t = IncrementalTest::new(&[
    (
      "/project/index.js",
      "import { value } from './lib.js';\noutput(value);",
    ),
    ("/project/lib.js", "export { value } from './a.js';"),
    ("/project/a.js", "export const value = 'from-a';"),
    ("/project/b.js", "export const value = 'from-b';"),
  ]);

  let out = t.output("/project/dist/index.js");
  assert!(out.contains("from-a"), "got: {out}");

  t.change(
    &[("/project/lib.js", "export { value } from './b.js';")],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("from-b"), "got: {out}");
  assert!(!out.contains("from-a"), "got: {out}");
}

#[test]
fn rename_export_in_leaf_module() {
  // Renaming an export (keeping the importer unchanged) re-transforms only the leaf, but
  // symbol resolution in the unchanged importer must still be updated.
  let mut t = IncrementalTest::new(&[
    (
      "/project/index.js",
      "import { value } from './lib.js';\noutput(value);",
    ),
    (
      "/project/lib.js",
      "const inner = 'v1';\nexport { inner as value };",
    ),
  ]);

  t.change(
    &[(
      "/project/lib.js",
      "const renamed = 'v2';\nexport { renamed as value };",
    )],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("v2"), "got: {out}");
}

#[test]
fn export_moves_between_star_reexport_sources() {
  // A symbol initially provided by one `export *` source moves to the other. Only the leaf
  // modules change; the importer and the re-exporting index stay untouched.
  let mut t = IncrementalTest::new(&[
    (
      "/project/index.js",
      "import { moved } from './lib/index.js';\noutput(moved);",
    ),
    (
      "/project/lib/index.js",
      "export * from './a.js';\nexport * from './b.js';",
    ),
    ("/project/lib/a.js", "export const moved = 'in-a';"),
    ("/project/lib/b.js", "export const other = 'other';"),
  ]);

  let out = t.output("/project/dist/index.js");
  assert!(out.contains("in-a"), "got: {out}");

  t.change(
    &[
      ("/project/lib/a.js", "export const unrelated = 'nope';"),
      (
        "/project/lib/b.js",
        "export const moved = 'in-b';\nexport const other = 'other';",
      ),
    ],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("in-b"), "got: {out}");
}

// ---------------------------------------------------------------------------
// Side effects and other flags
// ---------------------------------------------------------------------------

#[test]
fn side_effects_flag_change() {
  // Turning a package's `sideEffects` flag on must stop tree-shaking its unused modules;
  // turning it back off must re-enable tree shaking. The package.json is read by the
  // resolver, so this is a per-asset invalidation, not a config change.
  let mut files = side_effect_free_lib();
  files.push(("/project/index.js", "import { a } from 'lib';\noutput(a);"));
  let mut t = IncrementalTest::new(&files);

  let out = t.output("/project/dist/index.js");
  assert!(!out.contains("value-b"), "got: {out}");

  t.change(
    &[(
      "/project/node_modules/lib/package.json",
      r#"{"name": "lib", "main": "index.js", "sideEffects": true}"#,
    )],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("value-b"), "got: {out}");

  t.change(
    &[(
      "/project/node_modules/lib/package.json",
      r#"{"name": "lib", "main": "index.js", "sideEffects": false}"#,
    )],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(!out.contains("value-b"), "got: {out}");
}

// ---------------------------------------------------------------------------
// Inline assets
// ---------------------------------------------------------------------------

#[test]
fn update_inline_bundle() {
  // `bundle-text:` inlines a compiled bundle into its parent. Updating the inlined asset
  // must repackage the parent with the new content.
  let mut t = IncrementalTest::new(&[
    (
      "/project/index.js",
      "import text from 'bundle-text:./styles.css';\noutput(text);",
    ),
    ("/project/styles.css", ".a { color: #ff0001; }"),
  ]);

  let out = t.output("/project/dist/index.js");
  assert!(out.contains("#ff0001"), "got: {out}");

  t.change(&[("/project/styles.css", ".a { color: #00ff02; }")], &[]);
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("#00ff02"), "got: {out}");
  assert!(!out.contains("#ff0001"), "got: {out}");
}

#[test]
fn add_and_remove_inline_bundle() {
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "output('no inline');"),
    ("/project/styles.css", ".a { color: #ff0001; }"),
  ]);

  t.change(
    &[(
      "/project/index.js",
      "import text from 'bundle-text:./styles.css';\noutput(text);",
    )],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("#ff0001"), "got: {out}");

  t.change(&[("/project/index.js", "output('no inline');")], &[]);
  let out = t.output("/project/dist/index.js");
  assert!(!out.contains("#ff0001"), "got: {out}");
}

#[test]
fn update_data_url_dependency() {
  let mut t = IncrementalTest::new(&[
    (
      "/project/index.js",
      "import url from 'data-url:./img.svg';\noutput(url);",
    ),
    ("/project/img.svg", "<svg><rect/></svg>"),
  ]);

  t.change(&[("/project/img.svg", "<svg><circle/></svg>")], &[]);
}

#[test]
fn html_inline_script_update_add_remove() {
  // Inline scripts in HTML become assets identified by a unique key. Updating, adding, and
  // removing them must all converge to a fresh build.
  let mut t = IncrementalTest::with_entries(
    &[(
      "/project/index.html",
      "<html><body><script>console.log('one v1');</script></body></html>",
    )],
    &["/project/index.html"],
  );

  // Update the inline script.
  t.change(
    &[(
      "/project/index.html",
      "<html><body><script>console.log('one v2');</script></body></html>",
    )],
    &[],
  );
  let out = t.output("/project/dist/index.html");
  assert!(out.contains("one v2"), "got: {out}");

  // Add a second inline script.
  t.change(
    &[(
      "/project/index.html",
      "<html><body><script>console.log('one v2');</script><script>console.log('two');</script></body></html>",
    )],
    &[],
  );
  let out = t.output("/project/dist/index.html");
  assert!(out.contains("two"), "got: {out}");

  // Remove the first inline script.
  t.change(
    &[(
      "/project/index.html",
      "<html><body><script>console.log('two');</script></body></html>",
    )],
    &[],
  );
  let out = t.output("/project/dist/index.html");
  assert!(!out.contains("one v2"), "got: {out}");
}

#[test]
fn html_external_script_and_css_update() {
  // An HTML entry with an external script and stylesheet. Updating each must repackage the
  // right bundles; adding and removing references must add/delete outputs.
  let mut t = IncrementalTest::with_entries(
    &[
      (
        "/project/index.html",
        "<html><head><link rel=\"stylesheet\" href=\"./styles.css\"></head><body><script src=\"./app.js\" type=\"module\"></script></body></html>",
      ),
      ("/project/app.js", "console.log('app v1');"),
      ("/project/styles.css", ".a { color: #ff0001; }"),
    ],
    &["/project/index.html"],
  );

  t.change(&[("/project/app.js", "console.log('app v2');")], &[]);
  let js = t.find_output_ext("js");
  assert!(t.output(&js).contains("app v2"));

  t.change(&[("/project/styles.css", ".a { color: #00ff02; }")], &[]);
  let css = t.find_output_ext("css");
  assert!(t.output(&css).contains("#00ff02"));

  // Remove the stylesheet reference: its output file must disappear.
  t.change(
    &[(
      "/project/index.html",
      "<html><head></head><body><script src=\"./app.js\" type=\"module\"></script></body></html>",
    )],
    &[],
  );
  assert!(
    !t.all_outputs().keys().any(|path| path.ends_with(".css")),
    "unreferenced css output should be deleted"
  );
}

#[test]
fn url_dependency_update_add_remove() {
  // A URL dependency writes the referenced asset as its own output file. Updating the asset
  // must rewrite it; removing the reference must delete the output.
  let mut t = IncrementalTest::new(&[
    (
      "/project/index.js",
      "const u = new URL('./img.svg', import.meta.url);\noutput(u.href);",
    ),
    ("/project/img.svg", "<svg><rect width=\"1\"/></svg>"),
  ]);

  let svg = t.find_output_ext("svg");
  assert!(t.output(&svg).contains("rect"));

  t.change(&[("/project/img.svg", "<svg><circle r=\"1\"/></svg>")], &[]);
  let svg = t.find_output_ext("svg");
  assert!(t.output(&svg).contains("circle"));

  t.change(&[("/project/index.js", "output('no url');")], &[]);
  assert!(
    !t.all_outputs().keys().any(|path| path.ends_with(".svg")),
    "the unreferenced svg output should be deleted"
  );
}

// ---------------------------------------------------------------------------
// CSS composition changes
// ---------------------------------------------------------------------------

#[test]
fn css_import_added_and_removed() {
  let mut t = IncrementalTest::new(&[
    (
      "/project/index.js",
      "import './styles.css';\noutput('index');",
    ),
    ("/project/styles.css", ".styles { color: #ff0001; }"),
    ("/project/theme.css", ".theme { color: #00ff02; }"),
  ]);

  t.change(
    &[(
      "/project/styles.css",
      "@import './theme.css';\n.styles { color: #ff0001; }",
    )],
    &[],
  );
  let css = t.find_output_ext("css");
  assert!(t.output(&css).contains(".theme"));

  t.change(
    &[("/project/styles.css", ".styles { color: #ff0001; }")],
    &[],
  );
  let css = t.find_output_ext("css");
  assert!(!t.output(&css).contains(".theme"));
}

// ---------------------------------------------------------------------------
// Configuration changes
// ---------------------------------------------------------------------------

#[test]
fn parcelrc_change_produces_fresh_state() {
  // Editing .parcelrc rebuilds from scratch. Combined with a source change in the same
  // change set, the result must still exactly match a fresh build — including deleting
  // output files whose bundles no longer exist.
  let mut t = IncrementalTest::new(&[
    (
      "/project/.parcelrc",
      r#"{"extends": "@parcel/config-default"}"#,
    ),
    (
      "/project/index.js",
      "import('./page.js');\noutput('index');",
    ),
    ("/project/page.js", "console.log('page');"),
  ]);

  // Drop the async import and touch the config at the same time.
  t.change(
    &[
      ("/project/index.js", "output('index v2');"),
      (
        "/project/.parcelrc",
        r#"{"extends": "@parcel/config-default"}"#,
      ),
    ],
    &[],
  );
}

// ---------------------------------------------------------------------------
// Library targets and multiple entries
// ---------------------------------------------------------------------------

#[test]
fn library_entry_update() {
  // Library entries request their full namespace of exports. Invalidating the entry must not
  // lose that request: the rebuilt library must still include all exports.
  let mut t = IncrementalTest::with_entries(
    &[
      (
        "/project/package.json",
        r#"{
          "name": "mylib",
          "source": "index.js",
          "main": "dist/main.js",
          "engines": { "node": "*" }
        }"#,
      ),
      (
        "/project/index.js",
        "export const a = 'value-a-v1';\nexport function helper() { return 'helper-v1'; }",
      ),
    ],
    // The entry is the package directory, so targets come from package.json (`main`).
    &["/project"],
  );

  let out = t.output("/project/dist/main.js");
  assert!(out.contains("value-a-v1"), "got: {out}");
  assert!(out.contains("helper-v1"), "got: {out}");

  t.change(
    &[(
      "/project/index.js",
      "export const a = 'value-a-v2';\nexport function helper() { return 'helper-v2'; }",
    )],
    &[],
  );
  let out = t.output("/project/dist/main.js");
  assert!(out.contains("value-a-v2"), "got: {out}");
  assert!(out.contains("helper-v2"), "got: {out}");
}

#[test]
fn library_adds_reexport_of_side_effect_free_module() {
  // A library entry's namespace request originates from the entry itself, not from any
  // import. When the entry is re-transformed and gains a re-export of a side-effect-free
  // module, that request must be re-derived or the new module is never transformed.
  let mut files = side_effect_free_lib();
  files.extend([
    (
      "/project/package.json",
      // Without includeNodeModules, library builds leave node_modules deps external.
      r#"{
        "name": "mylib",
        "source": "index.js",
        "main": "dist/main.js",
        "engines": { "node": "*" },
        "targets": { "main": { "includeNodeModules": true } }
      }"#,
    ),
    ("/project/index.js", "export { a } from 'lib';"),
  ]);
  let mut t = IncrementalTest::with_entries(&files, &["/project"]);

  let combined: String = t.all_outputs().values().cloned().collect();
  assert!(combined.contains("value-a"), "outputs: {combined}");

  t.change(
    &[(
      "/project/index.js",
      "export { a } from 'lib';\nexport { b } from 'lib';",
    )],
    &[],
  );
  let combined: String = t.all_outputs().values().cloned().collect();
  assert!(combined.contains("value-a"), "outputs: {combined}");
  assert!(
    combined.contains("value-b"),
    "the newly re-exported symbol must be transformed and packaged, outputs: {combined}"
  );

  // `export *` is not an import, so its side-effect-free target is only requested through
  // the entry's namespace — which must be re-derived when the entry is re-transformed.
  t.change(
    &[
      (
        "/project/node_modules/lib2/package.json",
        r#"{"name": "lib2", "main": "index.js", "sideEffects": false}"#,
      ),
      (
        "/project/node_modules/lib2/index.js",
        "export const c = 'value-c';",
      ),
      (
        "/project/index.js",
        "export { a } from 'lib';\nexport * from 'lib2';",
      ),
    ],
    &[],
  );
  let combined: String = t.all_outputs().values().cloned().collect();
  assert!(
    combined.contains("value-c"),
    "the star re-exported module must be transformed and packaged, outputs: {combined}"
  );
}

#[test]
fn dynamic_import_of_side_effect_free_reexport() {
  // The namespace of a dynamically imported module is requested through a lazy import.
  // That request must survive rebuilds: page re-exports a side-effect-free module, which
  // must stay in the async bundle both on the initial build and after page is edited.
  let mut t = IncrementalTest::new(&[
    (
      "/project/node_modules/lib/package.json",
      r#"{"name": "lib", "main": "index.js", "sideEffects": false}"#,
    ),
    (
      "/project/node_modules/lib/index.js",
      "export const shared = 'value-shared';",
    ),
    (
      "/project/index.js",
      "globalThis.run = () => import('./page.js').then((m) => output(m.shared));\nglobalThis.run();",
    ),
    (
      "/project/page.js",
      "export * from 'lib';\nconsole.log('page v1');",
    ),
  ]);

  let page = t.find_output("page");
  assert!(
    t.output(&page).contains("value-shared"),
    "async bundle must include the side-effect-free re-exported module, got: {}",
    t.output(&page)
  );

  // Edit the async module: the re-derived namespace request must keep the re-export alive.
  t.change(
    &[(
      "/project/page.js",
      "export * from 'lib';\nconsole.log('page v2');",
    )],
    &[],
  );
  let page = t.find_output("page");
  assert!(
    t.output(&page).contains("value-shared"),
    "async bundle must still include the re-exported module after an edit, got: {}",
    t.output(&page)
  );
}

#[test]
fn shared_module_between_entries() {
  // A module shared by two entries: changing it must repackage both entry bundles.
  let mut t = IncrementalTest::with_entries(
    &[
      (
        "/project/one.js",
        "import { shared } from './shared.js';\noutput('one ' + shared);",
      ),
      (
        "/project/two.js",
        "import { shared } from './shared.js';\noutput('two ' + shared);",
      ),
      ("/project/shared.js", "export const shared = 'shared-v1';"),
    ],
    &["/project/one.js", "/project/two.js"],
  );

  t.change(
    &[("/project/shared.js", "export const shared = 'shared-v2';")],
    &[],
  );
  // The shared module may live in either entry bundle or a shared bundle; wherever it is,
  // the new content must be present and the old gone.
  let outputs = t.all_outputs();
  let combined: String = outputs.values().cloned().collect();
  assert!(
    combined.contains("shared-v2"),
    "outputs: {:?}",
    outputs.keys()
  );
  assert!(
    !combined.contains("shared-v1"),
    "outputs: {:?}",
    outputs.keys()
  );
}

#[test]
fn add_first_css_import() {
  // The first CSS import creates a brand-new CSS bundle (a new output path); removing it
  // must delete that output again.
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "output('no css');"),
    ("/project/styles.css", ".styles { color: #ff0001; }"),
  ]);

  t.change(
    &[(
      "/project/index.js",
      "import './styles.css';\noutput('with css');",
    )],
    &[],
  );
  let css = t.find_output_ext("css");
  assert!(t.output(&css).contains("#ff0001"));

  t.change(&[("/project/index.js", "output('no css');")], &[]);
}

#[test]
fn env_file_change_produces_fresh_state() {
  let mut t = IncrementalTest::new(&[
    ("/project/.env", "MESSAGE=hello-v1"),
    ("/project/index.js", "output(process.env.MESSAGE);"),
  ]);

  let out = t.output("/project/dist/index.js");
  assert!(out.contains("hello-v1"), "got: {out}");

  t.change(&[("/project/.env", "MESSAGE=hello-v2")], &[]);
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("hello-v2"), "got: {out}");
  assert!(!out.contains("hello-v1"), "got: {out}");
}

// ---------------------------------------------------------------------------
// Config file lifecycle
// ---------------------------------------------------------------------------

#[test]
fn add_and_delete_parcelrc() {
  // Parcel::new probes for a .parcelrc even when none exists, so creating one later must
  // apply the new config, and deleting it must fall back to the default config.
  let mut t = IncrementalTest::new(&[
    (
      "/project/index.js",
      "import data from './data.json';\noutput(data.value);",
    ),
    ("/project/data.json", r#"{"value": 42}"#),
  ]);

  // Default config inlines JSON as a module: no separate .json output.
  assert!(!t.all_outputs().keys().any(|path| path.ends_with(".json")));

  // Route .json through the raw transformer instead: a separate output file appears.
  t.change(
    &[(
      "/project/.parcelrc",
      r#"{
        "extends": "@parcel/config-default",
        "transformers": { "js:*.json": ["@parcel/transformer-raw"] }
      }"#,
    )],
    &[],
  );
  assert!(
    t.all_outputs().keys().any(|path| path.ends_with(".json")),
    "raw-transformed json should be emitted as its own file, outputs: {:?}",
    t.all_outputs().keys()
  );

  // Deleting the .parcelrc falls back to the default config again.
  t.change(&[], &["/project/.parcelrc"]);
  assert!(!t.all_outputs().keys().any(|path| path.ends_with(".json")));
}

#[test]
fn invalid_parcelrc_edit_keeps_last_good_build() {
  let mut t = IncrementalTest::new(&[
    (
      "/project/.parcelrc",
      r#"{"extends": "@parcel/config-default"}"#,
    ),
    ("/project/index.js", "output('v1');"),
  ]);

  // Breaking the config fails the rebuild, but the last good build state stays usable.
  t.change_expect_error(&[("/project/.parcelrc", r#"{"extends": }"#)], &[]);

  // Fixing the config recovers with a full rebuild.
  t.change(
    &[
      (
        "/project/.parcelrc",
        r#"{"extends": "@parcel/config-default"}"#,
      ),
      ("/project/index.js", "output('v2');"),
    ],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("v2"), "got: {out}");
}

#[test]
fn change_target_output_location() {
  // Moving a target's output location (package.json `main`) is a config change: the bundle
  // moves to the new path and the output at the old location is deleted.
  let mut t = IncrementalTest::with_entries(
    &[
      (
        "/project/package.json",
        r#"{
          "name": "app",
          "source": "index.js",
          "main": "dist/one.js",
          "engines": { "node": "*" }
        }"#,
      ),
      ("/project/index.js", "export const value = 'v1';"),
    ],
    &["/project"],
  );

  assert!(t.all_outputs().contains_key("/project/dist/one.js"));

  t.change(
    &[(
      "/project/package.json",
      r#"{
        "name": "app",
        "source": "index.js",
        "main": "dist/two.js",
        "engines": { "node": "*" }
      }"#,
    )],
    &[],
  );
  let outputs = t.all_outputs();
  assert!(outputs.contains_key("/project/dist/two.js"));
  assert!(
    !outputs.contains_key("/project/dist/one.js"),
    "the output at the old target location should be deleted, outputs: {:?}",
    outputs.keys()
  );
}

// ---------------------------------------------------------------------------
// Resolver configuration changes
// ---------------------------------------------------------------------------

#[test]
fn alias_in_closer_package_json() {
  // A package.json `alias` field closer to the importer overrides resolution; adding,
  // updating, and removing it must each re-resolve.
  let mut t = IncrementalTest::with_entries(
    &[
      (
        "/project/src/index.js",
        "import { value } from 'dep';\noutput(value);",
      ),
      (
        "/project/node_modules/dep/package.json",
        r#"{"name": "dep", "main": "index.js"}"#,
      ),
      (
        "/project/node_modules/dep/index.js",
        "export const value = 'real-dep';",
      ),
      (
        "/project/src/aliased.js",
        "export const value = 'aliased-dep';",
      ),
      ("/project/src/other.js", "export const value = 'other-dep';"),
    ],
    &["/project/src/index.js"],
  );

  let out = t.output(&t.find_output("index"));
  assert!(out.contains("real-dep"), "got: {out}");

  // Add an alias in a closer package.json.
  t.change(
    &[(
      "/project/src/package.json",
      r#"{"alias": {"dep": "./aliased.js"}}"#,
    )],
    &[],
  );
  let out = t.output(&t.find_output("index"));
  assert!(out.contains("aliased-dep"), "got: {out}");
  assert!(!out.contains("real-dep"), "got: {out}");

  // Update the alias target.
  t.change(
    &[(
      "/project/src/package.json",
      r#"{"alias": {"dep": "./other.js"}}"#,
    )],
    &[],
  );
  let out = t.output(&t.find_output("index"));
  assert!(out.contains("other-dep"), "got: {out}");

  // Remove the alias: resolution returns to node_modules.
  t.change(&[("/project/src/package.json", r#"{}"#)], &[]);
  let out = t.output(&t.find_output("index"));
  assert!(out.contains("real-dep"), "got: {out}");
}

#[test]
fn package_json_main_over_directory_index() {
  // A directory import resolves via index.js until the directory gains a package.json with
  // a `main` field, which takes precedence; deleting it falls back to index.js again.
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "import './lib';\noutput('index');"),
    ("/project/lib/index.js", "console.log('lib index');"),
    ("/project/lib/custom.js", "console.log('lib custom');"),
  ]);

  let out = t.output("/project/dist/index.js");
  assert!(out.contains("lib index"), "got: {out}");

  t.change(
    &[("/project/lib/package.json", r#"{"main": "custom.js"}"#)],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("lib custom"), "got: {out}");
  assert!(!out.contains("lib index"), "got: {out}");

  t.change(&[], &["/project/lib/package.json"]);
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("lib index"), "got: {out}");
  assert!(!out.contains("lib custom"), "got: {out}");
}

#[test]
fn create_missing_dependency() {
  // Importing a file that has never existed fails; creating the file must recover, driven
  // by the create-invalidations recorded during the failed resolution.
  let mut t = IncrementalTest::new(&[("/project/index.js", "output('no deps');")]);

  t.change_expect_error(
    &[(
      "/project/index.js",
      "import './missing.js';\noutput('index');",
    )],
    &[],
  );

  t.change(&[("/project/missing.js", "console.log('found');")], &[]);
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("found"), "got: {out}");
}

#[test]
fn invalid_package_json_recovery() {
  // The resolver tolerates a syntactically invalid package.json in node_modules by falling
  // back to the index file. Breaking and fixing the file must both re-resolve, staying
  // identical to a fresh build in every state.
  let mut t = IncrementalTest::new(&[
    ("/project/index.js", "import 'dep';\noutput('index');"),
    (
      "/project/node_modules/dep/package.json",
      r#"{"name": "dep", "main": "main.js"}"#,
    ),
    (
      "/project/node_modules/dep/main.js",
      "console.log('dep main');",
    ),
    (
      "/project/node_modules/dep/index.js",
      "console.log('dep index');",
    ),
  ]);

  let out = t.output("/project/dist/index.js");
  assert!(out.contains("dep main"), "got: {out}");

  // Broken package.json: resolution falls back to index.js.
  t.change(
    &[("/project/node_modules/dep/package.json", r#"{"name": }"#)],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("dep index"), "got: {out}");
  assert!(!out.contains("dep main"), "got: {out}");

  // Fixing it restores the `main` resolution.
  t.change(
    &[(
      "/project/node_modules/dep/package.json",
      r#"{"name": "dep", "main": "main.js"}"#,
    )],
    &[],
  );
  let out = t.output("/project/dist/index.js");
  assert!(out.contains("dep main"), "got: {out}");
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

#[test]
fn delete_glob_matched_entry() {
  // Deleting a file matched by an entry glob removes that entry from the build entirely
  // (a config-level change), deleting its stale output.
  let mut t = IncrementalTest::with_entries(
    &[
      ("/project/src/a.js", "output('entry a');"),
      ("/project/src/b.js", "output('entry b');"),
    ],
    &["/project/src/*.js"],
  );

  assert!(t.all_outputs().keys().any(|path| path.ends_with("/a.js")));
  assert!(t.all_outputs().keys().any(|path| path.ends_with("/b.js")));

  t.change(&[], &["/project/src/b.js"]);
  assert!(t.all_outputs().keys().any(|path| path.ends_with("/a.js")));
  assert!(
    !t.all_outputs().keys().any(|path| path.ends_with("/b.js")),
    "the deleted entry's output should be removed, outputs: {:?}",
    t.all_outputs().keys()
  );
}

// ---------------------------------------------------------------------------
// Multiple pipelines over one file
// ---------------------------------------------------------------------------

#[test]
fn same_file_in_multiple_pipelines() {
  // The same source file used through two pipelines produces two assets; updating the file
  // must re-transform both.
  let mut t = IncrementalTest::new(&[
    (
      "/project/index.js",
      "import './styles.css';\nimport text from 'bundle-text:./styles.css';\noutput(text);",
    ),
    ("/project/styles.css", ".marker { color: #ff0001; }"),
  ]);

  let css = t.find_output_ext("css");
  assert!(t.output(&css).contains("#ff0001"));
  assert!(t.output("/project/dist/index.js").contains("#ff0001"));

  t.change(
    &[("/project/styles.css", ".marker { color: #00ff02; }")],
    &[],
  );
  let css = t.find_output_ext("css");
  assert!(t.output(&css).contains("#00ff02"));
  let js = t.output("/project/dist/index.js");
  assert!(js.contains("#00ff02"), "got: {js}");
  assert!(!js.contains("#ff0001"), "got: {js}");
}
