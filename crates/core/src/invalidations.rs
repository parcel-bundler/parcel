use std::collections::{HashMap, HashSet};

use path_slash::PathExt;

use crate::{AssetNodeIndex, PathId, path::SubPath};

/// Files that should trigger re-transformation of an asset when they change or are created.
#[derive(Default, Debug)]
pub struct Invalidations {
  /// Files that should trigger re-transformation when changed.
  pub invalidate_on_file_change: Vec<PathId>,
  /// Files that should trigger re-transformation when created at exactly this path.
  pub invalidate_on_file_create: Vec<PathId>,
  /// File names (which may span several segments, e.g. `node_modules/dep`) that should trigger
  /// re-transformation when created anywhere above the paired directory.
  pub invalidate_on_file_create_above: Vec<(SubPath, PathId)>,
  /// Globs that should trigger re-transformation when a matching file is created.
  pub invalidate_on_glob_create: Vec<String>,
  /// Files that should trigger re-transformation when deleted (but not when merely modified),
  /// e.g. resolver existence probes whose disappearance changes resolution.
  pub invalidate_on_file_delete: Vec<PathId>,
  /// Whether the result is non-deterministic and should invalidate on process restart.
  pub invalidate_on_startup: bool,
}

impl Invalidations {
  /// Invalidate if a file matching the given glob is created.
  pub fn invalidate_on_glob_create<S: Into<String>>(&mut self, glob: S) {
    self.invalidate_on_glob_create.push(glob.into());
  }

  /// Invalidate if the given file changes.
  pub fn invalidate_on_file_change(&mut self, path: PathId) {
    self.invalidate_on_file_change.push(path);
  }

  /// Invalidate if a file is created at the given path.
  pub fn invalidate_on_file_create(&mut self, path: PathId) {
    self.invalidate_on_file_create.push(path);
  }

  /// Invalidate if a file named `file_name` is created anywhere above `above`.
  pub fn invalidate_on_file_create_above(&mut self, file_name: SubPath, above: PathId) {
    self
      .invalidate_on_file_create_above
      .push((file_name, above));
  }

  /// Invalidate if the given file is deleted.
  pub fn invalidate_on_file_delete(&mut self, path: PathId) {
    self.invalidate_on_file_delete.push(path);
  }

  /// Invalidate whenever the process restarts.
  pub fn invalidate_on_startup(&mut self) {
    self.invalidate_on_startup = true;
  }

  pub fn is_empty(&self) -> bool {
    self.invalidate_on_file_change.is_empty()
      && self.invalidate_on_file_create.is_empty()
      && self.invalidate_on_file_create_above.is_empty()
      && self.invalidate_on_glob_create.is_empty()
      && self.invalidate_on_file_delete.is_empty()
      && !self.invalidate_on_startup
  }

  /// Moves all of `other`'s invalidations into this, leaving `other` empty.
  pub fn append(&mut self, other: &mut Invalidations) {
    self
      .invalidate_on_file_change
      .append(&mut other.invalidate_on_file_change);
    self
      .invalidate_on_file_create
      .append(&mut other.invalidate_on_file_create);
    self
      .invalidate_on_file_create_above
      .append(&mut other.invalidate_on_file_create_above);
    self
      .invalidate_on_glob_create
      .append(&mut other.invalidate_on_glob_create);
    self
      .invalidate_on_file_delete
      .append(&mut other.invalidate_on_file_delete);
    self.invalidate_on_startup |= std::mem::take(&mut other.invalidate_on_startup);
  }

  pub fn extend(&mut self, other: &Invalidations) {
    self
      .invalidate_on_file_change
      .extend_from_slice(&other.invalidate_on_file_change);
    self
      .invalidate_on_file_create
      .extend_from_slice(&other.invalidate_on_file_create);
    self
      .invalidate_on_file_create_above
      .extend_from_slice(&other.invalidate_on_file_create_above);
    self
      .invalidate_on_glob_create
      .extend_from_slice(&other.invalidate_on_glob_create);
    self
      .invalidate_on_file_delete
      .extend_from_slice(&other.invalidate_on_file_delete);
    self.invalidate_on_startup |= other.invalidate_on_startup;
  }
}

