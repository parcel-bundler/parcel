use std::path::Path;

use anyhow::anyhow;
use napi::{Env, JsObject};

use atlaspack_napi_helpers::js_callable::JsCallable;
use atlaspack_package_manager::{PackageManager, Resolution};

pub struct PackageManagerNapi {
  resolve_fn: JsCallable,
}

impl PackageManagerNapi {
  pub fn new(env: &Env, js_file_system: &JsObject) -> napi::Result<Self> {
    Ok(Self {
      resolve_fn: JsCallable::new_from_object_prop_bound("resolveSync", &js_file_system)?
        .into_unref(env)?,
    })
  }
}

impl PackageManager for PackageManagerNapi {
  fn resolve(&self, specifier: &str, from: &Path) -> anyhow::Result<Resolution> {
    self
      .resolve_fn
      .call_with_return_serde((specifier.to_owned(), from.to_path_buf()))
      .map_err(|e| anyhow!(e))
  }
}
