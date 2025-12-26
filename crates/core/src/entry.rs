use std::path::Path;

use crate::{SourceLocation, SourceUrl, Target};

pub struct Entry {
  pub url: SourceUrl,
  pub target: Target,
  pub asset: Option<usize>,
  pub loc: Option<SourceLocation>,
}

pub fn resolve_entries(entries: Vec<String>) -> Vec<Entry> {
  entries
    .into_iter()
    .map(|entry| Entry {
      url: SourceUrl::from_path(Path::new(&entry)).unwrap(),
      target: Target::default(),
      loc: None,
      asset: None,
    })
    .collect()
}
