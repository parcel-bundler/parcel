use std::fmt::{Debug, Display, Formatter};

use crate::plugin::{ReporterEvent, ReporterPlugin};

#[cfg(not(test))]
type Reporter = Box<dyn ReporterPlugin>;

#[cfg(test)]
type Reporter = crate::plugin::MockReporterPlugin;

/// A reporter plugin that delegates to multiple other reporters.
#[derive(Debug)]
pub struct CompositeReporterPlugin {
  reporters: Vec<Reporter>,
}

impl CompositeReporterPlugin {
  pub fn new(reporters: Vec<Reporter>) -> Self {
    Self { reporters }
  }
}

#[derive(Debug)]
pub struct CompositeReporterPluginError {
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

#[cfg(test)]
mod test {
  use crate::plugin::reporter_plugin::MockReporterPlugin;
  use anyhow::anyhow;

  use super::*;

  #[test]
  fn test_reporters_get_called() {
    let mut reporter1 = MockReporterPlugin::new();
    let mut reporter2 = MockReporterPlugin::new();

    reporter1.expect_report().times(1).returning(|_| Ok(()));
    reporter2.expect_report().times(1).returning(|_| Ok(()));

    let composite_reporter = CompositeReporterPlugin::new(vec![reporter1, reporter2]);

    composite_reporter
      .report(&ReporterEvent::BuildStart)
      .unwrap();
  }

  #[test]
  fn test_errors_are_forwarded_up() {
    let mut reporter1 = MockReporterPlugin::new();
    let mut reporter2 = MockReporterPlugin::new();

    reporter1
      .expect_report()
      .times(1)
      .returning(|_| Err(anyhow!("Failed")));
    reporter2.expect_report().times(1).returning(|_| Ok(()));

    let composite_reporter = CompositeReporterPlugin::new(vec![reporter1, reporter2]);

    let result = composite_reporter.report(&ReporterEvent::BuildStart);
    assert!(result.is_err());
    assert!(result
      .err()
      .unwrap()
      .to_string()
      .starts_with("CompositeReporterPluginError [Failed"));
  }
}
