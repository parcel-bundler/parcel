use bindgen::callbacks::ParseCallbacks;

fn main() {
  let crate_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();

  // Only re-run when inputs that affect the generated output change.
  println!("cargo:rerun-if-changed=build.rs");
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

  write_if_changed(&output_path, &content);

  // Keep the Go SDK copy in sync automatically.
  let plugin_go_header = format!("{}/../../plugin-go/plugin.h", crate_dir);
  write_if_changed(&plugin_go_header, &content);

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
      ]
      .iter()
      .find_map(|prefix| original_variant_name.strip_prefix(prefix))
      {
        return Some(name.to_string());
      }

      let name = [
        "PARCEL_SPECIFIER_",
        "PARCEL_PRIORITY_",
        "PARCEL_BUNDLE_BEHAVIOR_",
        "PARCEL_ENV_",
        "PARCEL_OUTPUT_FORMAT_",
        "PARCEL_SOURCE_TYPE_",
        "PARCEL_SEVERITY_",
        "PARCEL_RESOLUTION_",
        "PARCEL_BUNDLE_GRAPH_RESOLUTION_",
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
      "SpecifierType|Priority|BundleBehavior|Environment|OutputFormat|SourceType|Diagnostic|DiagnosticSeverity|ResolveResult|OptimizeResult|ResolutionType|DependencyFlags|ExportsConditions|AssetFlags|EnvironmentFlags|BundleFlags|BundleGraphResolutionType|BundleGraphDependencyResolution|AssetIndex|BundleIndex",
    )
    .rustified_enum("SpecifierType")
    .rustified_enum("Priority")
    .rustified_enum("BundleBehavior")
    .rustified_enum("Environment")
    .rustified_enum("OutputFormat")
    .rustified_enum("SourceType")
    .rustified_enum("DiagnosticSeverity")
    .rustified_enum("ResolutionType")
    .rustified_enum("BundleGraphResolutionType")
    .bitfield_enum("DependencyFlags")
    .bitfield_enum("ExportsConditions")
    .bitfield_enum("AssetFlags")
    .bitfield_enum("EnvironmentFlags")
    .bitfield_enum("BundleFlags")
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

  let ffi_rs = format!("{}/../parcel-plugin/src/ffi.rs", crate_dir);
  write_if_changed(&ffi_rs, &generated);
}
