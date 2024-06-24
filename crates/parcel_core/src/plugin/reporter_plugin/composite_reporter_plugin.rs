use std::fmt::{Debug, Display, Formatter};

use crate::plugin::{ReporterEvent, ReporterPlugin};

/// A reporter plugin that delegates to multiple other reporters.
#[derive(Debug)]
pub struct CompositeReporterPlugin {
  reporters: Vec<Box<dyn ReporterPlugin>>,
}

impl CompositeReporterPlugin {
  pub fn new(reporters: Vec<Box<dyn ReporterPlugin>>) -> Self {
    Self { reporters }
  }
}

#[derive(Debug)]
struct CompositeReporterPluginError {
  errors: Vec<anyhow::Error>,
}

impl Display for CompositeReporterPluginError {
  fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
    write!(f, "CompositeReporterPluginError {:?}", self.errors)
  }
}

impl std::error::Error for CompositeReporterPluginError {}

impl ReporterPlugin for CompositeReporterPlugin {
  /// Loop over reporters and call report on each one of them.
  fn report(&self, event: &ReporterEvent) -> Result<(), anyhow::Error> {
    let mut errors = vec![];
    for reporter in &self.reporters {
      let result = reporter.report(event);
      if let Err(error) = result {
        errors.push(error)
      }
    }

    if errors.is_empty() {
      Ok(())
    } else {
      Err(anyhow::Error::new(CompositeReporterPluginError { errors }))
    }
  }
}
