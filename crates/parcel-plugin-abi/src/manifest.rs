//! npm metadata contracts for native Parcel plugins.
//!
//! A native plugin is published as a package containing only metadata, plus one
//! package per platform containing a shared library. The plugin package lists the
//! artifact package to install for each Rust target under `parcel.artifacts`, and
//! depends on all of them as `optionalDependencies` so npm installs only the one
//! matching the host. Each artifact package names its library under
//! `parcel.library`.
//!
//! ```json
//! {
//!   "name": "@devongovett/parcel-transformer-ts-doc",
//!   "parcel": {
//!     "abi": 1,
//!     "artifacts": {
//!       "aarch64-apple-darwin": "@devongovett/parcel-transformer-ts-doc-darwin-arm64"
//!     }
//!   }
//! }
//! ```
//!
//! An artifact may also be a relative path to a library inside the plugin package
//! itself, for a plugin small enough that shipping every platform in one package
//! beats installing one of several:
//!
//! ```json
//! {"parcel": {"abi": 1, "artifacts": {"aarch64-apple-darwin": "./plugin-darwin-arm64.dylib"}}}
//! ```
//!
//! Unknown keys are ignored throughout. The `parcel` key is shared with unrelated
//! configuration, and a plugin published for a newer Parcel must stay readable
//! enough to report a useful ABI error rather than a parse failure.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The Rust target triple this build of Parcel was compiled for, e.g.
/// `aarch64-apple-darwin`. Used to select an artifact package from a plugin's
/// `parcel.artifacts` map.
///
/// Taken from cargo's `TARGET` by the build script, which is exact by
/// construction — unlike [`std::env::consts`], it distinguishes gnu from musl.
pub const TARGET: &str = env!("PARCEL_TARGET");

/// Extension of a shared library on the platform Parcel is running on.
pub const LIBRARY_EXTENSION: &str = if cfg!(target_os = "macos") {
  "dylib"
} else if cfg!(target_os = "windows") {
  "dll"
} else {
  "so"
};

/// The `parcel` key of a plugin's package.json.
///
/// One type covers both kinds of package: `artifacts` identifies the public
/// package of a native plugin, and `library` an artifact package.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PluginManifest {
  /// The plugin ABI the shared libraries were built against.
  pub abi: Option<u32>,
  /// Artifact package name per Rust target triple. Empty for JavaScript plugins.
  pub artifacts: BTreeMap<String, String>,
  /// Path to the shared library, relative to the package root.
  pub library: Option<String>,
  /// Path to a locally built library, relative to the package root, used in place
  /// of `artifacts` while developing the plugin.
  ///
  /// Publishing strips this, so a package that still has it is by definition a
  /// working tree rather than something a consumer installed. That is what makes
  /// it safe for it to win over `artifacts` outright, instead of being a fallback
  /// for when they cannot be resolved — a fallback would turn a genuinely missing
  /// artifact package into a confusing second failure.
  pub dev_library: Option<String>,
}

/// The package.json fields consulted when loading a plugin.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PluginPackage {
  pub name: Option<String>,
  pub version: Option<String>,
  pub parcel: PluginManifest,
}

impl PluginPackage {
  pub fn parse(contents: &str) -> serde_json::Result<PluginPackage> {
    serde_json::from_str(contents)
  }

  /// Whether this package is the public package of a native plugin, as opposed to
  /// a JavaScript plugin or an artifact package.
  pub fn is_native_plugin(&self) -> bool {
    !self.parcel.artifacts.is_empty()
  }

  /// The artifact package to load on the platform Parcel is running on.
  pub fn artifact(&self) -> Option<&str> {
    self.parcel.artifacts.get(TARGET).map(|name| name.as_str())
  }

  /// The locally built library to load instead of an artifact package, with this
  /// platform's extension applied.
  ///
  /// The extension is appended rather than written by the author, so one entry
  /// works for everyone on the team: `cargo build` produces `libplugin.dylib`,
  /// `.so`, or `.dll` depending on who runs it. An extension that is already
  /// there is left alone.
  pub fn dev_library(&self) -> Option<String> {
    let library = self.parcel.dev_library.as_deref()?;
    let has_extension = ["so", "dylib", "dll"]
      .iter()
      .any(|ext| library.to_ascii_lowercase().ends_with(&format!(".{ext}")));

    Some(if has_extension {
      library.to_owned()
    } else {
      format!("{library}.{LIBRARY_EXTENSION}")
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const PLUGIN: &str = r#"{
    "name": "@acme/plugin",
    "version": "1.0.0",
    "description": "ignored",
    "parcel": {
      "abi": 1,
      "artifacts": {
        "aarch64-apple-darwin": "@acme/plugin-darwin-arm64",
        "x86_64-unknown-linux-gnu": "@acme/plugin-linux-x64-gnu"
      }
    }
  }"#;

  #[test]
  fn reads_a_native_plugin_package() {
    let package = PluginPackage::parse(PLUGIN).unwrap();
    assert_eq!(package.name.as_deref(), Some("@acme/plugin"));
    assert_eq!(package.parcel.abi, Some(crate::PARCEL_ABI_VERSION));
    assert!(package.is_native_plugin());
    assert_eq!(
      package.parcel.artifacts.get("aarch64-apple-darwin"),
      Some(&"@acme/plugin-darwin-arm64".to_string())
    );
  }

  #[test]
  fn reads_an_artifact_package() {
    let package = PluginPackage::parse(
      r#"{"name":"@acme/plugin-darwin-arm64","parcel":{"abi":1,"library":"plugin.dylib"}}"#,
    )
    .unwrap();
    assert_eq!(package.parcel.library.as_deref(), Some("plugin.dylib"));
    assert!(!package.is_native_plugin());
  }

  #[test]
  fn javascript_plugins_are_not_native() {
    // No parcel key at all, and a parcel key holding unrelated configuration.
    for contents in [
      r#"{"name":"@acme/js-plugin","main":"index.js"}"#,
      r#"{"name":"@acme/js-plugin","parcel":{"somethingElse":true}}"#,
    ] {
      let package = PluginPackage::parse(contents).unwrap();
      assert!(!package.is_native_plugin());
      assert_eq!(package.parcel.abi, None);
    }
  }

  #[test]
  fn artifact_is_selected_by_target() {
    let mut package = PluginPackage::default();
    package.parcel.artifacts.insert(
      "some-unsupported-triple".to_string(),
      "@acme/nope".to_string(),
    );
    assert_eq!(package.artifact(), None);

    package
      .parcel
      .artifacts
      .insert(TARGET.to_string(), "@acme/plugin-host".to_string());
    assert_eq!(package.artifact(), Some("@acme/plugin-host"));
  }

  #[test]
  fn target_is_the_triple_cargo_built_for() {
    // Sanity check that the build script wired up cargo's TARGET, since a wrong
    // value here silently makes every native plugin look unsupported.
    assert!(
      TARGET.split('-').count() >= 3,
      "PARCEL_TARGET is not a target triple: {TARGET}"
    );
  }
}
