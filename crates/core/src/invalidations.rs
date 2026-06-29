use std::collections::{HashMap, HashSet};

use crate::{PathId, path::SubPath};

/// Invalidation that fires when a file is created at or matching the given criteria.
#[derive(Debug, Clone)]
pub enum FileCreateInvalidation {
  /// Invalidate if this exact path is created.
  Path(PathId),
  /// Invalidate if a file with this name is created anywhere above the given directory.
  FileName { file_name: SubPath, above: PathId },
  /// Invalidate if a file matching this glob is created.
  Glob(String),
}

/// Files that should trigger re-transformation of an asset when they change or are created.
#[derive(Default, Debug)]
pub struct Invalidations {
  /// Files that should trigger re-transformation when changed.
  pub invalidate_on_file_change: Vec<PathId>,
  /// Files/patterns that should trigger re-transformation when created.
  pub invalidate_on_file_create: Vec<FileCreateInvalidation>,
  /// Whether the result is non-deterministic and should invalidate on process restart.
  pub invalidate_on_startup: bool,
}

impl Invalidations {
  /// Invalidate if a file matching the given glob is created.
  pub fn invalidate_on_glob_create<S: Into<String>>(&mut self, glob: S) {
    self
      .invalidate_on_file_create
      .push(FileCreateInvalidation::Glob(glob.into()));
  }

  /// Invalidate if the given file changes.
  pub fn invalidate_on_file_change(&mut self, path: PathId) {
    self.invalidate_on_file_change.push(path);
  }

  /// Invalidate whenever the process restarts.
  pub fn invalidate_on_startup(&mut self) {
    self.invalidate_on_startup = true;
  }

  pub fn extend(&mut self, other: &Invalidations) {
    self
      .invalidate_on_file_change
      .extend(other.invalidate_on_file_change.iter().cloned());
    self
      .invalidate_on_file_create
      .extend(other.invalidate_on_file_create.iter().cloned());
    self.invalidate_on_startup |= other.invalidate_on_startup;
  }
}

/// Reverse mapping from file paths to the asset indices that depend on them,
/// used to determine which assets need re-transformation when files change.
#[derive(Default, Debug)]
pub struct InvalidationMap {
  /// Assets to re-transform when a file at this URL changes.
  pub on_file_change: HashMap<PathId, Vec<usize>>,
  /// Assets to re-transform when a file at this exact URL is created.
  pub on_file_create_path: HashMap<PathId, Vec<usize>>,
  /// Assets to re-transform when a file with the given name is created above the given directory.
  pub on_file_create_above: Vec<(SubPath, PathId, usize)>,
  /// Assets to re-transform when a file matching the given glob is created.
  pub on_file_create_glob: Vec<(String, usize)>,
  /// Assets that must be re-transformed on process restart.
  pub on_startup: Vec<usize>,
}

impl InvalidationMap {
  pub fn add(&mut self, asset_index: usize, invalidations: Invalidations) {
    for url in invalidations.invalidate_on_file_change {
      self
        .on_file_change
        .entry(url)
        .or_default()
        .push(asset_index);
    }

    for inv in invalidations.invalidate_on_file_create {
      match inv {
        FileCreateInvalidation::Path(url) => {
          self
            .on_file_create_path
            .entry(url)
            .or_default()
            .push(asset_index);
        }
        FileCreateInvalidation::FileName { file_name, above } => {
          self
            .on_file_create_above
            .push((file_name, above, asset_index));
        }
        FileCreateInvalidation::Glob(glob) => {
          self.on_file_create_glob.push((glob, asset_index));
        }
      }
    }

    if invalidations.invalidate_on_startup {
      self.on_startup.push(asset_index);
    }
  }

  /// Returns the asset indices affected by the given file events.
  ///
  /// `changed` are files that were modified or deleted; they match `on_file_change`.
  /// `created` are newly created files; they match the `on_file_create_*` invalidations. Keeping
  /// the two apart matters for patterns that cover many files (globs, file-name-above): modifying
  /// an existing file that happens to match such a pattern must not be mistaken for a creation.
  pub fn invalidate(&self, changed: &[PathId], created: &[PathId]) -> HashSet<usize> {
    let mut affected: HashSet<usize> = HashSet::new();

    for path in changed {
      if let Some(indices) = self.on_file_change.get(path) {
        affected.extend(indices);
      }
    }

    for path in created {
      if let Some(indices) = self.on_file_create_path.get(path) {
        affected.extend(indices);
      }

      // Check file-name-above invalidations: a file with a given name created anywhere within a
      // directory subtree.
      if let Some(parent) = path.parent() {
        for (file_name, above, asset_index) in &self.on_file_create_above {
          if above.is_inside(parent) && path.ends_with(file_name) {
            affected.insert(*asset_index);
          }
        }
      }

      // Check glob invalidations.
      if !self.on_file_create_glob.is_empty() {
        path.with_path(|p| {
          let path_str = p.to_str().unwrap();
          for (glob, asset_index) in &self.on_file_create_glob {
            if glob_match::glob_match(glob, path_str) {
              affected.insert(*asset_index);
            }
          }
        })
      }
    }

    affected
  }
}
