//! Build a small extension against the exact engine used by rquickjs-sys.
//! Only private type definitions are extracted; the upstream engine and Rust
//! bindings are built normally by the unmodified registry dependency.
//!
//! Updating rquickjs uses the normal Cargo manifest and lockfile. New private
//! fields or dependencies may require updating the extraction below. The C
//! extension checks its global-object offset against the linked engine before
//! writing it; run the VM and GC tests after an engine upgrade.

use std::{
  env, fs,
  path::{Path, PathBuf},
  process::Command,
};

pub fn build() {
  let upstream = quickjs_source();
  let source_path = upstream.join("quickjs.c");
  let source = fs::read_to_string(&source_path).expect("Unable to read QuickJS source");
  let out_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());

  // Keep the public value ABI and list layout in their original headers. The
  // engine's opaque shape pointers only need a forward declaration.
  let gc_header = definition(&source, "struct JSGCObjectHeader {", "\n};");
  let context = definition(&source, "struct JSContext {", "\n};");
  let error_enum = definition(&source, "typedef enum JSErrorEnum {", "} JSErrorEnum;");
  // Preserve upstream's license notice in the generated header.
  let license = definition(&source, "/*", "*/");
  fs::write(
    out_dir.join("parcel-quickjs-context.h"),
    format!(
      "// Generated from Cargo's resolved rquickjs-sys; do not edit.\n\
       {license}\n\
       #include \"quickjs.h\"\n\
       #include \"list.h\"\n\
       typedef struct JSShape JSShape;\n\
       {error_enum}\n{gc_header}\n{context}\n"
    ),
  )
  .expect("Unable to write QuickJS context header");

  for path in [
    source_path,
    upstream.join("quickjs.h"),
    upstream.join("list.h"),
  ] {
    println!("cargo:rerun-if-changed={}", path.display());
  }

  let mut build = cc::Build::new();
  build
    .file("parcel-quickjs.c")
    .include(&out_dir)
    .include(&upstream);

  // Match rquickjs-sys's configuration for the public value ABI on WASM and
  // use its bundled libc headers for wasm32-unknown-unknown.
  let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
  if target_os == "wasi" || env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
    build.define("EMSCRIPTEN", "1");
    if target_os == "unknown" {
      build.include(upstream.parent().unwrap().join("vendor/wasi-libc/include"));
    }
  }
  if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
    build.flag("/std:c11");
  }
  build.compile("parcel_quickjs");
}

fn definition<'a>(source: &'a str, start: &str, end: &str) -> &'a str {
  let (_, definition) = source.split_once(start).unwrap_or_else(|| {
    panic!("QuickJS no longer contains {start:?}; update the context header extraction")
  });
  let offset = source.len() - definition.len() - start.len();
  let length = definition
    .find(end)
    .unwrap_or_else(|| panic!("Unable to locate the end of QuickJS's {start:?} definition"));
  &source[offset..offset + start.len() + length + end.len()]
}

fn quickjs_source() -> PathBuf {
  let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("Cargo.toml");
  // Use the workspace's existing resolution. Never change its lockfile or
  // access the network from this nested invocation.
  let output = Command::new(env::var_os("CARGO").unwrap())
    .args([
      "metadata",
      "--format-version=1",
      "--locked",
      "--filter-platform",
    ])
    .arg(env::var_os("TARGET").unwrap())
    .arg("--manifest-path")
    .arg(&manifest)
    .output()
    .expect("Unable to locate the rquickjs-sys dependency with cargo metadata");
  assert!(
    output.status.success(),
    "Unable to resolve QuickJS's source path:\n{}",
    String::from_utf8_lossy(&output.stderr),
  );
  let metadata: serde_json::Value =
    serde_json::from_slice(&output.stdout).expect("Invalid cargo metadata");
  let packages = metadata["packages"].as_array().unwrap();
  let package = packages
    .iter()
    .find(|package| package["manifest_path"].as_str() == manifest.to_str())
    .expect("parcel-plugin-js missing from cargo metadata");
  let node = metadata["resolve"]["nodes"]
    .as_array()
    .unwrap()
    .iter()
    .find(|node| node["id"] == package["id"])
    .unwrap();
  // Follow this package's dependency edge, not the first package with a matching
  // name: a workspace may contain multiple versions of rquickjs-sys.
  let dependency = node["deps"]
    .as_array()
    .unwrap()
    .iter()
    .find(|dependency| dependency["name"] == "rquickjs_sys")
    .expect("parcel-plugin-js must depend directly on rquickjs-sys");
  let sys = packages
    .iter()
    .find(|package| package["id"] == dependency["pkg"])
    .unwrap();
  println!(
    "cargo:rerun-if-changed={}",
    Path::new(metadata["workspace_root"].as_str().unwrap())
      .join("Cargo.lock")
      .display()
  );
  Path::new(sys["manifest_path"].as_str().unwrap())
    .parent()
    .unwrap()
    .join("quickjs")
}
