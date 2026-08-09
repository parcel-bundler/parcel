//! Reporter plugins: build lifecycle and log events.
//!
//! A reporter observes a build rather than contributing to it. Parcel hands it
//! every event in the order they were emitted, and nothing a reporter does can
//! change the build's outcome — a reporter that fails has its diagnostic printed
//! and the build carries on.

use std::{
  panic::AssertUnwindSafe,
  sync::{Arc, OnceLock, Weak},
  time::Duration,
};

use crate::{AssetIndex, BundleGraph, Diagnostic, DiagnosticList, LogLevel, ParcelOptions};

/// Observes the build.
///
/// Returning `Err` reports the diagnostic and moves on to the next reporter; it
/// does not fail the build. A build that produced correct output must not be
/// reported as failed because a progress bar threw.
pub trait Reporter: Send + Sync {
  fn report(&self, event: &ReporterEvent, options: &ParcelOptions) -> Result<(), DiagnosticList>;
}

/// Something worth telling a reporter about.
///
/// Non-exhaustive: matches must have a catch-all arm, so that events added later
/// do not break existing reporters.
#[non_exhaustive]
pub enum ReporterEvent<'a> {
  /// A build is about to start. Emitted once per build, including rebuilds.
  BuildStart,
  /// A build finished and its output was written.
  BuildSuccess(BuildSuccess<'a>),
  /// A build failed. The same diagnostics are also returned to the caller.
  BuildFailure {
    diagnostics: &'a DiagnosticList,
  },
  Log(LogEvent<'a>),
}

pub struct BuildSuccess<'a> {
  pub bundle_graph: &'a BundleGraph<'a>,
  /// Assets re-transformed by this build. Empty on a full build, which
  /// transformed all of them.
  pub changed_assets: &'a [AssetIndex],
  pub build_time: Duration,
}

pub struct LogEvent<'a> {
  pub level: LogLevel,
  pub message: LogMessage<'a>,
}

