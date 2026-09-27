use std::sync::{Arc, Mutex, OnceLock};

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

use crate::{
  AssetIndex, AssetType, EnvironmentFlags, PathId, SourceUrl, Target, impl_bitflags_serde,
};

#[derive(Debug, Clone)]
pub struct Bundle {
  pub id: u64,
  pub ty: AssetType,
  pub target: Arc<Target>,
  pub bundle_behavior: BundleBehavior,
  pub flags: BundleFlags,
  pub dist_path: Option<PathId>,
  pub assets: Vec<AssetIndex>,
  pub entry_assets: Vec<AssetIndex>,
  pub main_entry_asset: Option<AssetIndex>,
  pub referenced_bundles: Vec<usize>,
  /// Naming state managed by core during packaging. Construct with `Default::default()`.
  pub name_state: NameState,
}

/// A bundle's final name, and while it is being packaged, the bundles it declared access to.
#[derive(Debug, Default)]
pub struct NameState {
  /// The final dist path, once known. Until then, the namer's template (`dist_path`) is used.
  final_path: OnceLock<PathId>,
  /// Sorted ids of the bundles this bundle declared in `Content::bundle_dependencies`. Only set
  /// while the bundle is being packaged; name access is unchecked otherwise.
  declared: Mutex<Option<Box<[u64]>>>,
}

impl Clone for NameState {
  fn clone(&self) -> Self {
    // Declarations belong to a single packaging of a single bundle struct.
    NameState {
      final_path: self.final_path.clone(),
      declared: Mutex::new(None),
    }
  }
}

bitflags! {
  #[derive(Debug, Clone, Copy)]
  pub struct BundleFlags: u8 {
    const NEEDS_STABLE_NAME = 1 << 0;
    const IS_SPLITTABLE = 1 << 1;
    const IS_PLACEHOLDER = 1 << 2;
    const ENTRY = 1 << 3;
  }
}

impl_bitflags_serde!(BundleFlags);

#[derive(Debug, Default, PartialEq, Eq, Hash, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BundleBehavior {
  #[default]
  None,
  Inline,
  Isolated,
}

impl Bundle {
  /// The URL of this bundle relative to `from`, which must have declared this bundle as a
  /// dependency if it is being packaged.
  pub fn relative_url(&self, from: &Bundle) -> Option<String> {
    from.check_name_access(self);
    Some(self.current_path()?.relative_url(&from.dist_path?))
  }

  pub fn relative_specifier(&self, from: &Bundle) -> Option<String> {
    self.relative_url(from).map(|mut r| {
      if !r.starts_with(".") {
        r.insert_str(0, "./");
      }
      r
    })
  }

  /// The bundle's final dist path if known, otherwise its template path.
  pub fn dist_path(&self) -> PathId {
    self.current_path().unwrap()
  }

  pub fn dist_url(&self) -> SourceUrl {
    SourceUrl::from_path(&self.dist_path())
  }

  /// The dist-root-relative name of the bundle.
  pub fn name(&self) -> String {
    self
      .dist_path()
      .relative_url_from_dir(&self.target.dist_dir)
  }

  pub fn absolute_url(&self) -> String {
    let name = self.name();
    let public_url = self.target.public_url.trim_end_matches('/');
    if public_url.is_empty() {
      format!("/{}", name)
    } else {
      format!("{}/{}", public_url, name)
    }
  }

  /// A dist-root-relative key for this bundle that doesn't change with its content. The runtime
  /// resolves it to the final name through its manifest, so reading it is not a name dependency.
  pub fn stable_key(&self) -> String {
    self
      .dist_path
      .unwrap()
      .relative_url_from_dir(&self.target.dist_dir)
  }

  /// The string a namer must include in the file name of a bundle that may be content hashed.
  pub fn hash_reference(&self) -> String {
    format!("{:016x}", self.id)
  }

  /// Whether the bundle's name gets a content hash when content hashing is enabled. Stable names,
  /// inline bundles (never written), libraries and server-side bundles are not hashed.
  pub fn may_be_content_hashed(&self) -> bool {
    !self.flags.contains(BundleFlags::NEEDS_STABLE_NAME)
      && self.bundle_behavior != BundleBehavior::Inline
      && !self.target.flags.contains(EnvironmentFlags::IS_LIBRARY)
      && self.target.environment.is_browser()
  }