/// Reverse mapping from file paths to the asset indices that depend on them,
/// used to determine which assets need re-transformation when files change.
#[derive(Default, Debug)]
pub struct InvalidationMap {
  /// Assets to re-transform when a file at this URL changes.
  pub on_file_change: HashMap<PathId, Vec<AssetNodeIndex>>,
  /// Assets to re-transform when a file at this URL is deleted (but not merely modified).
  pub on_file_delete: HashMap<PathId, Vec<AssetNodeIndex>>,
  /// Assets to re-transform when a file at this exact URL is created.
  pub on_file_create_path: HashMap<PathId, Vec<AssetNodeIndex>>,
  /// Assets to re-transform when a file with the given name is created above the given directory.
  pub on_file_create_above: Vec<(SubPath, PathId, AssetNodeIndex)>,
  /// Assets to re-transform when a file matching the given glob is created.
  pub on_file_create_glob: Vec<(String, AssetNodeIndex)>,
  /// Assets that must be re-transformed on process restart.
  pub on_startup: Vec<AssetNodeIndex>,
}

impl InvalidationMap {
  pub fn add(&mut self, asset_index: AssetNodeIndex, invalidations: Invalidations) {
    // Skips repeats, e.g. a file read many times while transforming one asset.
    fn push(assets: &mut Vec<AssetNodeIndex>, asset_index: AssetNodeIndex) {
      if assets.last() != Some(&asset_index) {
        assets.push(asset_index);
      }
    }

    for url in invalidations.invalidate_on_file_change {
      push(self.on_file_change.entry(url).or_default(), asset_index);
    }

    for url in invalidations.invalidate_on_file_delete {
      push(self.on_file_delete.entry(url).or_default(), asset_index);
    }

    for url in invalidations.invalidate_on_file_create {
      push(
        self.on_file_create_path.entry(url).or_default(),
        asset_index,
      );
    }

    for (file_name, above) in invalidations.invalidate_on_file_create_above {
      self
        .on_file_create_above
        .push((file_name, above, asset_index));
    }

    for glob in invalidations.invalidate_on_glob_create {
      #[cfg(windows)]
      let glob = glob.replace('\\', "/");
      self.on_file_create_glob.push((glob, asset_index));
    }

    if invalidations.invalidate_on_startup {
      self.on_startup.push(asset_index);
    }
  }

  /// Removes repeated create-above and glob invalidations, which `add` doesn't check for: unlike
  /// path invalidations, they aren't keyed by path. For maps that `add` the same invalidations
  /// repeatedly, e.g. one kept across rebuilds.
  pub fn dedup(&mut self) {
    self.on_file_create_above.sort_unstable();
    self.on_file_create_above.dedup();
    self.on_file_create_glob.sort_unstable();
    self.on_file_create_glob.dedup();
  }

