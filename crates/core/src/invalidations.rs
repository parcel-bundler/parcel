use std::collections::HashMap;

use crate::SourceUrl;

/// Invalidation that fires when a file is created at or matching the given criteria.
#[derive(Debug, Clone)]
pub enum FileCreateInvalidation {
  /// Invalidate if this exact path is created.
  Path(SourceUrl),
  /// Invalidate if a file with this name is created anywhere above the given directory.
  FileName { file_name: String, above: SourceUrl },
  /// Invalidate if a file matching this glob is created.
  Glob(String),
}

/// Files that should trigger re-transformation of an asset when they change or are created.
#[derive(Default, Debug)]
pub struct Invalidations {
  /// Files that should trigger re-transformation when changed.
  pub invalidate_on_file_change: Vec<SourceUrl>,
  /// Files/patterns that should trigger re-transformation when created.
  pub invalidate_on_file_create: Vec<FileCreateInvalidation>,
  /// Whether the result is non-deterministic and should invalidate on process restart.
  pub invalidate_on_startup: bool,
}

impl Invalidations {
  pub fn extend(&mut self, other: &Invalidations) {
    self.invalidate_on_file_change.extend(other.invalidate_on_file_change.iter().cloned());
    self.invalidate_on_file_create.extend(other.invalidate_on_file_create.iter().cloned());
    self.invalidate_on_startup |= other.invalidate_on_startup;
  }
}

/// Reverse mapping from file paths to the asset indices that depend on them,
/// used to determine which assets need re-transformation when files change.
#[derive(Default, Debug)]
pub struct InvalidationMap {
  /// Assets to re-transform when a file at this URL changes.
  pub on_file_change: HashMap<SourceUrl, Vec<usize>>,
  /// Assets to re-transform when a file at this exact URL is created.
  pub on_file_create_path: HashMap<SourceUrl, Vec<usize>>,
  /// Assets to re-transform when a file with the given name is created above the given directory.
  pub on_file_create_above: Vec<(String, SourceUrl, usize)>,
  /// Assets to re-transform when a file matching the given glob is created.
  pub on_file_create_glob: Vec<(String, usize)>,
  /// Assets that must be re-transformed on process restart.
  pub on_startup: Vec<usize>,
}

impl InvalidationMap {
  pub fn add(&mut self, asset_index: usize, invalidations: Invalidations) {
    for url in invalidations.invalidate_on_file_change {
      self.on_file_change.entry(url).or_default().push(asset_index);
    }

    for inv in invalidations.invalidate_on_file_create {
      match inv {
        FileCreateInvalidation::Path(url) => {
          self.on_file_create_path.entry(url).or_default().push(asset_index);
        }
        FileCreateInvalidation::FileName { file_name, above } => {
          self.on_file_create_above.push((file_name, above, asset_index));
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
}
