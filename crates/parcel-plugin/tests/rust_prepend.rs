mod common;

use std::{
  fs,
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
};

use parcel_core::{
  AssetType, BuildMode, BuildOptions, DiagnosticList, FileSystem, LogEvent, LogLevel, LogMessage,
  OsFileSystem, OverlayFileSystem, ParcelOptions, PathId, Reporter, ReporterEvent,
};

#[cfg(target_os = "macos")]
const LIB_EXT: &str = "dylib";
#[cfg(target_os = "linux")]
const LIB_EXT: &str = "so";
#[cfg(target_os = "windows")]
const LIB_EXT: &str = "dll";

const LIB_PREFIX: &str = std::env::consts::DLL_PREFIX;

/// Compiles the Rust prepend-transformer example into a cdylib and returns its
/// path. Uses an isolated `--target-dir` so this subprocess does not contend on
/// the Cargo lock held by the parent test runner.
fn build_rust_plugin() -> PathBuf {
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let plugin_manifest =
    manifest_dir.join("../../plugin-rs/examples/prepend-transformer/Cargo.toml");
  let target_dir = std::env::temp_dir()
    .join("parcel-rust-prepend-test")
    .join("target");

  let result = std::process::Command::new(&cargo)
    .args([
      "build",
      "--manifest-path",
      plugin_manifest.to_str().unwrap(),
      "--target-dir",
      target_dir.to_str().unwrap(),
    ])
    .output()
    .expect("spawn cargo build");

  assert!(
    result.status.success(),
    "cargo build failed:\nstdout: {}\nstderr: {}",
    String::from_utf8_lossy(&result.stdout),
    String::from_utf8_lossy(&result.stderr),
  );

  target_dir
    .join("debug")
    .join(format!("{LIB_PREFIX}prepend_transformer_rs.{}", LIB_EXT))
}

#[test]
fn rust_transformer_reads_the_input_source_map() {
  common::assert_prepend_keeps_input_map("rust", &build_rust_plugin());
}

/// Records the text of every log message.
#[derive(Default)]
struct LogRecorder(Mutex<Vec<String>>);

impl Reporter for LogRecorder {
  fn report(&self, event: &ReporterEvent, _options: &ParcelOptions) -> Result<(), DiagnosticList> {
    if let ReporterEvent::Log(LogEvent {
      message: LogMessage::Text(message),
      ..
    }) = event
    {
      self.0.lock().unwrap().push((*message).to_owned());
    }
    Ok(())
  }
}

/// A plugin initializing can read files relative to the .parcelrc that
/// configured it, through Parcel, so that editing one rebuilds with its new
/// contents. What it logs meanwhile reaches the reporters, which do not exist
/// yet when it initializes.
#[test]
fn rust_plugin_reads_files_relative_to_its_parcelrc_while_initializing() {
  let library = build_rust_plugin();
  let dir = std::env::temp_dir().join("parcel-rust-init-read-test");
  let _ = fs::remove_dir_all(&dir);
  // Not at the project root, so that resolving against the root would miss it.
  let config_dir = dir.join("config");
  fs::create_dir_all(&config_dir).expect("create project directory");
  let banner = config_dir.join("banner.txt");
  for (file, contents) in [
    (dir.join("package.json"), "{}"),
    (dir.join("yarn.lock"), ""),
    (dir.join("index.js"), "globalThis.output = 1;\n"),
    (banner.clone(), "globalThis.banner = 'first';\n"),
  ] {
    fs::write(file, contents).expect("write project file");
  }
  let parcelrc = config_dir.join(".parcelrc");
  fs::write(
    &parcelrc,
    format!(
      r#"{{"extends":"@parcel/config-default","transformers":{{"*.js":[{{"plugin":{:?},"config":{{"file":"./banner.txt"}}}},"..."]}}}}"#,
      library.to_str().unwrap()
    ),
  )
  .expect("write parcelrc");

  let logs = Arc::new(LogRecorder::default());
  let output_fs = Arc::new(OverlayFileSystem::new());
  let mut parcel = parcel::make_parcel(
    &vec!["index.js".into()],
    BuildOptions {
      cwd: PathId::new(&dir),
      config: Some(parcelrc.to_str().unwrap().to_owned()),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs: output_fs.clone(),
      mode: BuildMode::Development,
      optimize: None,
      content_hash: None,
      env: Default::default(),
      log_level: LogLevel::Verbose,
      source_map: None,
      dist_dir: None,
      public_url: Default::default(),
      hmr: None,
      reporters: vec![logs.clone()],
    },
  )
  .unwrap_or_else(|e| panic!("parcel failed to start: {e:?}"));

  let build = |parcel: &mut parcel_core::Parcel| -> String {
    let bundle_graph = parcel
      .build()
      .unwrap_or_else(|e| panic!("parcel build failed: {e:?}"));
    let bundle = bundle_graph
      .bundles
      .iter()
      .find(|b| b.ty == AssetType::Js)
      .expect("no JS bundle in output");
    output_fs
      .read_to_string(bundle.dist_path())
      .expect("read bundle")
  };

  let code = build(&mut parcel);
  assert!(code.contains("globalThis.banner = 'first'"), "{code}");
  let read = format!("prepend-transformer: read {}", banner.display());
  assert!(
    logs.0.lock().unwrap().contains(&read),
    "expected {read:?} in {:?}",
    logs.0.lock().unwrap()
  );

  fs::write(&banner, "globalThis.banner = 'second';\n").expect("edit banner");
  let result = parcel
    .invalidate(&[PathId::new(&banner)], &[], &[])
    .unwrap_or_else(|e| panic!("invalidate failed: {e:?}"));
  assert!(
    result.config_changed,
    "editing the banner should reload the config"
  );

  let code = build(&mut parcel);
  assert!(code.contains("globalThis.banner = 'second'"), "{code}");
}