  /// Returns the asset indices affected by the given file events.
  ///
  /// `changed` are files that were modified or deleted; they match `on_file_change`.
  /// `deleted` is the subset of `changed` that no longer exists; those additionally match
  /// `on_file_delete` (e.g. resolver existence probes whose disappearance changes resolution).
  /// `created` are newly created files; they match the `on_file_create_*` invalidations. Keeping
  /// the sets apart matters for patterns that cover many files (globs, file-name-above): modifying
  /// an existing file that happens to match such a pattern must not be mistaken for a creation.
  pub fn invalidate(
    &self,
    changed: &[PathId],
    created: &[PathId],
    deleted: &[PathId],
  ) -> HashSet<AssetNodeIndex> {
    let mut affected: HashSet<AssetNodeIndex> = HashSet::new();

    for path in changed {
      if let Some(indices) = self.on_file_change.get(path) {
        affected.extend(indices);
      }
    }

    for path in deleted {
      if let Some(indices) = self.on_file_delete.get(path) {
        affected.extend(indices);
      }
      if let Some(indices) = self.on_file_change.get(path) {
        affected.extend(indices);
      }
    }

    for path in created {
      if let Some(indices) = self.on_file_create_path.get(path) {
        affected.extend(indices);
      }

      // Check file-name-above invalidations: a file with a given name created anywhere within a
      // directory subtree. The name may span multiple segments (e.g. `node_modules/dep`), so the
      // directory it was created in is the path with the entire name stripped, not just the
      // immediate parent.
      for (file_name, above, asset_index) in &self.on_file_create_above {
        if path.ends_with(file_name) {
          let mut base = Some(*path);
          for _ in 0..file_name.segment_count() {
            base = base.and_then(|p| p.parent());
          }
          if let Some(base) = base
            && above.is_inside(base)
          {
            affected.insert(*asset_index);
          }
        }
      }

      // Check glob invalidations.
      if !self.on_file_create_glob.is_empty() {
        path.with_path(|p| {
          let path_str = p.to_slash_lossy();
          for (glob, asset_index) in &self.on_file_create_glob {
            if glob_match::glob_match(glob, &path_str) {
              affected.insert(*asset_index);
            }
          }
        })
      }
    }

    affected
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::Path;

  fn path(p: &str) -> PathId {
    PathId::new(Path::new(p))
  }

  fn map_with_create_above(file_name: SubPath, above: &str) -> InvalidationMap {
    let mut map = InvalidationMap::default();
    let mut invalidations = Invalidations::default();
    invalidations.invalidate_on_file_create_above(file_name, path(above));
    map.add(AssetNodeIndex(1), invalidations);
    map
  }

  #[test]
  fn dedup_removes_repeated_create_above_and_glob_invalidations() {
    let mut map = InvalidationMap::default();
    for _ in 0..3 {
      let mut invalidations = Invalidations::default();
      invalidations.invalidate_on_file_create_above(SubPath::file("package.json"), path("/a"));
      invalidations.invalidate_on_glob_create("/a/*.js");
      invalidations.invalidate_on_file_change(path("/a/b.js"));
      map.add(AssetNodeIndex(0), invalidations);
    }
    // A different asset's invalidation for the same pattern is kept.
    let mut invalidations = Invalidations::default();
    invalidations.invalidate_on_glob_create("/a/*.js");
    map.add(AssetNodeIndex(1), invalidations);

    map.dedup();
    assert_eq!(map.on_file_create_above.len(), 1);
    assert_eq!(map.on_file_create_glob.len(), 2);
    assert_eq!(map.on_file_change[&path("/a/b.js")], [AssetNodeIndex(0)]);
  }

  #[test]
  fn file_create_above_matches_single_segment_name() {
    let map = map_with_create_above(SubPath::file("aliases.json"), "/project/src/index.js");
    let affected = map.invalidate(&[], &[path("/project/src/aliases.json")], &[]);
    assert_eq!(affected.len(), 1);
  }

  #[test]
  fn file_create_above_matches_multi_segment_module_dir() {
    // The created path's *base* is the path with the entire multi-segment name stripped
    // (/project/src), not its immediate parent (/project/src/node_modules).
    let map = map_with_create_above(SubPath::module("dep"), "/project/src/index.js");
    let affected = map.invalidate(&[], &[path("/project/src/node_modules/dep")], &[]);
    assert_eq!(affected.len(), 1);
  }

  #[test]
  fn file_create_above_ignores_unrelated_subtrees() {
    let map = map_with_create_above(SubPath::module("dep"), "/project/src/index.js");
    let affected = map.invalidate(&[], &[path("/project/other/node_modules/dep")], &[]);
    assert!(affected.is_empty());
  }
}
