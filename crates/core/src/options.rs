use std::{borrow::Cow, collections::HashMap, sync::Arc};

use serde::Deserialize;

use crate::{Diagnostic, OsFileSystem, PathId, Reporters, TargetSourceMapOptions, fs::FileSystem};

#[derive(Clone)]
pub struct BuildOptions {
  pub mode: BuildMode,
  pub optimize: Option<bool>,
  pub source_map: Option<TargetSourceMapOptions>,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub input_fs: Arc<dyn FileSystem>,
  pub output_fs: Arc<dyn FileSystem>,
  pub config: Option<String>,
  pub cwd: PathId,
  pub dist_dir: Option<PathId>,
  pub public_url: String,
  pub hmr: Option<HmrOptions>,
}

pub struct ParcelOptions {
  pub mode: BuildMode,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub project_root: PathId,
  pub input_fs: Arc<dyn FileSystem>,
  pub output_fs: Arc<dyn FileSystem>,
  pub cwd: PathId,
  pub hmr: Option<HmrOptions>,
  pub reporters: Arc<Reporters>,
}

impl Default for ParcelOptions {
  fn default() -> Self {
    ParcelOptions {
      mode: Default::default(),
      env: Default::default(),
      log_level: Default::default(),
      project_root: PathId::root(),
      input_fs: Arc::new(OsFileSystem {}),
      output_fs: Arc::new(OsFileSystem {}),
      cwd: PathId::new(&std::env::current_dir().unwrap()),
      hmr: None,
      reporters: Reporters::none(),
    }
  }
}

#[derive(Clone)]
pub struct HmrOptions {
  pub host: Cow<'static, str>,
  pub port: u16,
}

#[derive(Clone, PartialEq, Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildMode {
  #[default]
  Development,
  Production,
  #[serde(untagged)]
  Other(String),
}

#[derive(Clone, Copy, PartialEq, Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
  None,
  Error,
  Warn,
  #[default]
  Info,
  Verbose,
}

impl LogLevel {
  pub fn as_str(&self) -> &'static str {
    match self {
      LogLevel::None => "none",
      LogLevel::Error => "error",
      LogLevel::Warn => "warn",
      LogLevel::Info => "info",
      LogLevel::Verbose => "verbose",
    }
  }

  /// Whether an event at `severity` should reach reporters at this threshold.
  ///
  /// Filtering happens once, before an event is queued, so every reporter sees
  /// the same stream and a filtered-out log costs nothing to emit.
  pub fn allows(&self, severity: LogLevel) -> bool {
    let threshold = *self as u8;
    let severity = severity as u8;
    threshold >= severity
  }
}

impl std::fmt::Display for LogLevel {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(self.as_str())
  }
}

impl ParcelOptions {
  /// Logs a message to the configured reporters. Discarded when the build has no
  /// reporters, or when `level` is below the build's log level.
  pub fn log(&self, level: LogLevel, message: impl AsRef<str>) {
    self.reporters.log(level, message.as_ref());
  }

  /// Logs a diagnostic without failing the build.
  pub fn log_diagnostic(&self, level: LogLevel, diagnostic: Diagnostic) {
    self.reporters.log_diagnostics(level, &[diagnostic]);
  }

  pub fn log_diagnostics(&self, level: LogLevel, diagnostics: &[Diagnostic]) {
    self.reporters.log_diagnostics(level, diagnostics);
  }
}
