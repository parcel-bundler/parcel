//! A drop-in shim for `browserslist-rs` backed by `oxc-browserslist`.
//!
//! `oxc-browserslist` stores the caniuse tables in a compressed form, which is
//! worth a few MB in the final binary, but it is published under a different
//! package name and dropped the config-file API. This crate re-exposes the
//! subset of the `browserslist-rs` 0.19 surface that we and swc actually use,
//! so it can be swapped in via `[patch.crates-io]`.

use serde::{Deserialize, Serialize};

pub use oxc_browserslist::{Distrib, Error, Version};

/// Mirrors `browserslist::Opts` from browserslist-rs 0.19.
///
/// The config-file fields are kept so callers still compile, but they are
/// inert: `oxc-browserslist` has no config-file support. See [`execute`].
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Opts {
  /// Use desktop browsers if Can I Use doesn't have data about this mobile version.
  pub mobile_to_desktop: bool,

  /// If `true`, ignore unknown versions then return empty result;
  /// otherwise, reject with an error.
  pub ignore_unknown_versions: bool,

  /// Path to configuration file with queries. Ignored.
  pub config: Option<String>,

  /// Processing environment. Ignored.
  pub env: Option<String>,

  /// File or directory path for looking for configuration file. Ignored.
  pub path: Option<String>,

  /// Throw error on missing env. Ignored.
  pub throw_on_missing: bool,

  /// Disable security checks for `extends` query. Ignored.
  pub dangerous_extend: bool,
}

impl Opts {
  fn to_oxc(&self) -> oxc_browserslist::Opts {
    oxc_browserslist::Opts {
      mobile_to_desktop: self.mobile_to_desktop,
      ignore_unknown_versions: self.ignore_unknown_versions,
    }
  }
}

/// Resolve browserslist queries.
///
/// Upstream takes an `IntoIterator`; oxc takes a slice, so collect first.
pub fn resolve<I, S>(queries: I, opts: &Opts) -> Result<Vec<Distrib>, Error>
where
  S: AsRef<str>,
  I: IntoIterator<Item = S>,
{
  let queries: Vec<S> = queries.into_iter().collect();
  oxc_browserslist::resolve(&queries, &opts.to_oxc())
}

/// Resolve queries from a browserslist config file.
///
/// `oxc-browserslist` dropped config-file loading, so this falls back to the
/// default query. Parcel resolves browserslist config itself (see
/// `parcel_core::entry`), and always passes explicit targets to swc's
/// preset_env, so this path is not reached at runtime.
pub fn execute(opts: &Opts) -> Result<Vec<Distrib>, Error> {
  resolve(["defaults"], opts)
}
