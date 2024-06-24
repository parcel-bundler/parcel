use std::sync::Arc;
use std::{fmt::Debug, path::PathBuf};

use crate::types::Dependency;

pub struct ResolvingEvent {
  pub dependency: Arc<Dependency>,
}

pub struct AssetBuildEvent {
  pub file_path: PathBuf,
}

pub enum BuildProgressEvent {
  Resolving(ResolvingEvent),
  Building(AssetBuildEvent),
}

// TODO Flesh these out
pub enum ReporterEvent {
  BuildStart,
  BuildProgress(BuildProgressEvent),
  BuildFailure,
  BuildSuccess,
  Log,
  Validation,
  WatchStart,
  WatchEnd,
}

/// Receives events from Parcel as they occur throughout the build process
///
/// For example, reporters may write status information to stdout, run a dev server, or generate a
/// bundle analysis report at the end of a build.
///
pub trait ReporterPlugin: Debug {
  /// Processes the event from Parcel
  fn report(&self, event: &ReporterEvent) -> Result<(), anyhow::Error>;
}

#[cfg(test)]
mod tests {
  use super::*;

  #[derive(Debug)]
  struct TestReporterPlugin {}

  impl ReporterPlugin for TestReporterPlugin {
    fn report(&self, _event: &ReporterEvent) -> Result<(), anyhow::Error> {
      todo!()
    }
  }

  #[test]
  fn can_be_defined_in_dyn_vec() {
    let mut reporters = Vec::<Box<dyn ReporterPlugin>>::new();

    reporters.push(Box::new(TestReporterPlugin {}));

    assert_eq!(reporters.len(), 1);
  }
}
