//! Compiles plugin.h's generated wrappers with the system C compiler and runs
//! them against tables as an older Parcel would pass them: ending before
//! functions the header declares.
//!
//! The real table has nothing past its first layout yet, so the checked wrappers
//! are generated from a synthetic header that appends a few functions.

use std::{path::PathBuf, process::Command};

#[path = "../build/shims.rs"]
mod shims;

/// Compiles `main` against `header` (saved as plugin.h) and returns what it
/// printed, or `None` when there is no C compiler to run it with.
fn run_c(name: &str, header: &str, main: &str) -> Option<String> {
  let dir = PathBuf::from(env!("OUT_DIR")).join("shim-tests").join(name);
  std::fs::create_dir_all(&dir).unwrap();
  std::fs::write(dir.join("plugin.h"), header).unwrap();
  std::fs::write(dir.join("main.c"), main).unwrap();

  let cc = std::env::var("CC").unwrap_or_else(|_| "cc".into());
  let exe = dir.join("main");
  let output = match Command::new(&cc)
    .args([
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-Wno-unused-parameter",
    ])
    .arg("-I")
    .arg(&dir)
    .arg(dir.join("main.c"))
    .arg("-o")
    .arg(&exe)
    .output()
  {
    Ok(output) => output,
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
      eprintln!("skipping: no C compiler ({cc}) to build plugin.h with");
      return None;
    }
    Err(err) => panic!("could not run {cc}: {err}"),
  };
  assert!(
    output.status.success(),
    "plugin.h failed to compile:\n{}",
    String::from_utf8_lossy(&output.stderr)
  );

  let output = Command::new(&exe).output().unwrap();
  assert!(
    output.status.success(),
    "{name} exited with {}",
    output.status
  );
  Some(String::from_utf8(output.stdout).unwrap())
}

/// The header plugins actually build against compiles cleanly with a definition
/// of every entry point, agrees with Rust about where the first layout ends, and
/// accepts a table that ends there.
#[test]
fn real_header_accepts_a_first_layout_table() {
  let header = include_str!("../plugin.h");
  let main = r#"
#include <stdio.h>
#include "plugin.h"

const struct ParcelApi *parcel_api;

/* Every entry point, defined against the prototypes plugin.h declares: a
   signature that drifted from the types Parcel loads them as would not compile. */
InitStatus parcel_plugin_init(const struct ParcelApi *api, const uint8_t *config,
                              uintptr_t config_len, void **state, DiagnosticOptions *diagnostic) {
  return parcel_api_compatible(&api->header) ? PARCEL_INIT_OK : PARCEL_INIT_INCOMPATIBLE;
}
void parcel_plugin_deinit(void *state) {}
void parcel_plugin_transform(Asset asset, Options options, void *state, DiagnosticOptions *diagnostic) {
  /* A transformer's own asset is readable through the AssetRef getters. */
  Buffer buf = {0};
  parcel_asset_get_type(&buf, asset);
}
void parcel_plugin_resolve(Dependency dependency, const uint8_t *specifier,
                           uintptr_t specifier_len, const uint8_t *pipeline,
                           uintptr_t pipeline_len, Options options, ResolveResult *result,
                           void *state, DiagnosticOptions *diagnostic) {}
void parcel_plugin_name(BundleGraph bundle_graph, Bundle bundle, Options options, Buffer *name,
                        void *state, DiagnosticOptions *diagnostic) {
  AssetRef asset = parcel_bundle_graph_get_asset(bundle_graph, 0);
  parcel_asset_get_flags(asset);
}
void parcel_plugin_optimize(BundleGraph bundle_graph, Bundle bundle, const uint8_t *contents,
                            uintptr_t contents_len, const uint8_t *source_map,
                            uintptr_t source_map_len, Options options, OptimizeResult *result,
                            void *state, DiagnosticOptions *diagnostic) {}
void parcel_plugin_report(const ReportEvent *event, Options options, void *state,
                          DiagnosticOptions *diagnostic) {}

/* And each is what Parcel loads it as. */
ParcelPluginInitFn init = parcel_plugin_init;
ParcelPluginDeinitFn deinit = parcel_plugin_deinit;
ParcelPluginTransformFn transform = parcel_plugin_transform;
ParcelPluginResolveFn resolve = parcel_plugin_resolve;
ParcelPluginNameFn name = parcel_plugin_name;
ParcelPluginOptimizeFn optimize = parcel_plugin_optimize;
ParcelPluginReportFn report = parcel_plugin_report;

int main(void) {
  struct ParcelApiHeader old = {PARCEL_API_MIN_SIZE, PARCEL_ABI_VERSION, 0};
  struct ParcelApiHeader short_table = {PARCEL_API_MIN_SIZE - 1, PARCEL_ABI_VERSION, 0};
  struct ParcelApiHeader other_abi = {sizeof(struct ParcelApi), PARCEL_ABI_VERSION + 1, 0};
  printf("%zu %zu %d %d %d\n", (size_t)PARCEL_API_MIN_SIZE, sizeof(struct ParcelApi),
         parcel_api_compatible(&old), parcel_api_compatible(&short_table),
         parcel_api_compatible(&other_abi));
  return 0;
}
"#;
  let Some(output) = run_c("real-header", header, main) else {
    return;
  };

  // Until the first alpha is released the first layout is the whole table, so
  // FIRST_LAYOUT_END must move with every function added. From the alpha on,
  // the table grows past it, and this compares against the alpha's last function.
  let min_size = size_of::<crate::ParcelApi>();
  assert_eq!(
    output.trim(),
    format!("{min_size} {} 1 0 0", size_of::<crate::ParcelApi>())
  );
}

