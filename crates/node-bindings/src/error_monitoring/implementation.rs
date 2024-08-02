use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use crash_handler::CrashHandler;
use napi::bindgen_prelude::{block_on, execute_tokio_future};
use napi::Error;
use napi::Result;
use napi::Status;
use napi_derive::napi;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use sentry::configure_scope;
use sentry::init;
use sentry::ClientInitGuard;
use serde_json::Value;
use whoami::username;

struct MonitoringGuard {
  sentry: Option<ClientInitGuard>,
  crash_handler: Option<CrashHandler>,
}

static ERROR_MONITORING_GUARD: Lazy<Arc<Mutex<Option<MonitoringGuard>>>> =
  Lazy::new(|| Arc::new(Mutex::new(None)));
const TIMEOUT: Duration = Duration::from_secs(2);

fn value_to_string(value: &Value) -> String {
  match value {
    Value::String(inner) => inner.clone(),
    other => other.to_string(),
  }
}

#[napi]
fn init_error_monitoring() -> Result<(), Status> {
  if ERROR_MONITORING_GUARD.lock().is_some() {
    return Err(Error::from_reason(
      "Sentry guard already set, should only initialise Sentry once.",
    ));
  }

  let sentry_guard = init_sentry();
  let crash_handler_guard = init_crash_reporter();

  // We store either guard, even if one of them fails. This is so that error monitoring is set-up
  // on a best effort basis, as opposed to only working if both crash / sentry are properly
  // initialized.
  let sentry_error = sentry_guard.as_ref().err().cloned();
  let crash_handler_error = crash_handler_guard.as_ref().err().cloned();

  let error_monitoring_guard = ERROR_MONITORING_GUARD.lock();
  *error_monitoring_guard = Some(MonitoringGuard {
    sentry: sentry_guard.ok().flatten(),
    crash_handler: crash_handler_guard.ok().flatten(),
  });
  sentry_error?;
  crash_handler_error?;

  Ok(())
}

/// Initializes crash_reporter for error monitoring. This will report crashes to a supervisor
/// process.
fn init_crash_reporter() -> Result<Option<CrashHandler>, Status> {
  use minidumper::{Client, Server};

  // We will reuse the sentry environment variable to enable crash reporting.
  if std::env::var("PARCEL_ENABLE_MINIDUMPER").is_err() {
    return Ok(None);
  }

  let Ok(socket_name) = std::env::var("PARCEL_MINIDUMPER_SERVER_SOCKET_NAME") else {
    log::warn!("No PARCEL_MINIDUMPER_SERVER_SOCKET_NAME set, the process will not report crashes");
    return Ok(None);
  };
  let Ok(pid_file) = std::env::var("PARCEL_MINIDUMPER_SERVER_PID_FILE") else {
    log::warn!("No PARCEL_MINIDUMPER_SERVER_PID_FILE set, the process will not report crashes");
    return Ok(None);
  };

  let server_pid = std::fs::read_to_string(&pid_file)
    .map_err(|err| {
      log::error!("Failed to read server PID");
      Err(Error::from_reason("Failed to read server PID file"))
    })?
    .parse()
    .map_err(|err| {
      log::error!("Invalid PID on pid file");
      Err(Error::from_reason("Invalid PID on minidumper pid file"))
    })?;

  // Attempt to connect to the server
  let client = Client::with_name(&socket_name).map_err(|err| {
    log::error!(
      "Failed to connect to PARCEL_MINIDUMPER_SERVER_SOCKET_NAME, the supervisor is not running"
    );
    Err(Error::from_reason(
      "Failed to connect to PARCEL_MINIDUMPER_SERVER_SOCKET_NAME, the supervisor is not running",
    ))
  })?;

  let handler = CrashHandler::attach(unsafe {
    crash_handler::make_crash_event(move |crash_context: &crash_handler::CrashContext| {
      // Before we request the crash, send a message to the server
      client.send_message(2, "mistakes were made").unwrap();

      // Send a ping to the server, this ensures that all messages that have been sent
      // are "flushed" before the crash event is sent.
      // This is only really useful on macOS where messages and crash events are sent via different,
      // un-synchronized, methods which can result in the crash event closing the server before
      // the non-crash messages are received/processed
      client.ping().unwrap();

      crash_handler::CrashEventResult::Handled(client.request_dump(crash_context).is_ok())
    })
  })
  .expect("failed to attach signal handler");

  // Allow only the server process to inspect the
  // process we are monitoring (this one) for crashes
  #[cfg(target_os = "linux")]
  {
    handler.set_ptracer(Some(server_pid));
  }

  Ok(Some(handler))
}

/// Initializes sentry for error monitoring. This will report panics.
fn init_sentry() -> Result<Option<ClientInitGuard>> {
  if std::env::var("PARCEL_ENABLE_SENTRY").is_err() {
    return Ok(None);
  }

  log::info!("Initialising Sentry in rust...");

  let Ok(sentry_dsn) = std::env::var("PARCEL_SENTRY_DSN") else {
    return Err(Error::from_reason(
      "Sentry enable but PARCEL_SENTRY_DSN environment variable not provided.",
    ));
  };

  let sentry_tags = if let Ok(sentry_tags_raw) = std::env::var("PARCEL_SENTRY_TAGS") {
    let Ok(sentry_tags) = serde_json::from_str::<HashMap<String, Value>>(&sentry_tags_raw) else {
      return Err(Error::from_reason("PARCEL_SENTRY_TAGS not in JSON format."));
    };
    sentry_tags
  } else {
    HashMap::<String, Value>::new()
  };

  let mut sentry_client_options = sentry::ClientOptions {
    ..Default::default()
  };

  let sentry_tags: HashMap<String, String> = sentry_tags
    .iter()
    .map(|(k, v)| (k.clone(), value_to_string(v)))
    .collect::<HashMap<String, String>>();

  if let Some(release) = sentry_tags.get("release") {
    sentry_client_options.release = Some(release.to_string().into());
  }
  if let Some(environment) = sentry_tags.get("environment") {
    sentry_client_options.environment = Some(environment.to_string().into());
  }
  if let Some(debug) = sentry_tags.get("debug") {
    sentry_client_options.debug = debug.to_string() == "true";
  }

  let guard = init((sentry_dsn, sentry_client_options));

  configure_scope(|scope| {
    scope.set_user(Some(sentry::User {
      username: Some(username()),
      ..Default::default()
    }));
  });

  for (key, val) in sentry_tags {
    configure_scope(|scope| scope.set_tag(&key, val));
  }
  log::info!("Parcel Sentry for rust setup done!");

  Ok(Some(guard))
}

#[napi]
fn close_error_monitoring() {
  if let Some(guard) = ERROR_MONITORING_GUARD.lock().take() {
    block_on(async {
      if let Err(err) = guard.close(Some(TIMEOUT)).await {
        log::error!("Failed to flush sentry events: {:#?}", err);
      }
    });
  }
}
