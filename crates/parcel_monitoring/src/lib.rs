//! This module configures tracing/sentry/crash-reporting.
//!
//! They are all disabled by default.
//!
//! Reporting should only be initialized once.
use std::sync::Mutex;
use std::time::Duration;

#[cfg(feature = "canary")]
pub use crash_reporter::CrashReporterOptions;
#[cfg(feature = "canary")]
pub use sentry_integration::SentryOptions;
pub use tracer::TracerMode;

#[cfg(feature = "canary")]
mod crash_reporter;
mod from_env;
#[cfg(feature = "canary")]
mod sentry_integration;
mod tracer;

pub static MONITORING_GUARD: Mutex<Option<MonitoringGuard>> = Mutex::new(None);

#[derive(Default)]
pub struct MonitoringGuard {
  #[cfg(feature = "canary")]
  sentry: Option<sentry::ClientInitGuard>,
  #[cfg(feature = "canary")]
  crash_handler: Option<crash_handler::CrashHandler>,
  tracer: Option<tracer::Tracer>,
}

impl MonitoringGuard {
  #[cfg(feature = "canary")]
  pub fn crash_handler(&self) -> Option<&crash_handler::CrashHandler> {
    self.crash_handler.as_ref()
  }
}

#[derive(Debug)]
pub struct MonitoringOptions {
  pub tracing_options: Option<TracerMode>,
  #[cfg(feature = "canary")]
  pub sentry_options: Option<SentryOptions>,
  #[cfg(feature = "canary")]
  pub crash_reporter_options: Option<CrashReporterOptions>,
}

impl MonitoringOptions {
  pub fn from_env() -> Result<Self, from_env::FromEnvError> {
    Ok(Self {
      tracing_options: TracerMode::from_env()?,
      #[cfg(feature = "canary")]
      sentry_options: SentryOptions::from_env()?,
      #[cfg(feature = "canary")]
      crash_reporter_options: CrashReporterOptions::from_env()?,
    })
  }
}

pub fn initialize_monitoring(options: MonitoringOptions) -> anyhow::Result<()> {
  let mut global = MONITORING_GUARD.lock().unwrap();
  if global.is_some() {
    tracing::warn!("Monitoring is getting set-up twice, this will no-op");
    return Ok(());
  }

  let mut guard = MonitoringGuard::default();
  // TODO: Too complicated. Tracing should be set-up at the very top and be easy to understand
  if let Some(tracing_options) = options.tracing_options {
    guard.tracer = Some(tracer::Tracer::new(tracing_options)?);
  }
  #[cfg(feature = "canary")]
  if let Some(sentry_options) = options.sentry_options {
    guard.sentry = Some(sentry_integration::init_sentry(sentry_options)?);
  }
  #[cfg(feature = "canary")]
  if let Some(crash_reporter_options) = options.crash_reporter_options {
    guard.crash_handler = Some(crash_reporter::init_crash_reporter(crash_reporter_options)?);
  }

  *global = Some(guard);

  Ok(())
}

pub fn initialize_from_env() -> anyhow::Result<()> {
  initialize_monitoring(MonitoringOptions::from_env()?)
}

/// We will block exiting the process for this period to try to flush metrics.
#[allow(unused)]
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

pub fn close_monitoring() {
  let Some(monitoring_guard) = MONITORING_GUARD.lock().unwrap().take() else {
    return;
  };

  #[cfg(feature = "canary")]
  if let Some(sentry_guard) = &monitoring_guard.sentry {
    tracing::debug!("Flushing sentry events");
    sentry_guard.close(Some(CLOSE_TIMEOUT));
  }

  drop(monitoring_guard);
}
