use bindgen::callbacks::ParseCallbacks;

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

  // Generate the Rust FFI bindings for parcel-plugin and commit them as
  // src/ffi.rs so that crate can be published to crates.io without
  // requiring users to have libclang installed.
  generate_rust_ffi(&crate_dir, &content);
}

/// Appends a `static inline` wrapper for every `ParcelApi` field, so C and Go
/// plugins call `parcel_asset_get_content(...)` exactly as they did when the host
/// exported it as a linkable symbol. The plugin defines `parcel_api` once and
/// points it at the table Parcel passes to `parcel_plugin_init`.
fn add_api_shims(header: &str) -> String {
  let body = {
    let start = header
      .find("typedef struct ParcelApi {")
      .expect("ParcelApi missing from generated header");
    let start = header[start..].find('{').unwrap() + start + 1;
    let end = header[start..]
      .find("} ParcelApi;")
      .expect("unterminated ParcelApi")
      + start;
    &header[start..end]
  };

  let mut shims = String::from(
    "\n/**\n * The host functions Parcel passed to `parcel_plugin_init()`. Plugins define this\n\
     \x20* once and assign it before calling anything below.\n */\nextern const struct ParcelApi *parcel_api;\n\n\
     /**\n * Whether `api` is usable by a plugin built against this header. Check it in\n\
     \x20* `parcel_plugin_init()` before anything else.\n\
     \x20*\n\
     \x20* Two things have to hold. The ABI version must match: appending never changes\n\
     \x20* the size of an existing field, so a changed signature is invisible to the size\n\
     \x20* check. And the table must be at least as large as the one declared here, so\n\
     \x20* every function the plugin can reach has been filled in.\n */\n\
     static inline bool parcel_api_compatible(const struct ParcelApiHeader *api) {\n\
     \x20 return api && api->abi == PARCEL_ABI_VERSION &&\n\
     \x20        api->size >= sizeof(struct ParcelApi);\n}\n",
  );

  for field in split_top_level(body, ';') {
    // Skip doc comments and the leading scalar members.
    let Some(open) = field.find("(*") else {
      continue;
    };
    let close = field[open..].find(')').expect("malformed field") + open;
    let name = field[open + 2..close].trim();
    let ret = field[..open].rsplit("*/").next().unwrap_or("").trim();
    let args_open = field[close..].find('(').expect("field has no arg list") + close;
    let args_close = field.rfind(')').expect("field has no arg list");
    let args = &field[args_open + 1..args_close];

    let args_split = split_top_level(args, ',');
    let names: Vec<&str> = args_split.iter().map(|arg| arg_name(arg)).collect();

    let call = format!("parcel_api->{}({})", name, names.join(", "));
    let call = if ret == "void" {
      format!("  {call};")
    } else {
      format!("  return {call};")
    };
    shims.push_str(&format!(
      "\nstatic inline {ret} parcel_{name}({}) {{\n{call}\n}}\n",
      normalize_ws(args)
    ));
  }

  let end = header
    .rfind("#endif")
    .expect("header has no include guard end");
  format!("{}{}\n{}", &header[..end], shims, &header[end..])
}

/// Splits on `sep`, ignoring separators nested inside parentheses or brackets.
fn split_top_level(text: &str, sep: char) -> Vec<String> {
  let mut parts = Vec::new();
  let mut depth = 0;
  let mut current = String::new();
  for c in text.chars() {
    match c {
      '(' | '[' => depth += 1,
      ')' | ']' => depth -= 1,
      _ if c == sep && depth == 0 => {
        parts.push(std::mem::take(&mut current));
        continue;
      }
      _ => {}
    }
    current.push(c);
  }
  if !current.trim().is_empty() {
    parts.push(current);
  }
  parts.into_iter().filter(|p| !p.trim().is_empty()).collect()
}

/// The parameter name of a C declaration: the identifier inside `(*name)` for
/// function pointers and arrays, otherwise the trailing identifier.
fn arg_name(arg: &str) -> &str {
  if let Some(open) = arg.find("(*") {
    let rest = &arg[open + 2..];
    let end = rest
      .find(|c: char| !c.is_alphanumeric() && c != '_')
      .unwrap_or(rest.len());
    return &rest[..end];
  }
  arg
    .trim()
    .rsplit(|c: char| !c.is_alphanumeric() && c != '_')
    .next()
    .unwrap()
}

fn normalize_ws(text: &str) -> String {
  text.split_whitespace().collect::<Vec<_>>().join(" ")
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
        "PARCEL_INIT_",
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
      "ParcelApi|InitStatus|SpecifierType|Priority|BundleBehavior|Environment|OutputFormat|SourceType|Diagnostic|DiagnosticSeverity|ResolveResult|OptimizeResult|ResolutionType|DependencyFlags|ExportsConditions|AssetFlags|EnvironmentFlags|BundleFlags|BundleGraphResolutionType|BundleGraphDependencyResolution|AssetIndex|BundleIndex",
    )
    .rustified_enum("InitStatus")
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