const SYNTHETIC_HEADER: &str = r#"#ifndef TEST_PLUGIN_H
#define TEST_PLUGIN_H

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#define PARCEL_ABI_VERSION 1

typedef uint64_t Asset;

typedef struct Buffer {
  uint8_t *data;
  uintptr_t len;
  uintptr_t cap;
  bool is_utf8;
} Buffer;

typedef struct ParcelApiHeader {
  uintptr_t size;
  uint32_t abi;
  uint32_t _reserved;
} ParcelApiHeader;

typedef struct ParcelApi {
  struct ParcelApiHeader header;
  void (*asset_get_content)(struct Buffer *buf, Asset asset);
  void (*asset_get_map)(struct Buffer *buf, Asset asset);
  uintptr_t (*asset_appended_count)(Asset asset);
  struct Buffer (*asset_appended_buffer)(Asset asset);
  void (*asset_appended_void)(Asset asset, uintptr_t *out);
} ParcelApi;

typedef void (*ParcelPluginTransformFn)(Asset asset,
                                        uintptr_t *out);

#endif
"#;

/// Functions appended after the first layout are called only when the table
/// reaches them, and otherwise do nothing and return zero.
#[test]
fn appended_functions_are_checked_against_the_table_size() {
  let header = shims::add_api_shims_ending_at(SYNTHETIC_HEADER, "asset_get_map");
  let main = r#"
#include <stdio.h>
#include "plugin.h"

const struct ParcelApi *parcel_api;

static void get_content(struct Buffer *buf, Asset asset) { buf->len = 1; }
static void get_map(struct Buffer *buf, Asset asset) { buf->len = 2; }
static uintptr_t appended_count(Asset asset) { return 42; }
static struct Buffer appended_buffer(Asset asset) {
  struct Buffer buf = {0};
  buf.len = 7;
  return buf;
}
static void appended_void(Asset asset, uintptr_t *out) { *out = 9; }

/* Every function is in memory, so calling one the size excludes would show up
   in the output rather than crash. */
static void run(const char *label, uintptr_t size) {
  struct ParcelApi table = {{size, PARCEL_ABI_VERSION, 0}, get_content, get_map,
                            appended_count, appended_buffer, appended_void};
  parcel_api = &table;

  struct Buffer map = {0};
  parcel_asset_get_map(&map, 0);
  uintptr_t out = 0;
  parcel_asset_appended_void(0, &out);
  printf("%s compatible=%d map=%zu has_count=%d has_void=%d count=%zu buffer=%zu void=%zu\n",
         label, parcel_api_compatible(&table.header), (size_t)map.len,
         parcel_api_has_asset_appended_count(), parcel_api_has_asset_appended_void(),
         (size_t)parcel_asset_appended_count(0), (size_t)parcel_asset_appended_buffer(0).len,
         (size_t)out);
}

int main(void) {
  run("old", PARCEL_API_MIN_SIZE);
  run("partial", offsetof(struct ParcelApi, asset_appended_buffer));
  run("new", sizeof(struct ParcelApi));
  return 0;
}
"#;
  let Some(output) = run_c("appended", &header, main) else {
    return;
  };

  assert_eq!(
    output.lines().collect::<Vec<_>>(),
    [
      "old compatible=1 map=2 has_count=0 has_void=0 count=0 buffer=0 void=0",
      "partial compatible=1 map=2 has_count=1 has_void=0 count=42 buffer=0 void=0",
      "new compatible=1 map=2 has_count=1 has_void=1 count=42 buffer=7 void=9",
    ]
  );
}

/// First-layout functions keep their plain wrappers, with no check to pay for.
#[test]
fn first_layout_functions_are_called_unchecked() {
  let header = shims::add_api_shims_ending_at(SYNTHETIC_HEADER, "asset_get_map");
  assert!(header.contains(
    "static inline void parcel_asset_get_map(struct Buffer *buf, Asset asset) {\n  \
     parcel_api->asset_get_map(buf, asset);\n}"
  ));
  assert!(!header.contains("parcel_api_has_asset_get_map"));
  assert!(header.contains("parcel_api_has_asset_appended_count"));
}

/// Each `ParcelPlugin*Fn` typedef becomes a prototype for the function the
/// plugin defines.
#[test]
fn entry_point_typedefs_become_prototypes() {
  let header = shims::add_api_shims_ending_at(SYNTHETIC_HEADER, "asset_get_map");
  assert!(header.contains(
    "#ifndef PARCEL_NO_ENTRY_POINT_PROTOTYPES\n\nvoid parcel_plugin_transform(Asset asset, uintptr_t *out);\n"
  ));
}