#[derive(Debug)]
pub enum LogMessage<'a> {
  Text(&'a str),
  Diagnostics(&'a [Diagnostic]),
}

pub struct Reporters {
  log_level: LogLevel,
  reporters: Vec<Arc<dyn Reporter>>,
  options: Arc<OnceLock<Weak<ParcelOptions>>>,
}

impl Reporters {
  /// A dispatcher with no reporters. Every event is discarded and no thread is
  /// spawned.
  pub fn none() -> Arc<Reporters> {
    Arc::new(Reporters {
      log_level: LogLevel::None,
      reporters: Vec::new(),
      options: Arc::new(OnceLock::new()),
    })
  }

  /// Starts the reporter thread. `log_level` is the threshold log events are
  /// filtered against before they are queued, so every reporter sees the same
  /// stream and a filtered-out log costs nothing to emit.
  pub fn new(reporters: Vec<Arc<dyn Reporter>>, log_level: LogLevel) -> Arc<Reporters> {
    if reporters.is_empty() {
      return Arc::new(Reporters {
        log_level,
        reporters,
        options: Arc::new(OnceLock::new()),
      });
    }

    Arc::new(Reporters {
      log_level,
      reporters,
      options: Arc::new(OnceLock::new()),
    })
  }

  /// Supplies the options passed to each reporter. Until this is called, events
  /// are dropped — reporters are built while the configuration is loading, which
  /// is before the options they will be handed exist.
  pub fn attach(&self, options: Weak<ParcelOptions>) {
    let _ = self.options.set(options);
  }

  pub fn build_start(&self) {
    let event = ReporterEvent::BuildStart;
    dispatch(&self.reporters, &*self.options, &event);
  }

  /// Reports a finished build, blocking until every reporter has handled it.
  ///
  /// The event borrows the bundle graph, so the borrow has to be held for the
  /// whole call rather than handed off.
  pub fn build_success(&self, success: BuildSuccess<'_>) {
    let event = ReporterEvent::BuildSuccess(success);
    dispatch(&self.reporters, &*self.options, &event);
  }

  pub fn build_failure(&self, diagnostics: &DiagnosticList) {
    // self.send(OwnedEvent::BuildFailure(diagnostics.clone()));
    let event = ReporterEvent::BuildFailure { diagnostics };
    dispatch(&self.reporters, &*self.options, &event);
  }

  pub fn log(&self, level: LogLevel, message: &str) {
    if !self.log_level.allows(level) {
      return;
    }
    let event = ReporterEvent::Log(LogEvent {
      level,
      message: LogMessage::Text(message),
    });
    dispatch(&self.reporters, &*self.options, &event);
  }

  pub fn log_diagnostics(&self, level: LogLevel, diagnostics: &[Diagnostic]) {
    if !self.log_level.allows(level) {
      return;
    }
    let event = ReporterEvent::Log(LogEvent {
      level,
      message: LogMessage::Diagnostics(diagnostics),
    });
    dispatch(&self.reporters, &*self.options, &event);
  }
}

fn dispatch(
  reporters: &[Arc<dyn Reporter>],
  options: &OnceLock<Weak<ParcelOptions>>,
  event: &ReporterEvent,
) {
  // Either `attach` was never called, or the Parcel has been dropped and there
  // is nothing left to report about.
  let Some(options) = options.get().and_then(Weak::upgrade) else {
    return;
  };

  for reporter in reporters {
    // A reporter cannot fail the build: a build that produced correct output
    // must not be reported as failed because a progress bar threw.
    match std::panic::catch_unwind(AssertUnwindSafe(|| reporter.report(event, &options))) {
      Ok(Ok(())) => {}
      Ok(Err(diagnostics)) => report_to_stderr(&diagnostics),
      Err(payload) => {
        let message = if let Some(message) = payload.downcast_ref::<&str>() {
          (*message).to_owned()
        } else if let Some(message) = payload.downcast_ref::<String>() {
          message.clone()
        } else {
          "unknown panic".to_owned()
        };
        report_to_stderr(
          &Diagnostic {
            origin: Some("@parcel/core".into()),
            ..Diagnostic::from_message(format!("Reporter panicked: {message}"))
          }
          .into(),
        )
      }
    }
  }
}

/// The last resort for something that cannot itself be reported.
fn report_to_stderr(diagnostics: &DiagnosticList) {
  let mut stderr = std::io::stderr();
  let _ = diagnostics.report(&mut stderr);
}

#[cfg(test)]
mod tests {
  use std::{borrow::Cow, collections::HashMap, sync::Mutex};

  use super::*;
  use crate::{AssetGraph, PathId};

  /// Records the events it is given, so a test can assert on their order.
  struct Recorder {
    events: Arc<Mutex<Vec<String>>>,
    /// Panics instead of recording when it sees this event, to prove a failing
    /// reporter does not take the others down with it.
    panic_on: Option<&'static str>,
    /// Held before recording, to make a reporter slow on demand.
    delay: Option<Duration>,
  }

  impl Recorder {
    fn new() -> (Arc<Recorder>, Arc<Mutex<Vec<String>>>) {
      let events = Arc::new(Mutex::new(Vec::new()));
      let recorder = Arc::new(Recorder {
        events: events.clone(),
        panic_on: None,
        delay: None,
      });
      (recorder, events)
    }
  }

  impl Reporter for Recorder {
    fn report(
      &self,
      event: &ReporterEvent,
      _options: &ParcelOptions,
    ) -> Result<(), DiagnosticList> {
      let name = match event {
        ReporterEvent::BuildStart => "buildStart".to_owned(),
        ReporterEvent::BuildSuccess(success) => {
          format!("buildSuccess:{}", success.bundle_graph.bundles.len())
        }
        ReporterEvent::BuildFailure { diagnostics } => {
          format!("buildFailure:{}", diagnostics.0.len())
        }
        ReporterEvent::Log(log) => match log.message {
          LogMessage::Text(text) => format!("log:{}:{}", log.level, text),
          LogMessage::Diagnostics(diagnostics) => {
            format!("log:{}:{} diagnostics", log.level, diagnostics.len())
          }
        },
        // No catch-all: `#[non_exhaustive]` does not apply within the defining
        // crate, so a new event breaks this match on purpose.
      };

      if self.panic_on == Some(name.as_str()) {
        panic!("reporter failed on {name}");
      }
      if let Some(delay) = self.delay {
        std::thread::sleep(delay);
      }

      self.events.lock().unwrap().push(name);
      Ok(())
    }
  }

  /// Starts a dispatcher with options attached, as `Parcel::new` does. The
  /// options must be held by the caller: the dispatcher only holds a `Weak`, and
  /// drops every event once it can no longer be upgraded.
  fn setup(
    reporters: Vec<Arc<dyn Reporter>>,
    log_level: LogLevel,
  ) -> (Arc<Reporters>, Arc<ParcelOptions>) {
    let reporters = Reporters::new(reporters, log_level.clone());
    let options = Arc::new(ParcelOptions {
      log_level,
      reporters: reporters.clone(),
      ..Default::default()
    });
    reporters.attach(Arc::downgrade(&options));
    (reporters, options)
  }

  fn empty_bundle_graph() -> BundleGraph<'static> {
    BundleGraph::new(
      AssetGraph {
        asset_nodes: Cow::Owned(Vec::new()),
        assets: Cow::Owned(Vec::new()),
        entries: Cow::Owned(Vec::new()),
      },
      Vec::new(),
      HashMap::new(),
      PathId::root(),
    )
  }

  #[test]
  fn events_are_delivered_in_emission_order() {
    let (recorder, events) = Recorder::new();
    let (reporters, _options) = setup(vec![recorder], LogLevel::Verbose);

    reporters.build_start();
    reporters.log(LogLevel::Info, "before");
    // Blocks until handled, so it must not overtake the queued log above.
    reporters.build_success(BuildSuccess {
      bundle_graph: &empty_bundle_graph(),
      changed_assets: &[],
      build_time: Duration::from_millis(1),
    });
    reporters.log(LogLevel::Warn, "after");

    assert_eq!(
      *events.lock().unwrap(),
      [
        "buildStart",
        "log:info:before",
        "buildSuccess:0",
        "log:warn:after"
      ]
    );
  }

  #[test]
  fn build_success_waits_for_every_reporter() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let slow = Arc::new(Recorder {
      events: events.clone(),
      panic_on: None,
      delay: Some(Duration::from_millis(50)),
    });
    let (reporters, _options) = setup(vec![slow], LogLevel::Verbose);

    reporters.build_success(BuildSuccess {
      bundle_graph: &empty_bundle_graph(),
      changed_assets: &[],
      build_time: Duration::ZERO,
    });

    // No flush: returning from build_success is itself the guarantee.
    assert_eq!(*events.lock().unwrap(), ["buildSuccess:0"]);
  }

  #[test]
  fn logs_from_many_threads_keep_each_thread_in_order() {
    let (recorder, events) = Recorder::new();
    let (reporters, _options) = setup(vec![recorder], LogLevel::Verbose);

    std::thread::scope(|scope| {
      for thread in 0..4 {
        let reporters = &reporters;
        scope.spawn(move || {
          for index in 0..25 {
            reporters.log(LogLevel::Info, &format!("{thread}-{index}"));
          }
        });
      }
    });

    let events = events.lock().unwrap();
    assert_eq!(events.len(), 100);
    for thread in 0..4 {
      let prefix = format!("log:info:{thread}-");
      let ordering: Vec<&String> = events.iter().filter(|e| e.starts_with(&prefix)).collect();
      let expected: Vec<String> = (0..25).map(|index| format!("{prefix}{index}")).collect();
      assert_eq!(ordering, expected.iter().collect::<Vec<&String>>());
    }
  }

  #[test]
  fn logs_below_the_log_level_are_never_queued() {
    let (recorder, events) = Recorder::new();
    let (reporters, _options) = setup(vec![recorder], LogLevel::Warn);

    reporters.log(LogLevel::Error, "shown");
    reporters.log(LogLevel::Warn, "shown");
    reporters.log(LogLevel::Info, "hidden");
    reporters.log(LogLevel::Verbose, "hidden");

    assert_eq!(
      *events.lock().unwrap(),
      ["log:error:shown", "log:warn:shown"]
    );
  }

  #[test]
  fn flush_waits_for_queued_events() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let slow = Arc::new(Recorder {
      events: events.clone(),
      panic_on: None,
      delay: Some(Duration::from_millis(20)),
    });
    let (reporters, _options) = setup(vec![slow], LogLevel::Verbose);

    for index in 0..5 {
      reporters.log(LogLevel::Info, &index.to_string());
    }

    assert_eq!(events.lock().unwrap().len(), 5);
  }

  #[test]
  fn a_build_with_no_reporters_discards_events() {
    let reporters = Reporters::none();
    reporters.build_start();
    reporters.log(LogLevel::Error, "nobody is listening");
    reporters.build_success(BuildSuccess {
      bundle_graph: &empty_bundle_graph(),
      changed_assets: &[],
      build_time: Duration::ZERO,
    });
  }

  #[test]
  fn log_level_filters_by_severity() {
    use LogLevel::*;

    for severity in [Error, Warn, Info, Verbose] {
      assert!(!LogLevel::None.allows(severity), "{severity} at None");
      assert!(LogLevel::Verbose.allows(severity), "{severity} at Verbose");
    }

    assert!(LogLevel::Error.allows(Error));
    assert!(!LogLevel::Error.allows(Warn));

    assert!(LogLevel::Warn.allows(Warn));
    assert!(!LogLevel::Warn.allows(Info));

    assert!(LogLevel::Info.allows(Info));
    assert!(!LogLevel::Info.allows(Verbose));
  }
}
