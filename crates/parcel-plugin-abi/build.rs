use bindgen::callbacks::ParseCallbacks;

#[path = "build/shims.rs"]
mod shims;

use shims::add_api_shims;

fn main() {
  let crate_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();

  // The triple this build targets, used to pick the artifact package of a native
  // plugin. Cargo only exposes it to build scripts, and unlike std::env::consts it
  // distinguishes gnu from musl.
  println!(
    "cargo:rustc-env=PARCEL_TARGET={}",
    std::env::var("TARGET").unwrap()
  );

  // Only re-run when inputs that affect the generated output change.
  println!("cargo:rerun-if-changed=build.rs");
  println!("cargo:rerun-if-changed=build");
  println!("cargo:rerun-if-changed=src");
  println!("cargo:rerun-if-changed=cbindgen.toml");

  let output_path = format!("{}/plugin.h", crate_dir);

  let config =
    cbindgen::Config::from_file(format!("{}/cbindgen.toml", crate_dir)).unwrap_or_default();

  let mut buf: Vec<u8> = Vec::new();
  cbindgen::Builder::new()
    .with_crate(&crate_dir)
    .with_config(config)
    .generate()
    .expect("Unable to generate C bindings")
    .write(&mut buf);
  let content = String::from_utf8(buf).expect("cbindgen output is not valid UTF-8");
  let content = add_api_shims(&content);

  write_if_changed(&output_path, &content);

  // Keep the Go SDK copy in sync automatically.
  let plugin_go_header = format!("{}/../../plugin-go/plugin.h", crate_dir);
  write_if_changed(&plugin_go_header, &content);

  // And the Swift SDK's C target.
  let plugin_swift_header = format!(
    "{}/../../plugin-swift/Sources/CParcelABI/include/plugin.h",
    crate_dir
  );
  write_if_changed(&plugin_swift_header, &content);

  // Generate the Rust FFI bindings for parcel-plugin and commit them as
  // src/ffi.rs so that crate can be published to crates.io without
  // requiring users to have libclang installed.
  generate_rust_ffi(&crate_dir, &content);
}

/// Write `content` to `path` only when the file's current content differs.
/// Skipping identical writes avoids bumping the file's mtime, which would
/// otherwise trigger a recompile of every crate that depends on the file.
fn write_if_changed(path: &str, content: &str) {
  if let Ok(existing) = std::fs::read_to_string(path) {
    if existing == content {
      return;
    }
  }
  let _ = std::fs::write(path, content);
}

fn generate_rust_ffi(crate_dir: &str, header: &str) {
  #[derive(Debug)]
  struct CustomCallbacks;

  impl ParseCallbacks for CustomCallbacks {
    fn enum_variant_name(
      &self,
      _enum_name: Option<&str>,
      original_variant_name: &str,
      _variant_value: bindgen::callbacks::EnumVariantValue,
    ) -> Option<String> {
      if let Some(name) = [
        "PARCEL_DEP_",
        "PARCEL_ENV_FLAG_",
        "PARCEL_ASSET_",
        "PARCEL_BUNDLE_FLAG_",
        "PARCEL_EXPORTS_CONDITION_",
        "PARCEL_FILE_KIND_",
      ]
      .iter()
      .find_map(|prefix| original_variant_name.strip_prefix(prefix))
      {
        return Some(name.to_string());
      }

      let name = [
        "PARCEL_INIT_",
        "PARCEL_SPECIFIER_",
        "PARCEL_PRIORITY_",
        "PARCEL_IMPORT_TYPE_",
        "PARCEL_BUNDLE_BEHAVIOR_",
        "PARCEL_ENV_",
        "PARCEL_OUTPUT_FORMAT_",
        "PARCEL_SOURCE_TYPE_",
        "PARCEL_SEVERITY_",
        "PARCEL_RESOLUTION_",
        "PARCEL_BUNDLE_GRAPH_RESOLUTION_",
        "PARCEL_EVENT_",
        "PARCEL_LOG_",
        "PARCEL_IO_",
      ]
      .iter()
      .find_map(|prefix| original_variant_name.strip_prefix(prefix));

      if let Some(name) = name {
        return Some(
          name
            .split('_')
            .filter(|word| !word.is_empty())
            .map(|word| {
              let mut chars = word.chars();
              match chars.next() {
                None => String::new(),
                Some(first) => {
                  first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
                }
              }
            })
            .collect(),
        );
      }

      None
    }
  }

  let generated = bindgen::Builder::default()
    // Feed the already-patched header directly so we don't re-read from disk.
    .header_contents("plugin.h", header)
    .clang_arg("-std=c2x")
    .allowlist_function("parcel_.*")
    .allowlist_var("PARCEL_.*")
    .allowlist_type(
      "ParcelApi|InitStatus|SpecifierType|Priority|ImportType|BundleBehavior|Environment|OutputFormat|SourceType|Diagnostic|DiagnosticSeverity|Diagnostics|ResolveResult|OptimizeResult|ReportEvent|ReportEventType|LogLevel|ResolutionType|DependencyFlags|ExportsConditions|AssetFlags|EnvironmentFlags|BundleFlags|BundleGraphResolutionType|BundleGraphDependencyResolution|AssetIndex|BundleIndex|IoStatus|FileKind",
    )
    // Newtypes rather than Rust enums: Parcel can be newer than the plugin, and
    // hand it a value the plugin has never heard of, which would be undefined
    // behavior to read as a Rust enum. Each variant is an associated constant.
    .newtype_enum("InitStatus")
    .newtype_enum("SpecifierType")
    .newtype_enum("Priority")
    .newtype_enum("ImportType")
    .newtype_enum("BundleBehavior")
    .newtype_enum("Environment")
    .newtype_enum("OutputFormat")
    .newtype_enum("SourceType")
    .newtype_enum("DiagnosticSeverity")
    .newtype_enum("ResolutionType")
    .newtype_enum("BundleGraphResolutionType")
    .newtype_enum("ReportEventType")
    .newtype_enum("LogLevel")
    .newtype_enum("IoStatus")
    .bitfield_enum("DependencyFlags")
    .bitfield_enum("ExportsConditions")
    .bitfield_enum("AssetFlags")
    .bitfield_enum("EnvironmentFlags")
    .bitfield_enum("BundleFlags")
    .bitfield_enum("FileKind")
    .translate_enum_integer_types(true)
    .no_copy("Buffer")
    .parse_callbacks(Box::new(CustomCallbacks))
    .generate()
    .expect("Unable to generate Rust FFI bindings")
    .to_string();

  // Rust 2024 edition requires `unsafe extern "C"` blocks; bindgen 0.70
  // doesn't emit the keyword yet, so patch it here.
  let generated = generated
    .replace("extern \"C\"", "unsafe extern \"C\"")
    .replace("unsafe unsafe ", "unsafe ");

  // bindgen skips `PARCEL_API_MIN_SIZE`, which is not a literal, so define it
  // from the same field.
  let generated = format!(
    "{generated}\n/// The end of the last function in [`ParcelApi`]'s first published layout, and so\n\
     /// the smallest table any Parcel implementing this ABI passes. Functions after\n\
     /// `{end}` were appended later, and an older Parcel's table ends before them.\n\
     pub const PARCEL_API_MIN_SIZE: usize =\n    \
     ::core::mem::offset_of!(ParcelApi, {end}) + ::core::mem::size_of::<usize>();\n",
    end = shims::FIRST_LAYOUT_END,
  );

  let ffi_rs = format!("{}/../parcel-plugin/src/ffi.rs", crate_dir);
  write_if_changed(&ffi_rs, &generated);
}