  /// Sets the bundle's final dist path. It can only be set once.
  pub fn set_final_path(&self, path: PathId) {
    self
      .name_state
      .final_path
      .set(path)
      .expect("final path was already set");
  }

  /// Whether the bundle's final dist path is known.
  pub fn has_final_path(&self) -> bool {
    self.name_state.final_path.get().is_some()
  }

  fn current_path(&self) -> Option<PathId> {
    self.name_state.final_path.get().copied().or(self.dist_path)
  }

  /// Declares the bundles whose names or inline content this bundle may access while it is being
  /// packaged. Cleared by `end_packaging`.
  pub fn begin_packaging(&self, mut declared: Vec<u64>) {
    declared.sort_unstable();
    declared.dedup();
    *self.name_state.declared.lock().unwrap() = Some(declared.into_boxed_slice());
  }

  pub fn end_packaging(&self) {
    *self.name_state.declared.lock().unwrap() = None;
  }

  /// Whether this bundle may access `target`'s name or inline content. Always true outside of
  /// packaging.
  pub fn may_access(&self, target: &Bundle) -> bool {
    target.id == self.id
      || match &*self.name_state.declared.lock().unwrap() {
        Some(declared) => declared.binary_search(&target.id).is_ok(),
        None => true,
      }
  }

  fn check_name_access(&self, target: &Bundle) {
    if !self.may_access(target) {
      panic!(
        "The packager for bundle {} accessed the name of bundle {}, which it did not declare in `Content::bundle_dependencies`.",
        self.stable_key(),
        target.stable_key()
      );
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::Path;

  fn bundle(id: u64, name: &str) -> Bundle {
    let dist_dir = PathId::new(Path::new("/dist"));
    Bundle {
      id,
      ty: AssetType::Js,
      target: Arc::new(Target {
        dist_dir,
        ..Default::default()
      }),
      bundle_behavior: BundleBehavior::None,
      flags: BundleFlags::empty(),
      dist_path: Some(dist_dir.child(name)),
      assets: Vec::new(),
      entry_assets: Vec::new(),
      main_entry_asset: None,
      referenced_bundles: Vec::new(),
      name_state: Default::default(),
    }
  }

  #[test]
  fn name_access_is_unchecked_outside_packaging() {
    let a = bundle(1, "a.js");
    let b = bundle(2, "b.js");
    assert_eq!(b.relative_url(&a).as_deref(), Some("b.js"));
  }

  #[test]
  fn declared_and_own_names_are_accessible_while_packaging() {
    let a = bundle(1, "a.js");
    let b = bundle(2, "b.js");
    a.begin_packaging(vec![2]);
    assert_eq!(b.relative_specifier(&a).as_deref(), Some("./b.js"));
    assert_eq!(a.relative_url(&a).as_deref(), Some(""));
    a.end_packaging();
  }

  #[test]
  #[should_panic(expected = "The packager for bundle a.js accessed the name of bundle b.js")]
  fn undeclared_names_are_not_accessible_while_packaging() {
    let a = bundle(1, "a.js");
    let b = bundle(2, "b.js");
    a.begin_packaging(vec![3]);
    b.relative_url(&a);
  }

  #[test]
  fn final_paths_replace_templates_except_in_stable_keys() {
    let a = bundle(1, "a.js");
    let b = bundle(2, "b-0000000000000002.js");
    assert_eq!(b.hash_reference(), "0000000000000002");
    b.set_final_path(b.target.dist_dir.child("b-abcdefgh.js"));
    assert!(b.has_final_path());
    assert_eq!(b.relative_url(&a).as_deref(), Some("b-abcdefgh.js"));
    assert_eq!(b.name(), "b-abcdefgh.js");
    assert_eq!(b.stable_key(), "b-0000000000000002.js");
  }

  #[test]
  fn clones_keep_final_paths_but_not_declarations() {
    let a = bundle(1, "a.js");
    let b = bundle(2, "b.js");
    a.set_final_path(a.target.dist_dir.child("a-final.js"));
    a.begin_packaging(vec![]);
    let clone = a.clone();
    assert_eq!(clone.name(), "a-final.js");
    assert!(clone.may_access(&b));
    assert!(!a.may_access(&b));
  }
}
