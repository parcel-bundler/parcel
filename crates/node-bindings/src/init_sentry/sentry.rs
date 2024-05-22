use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use napi::Error;
use napi::Result;
use napi::Status;
use napi_derive::napi;
use once_cell::sync::Lazy;
use sentry::configure_scope;
use sentry::init;
use sentry::ClientInitGuard;
use serde_json::Value;
use whoami::username;

static SENTRY_GUARD: Lazy<Arc<Mutex<Option<ClientInitGuard>>>> =
  Lazy::new(|| Arc::new(Mutex::new(None)));
const TIMEOUT: Duration = Duration::from_secs(2);

#[napi]
fn init_sentry() -> Result<(), Status> {
  if std::env::var("PARCEL_ENABLE_SENTRY").is_err() {
    return Ok(());
  }

  log::info!("Initialising Sentry in rust...");

  if SENTRY_GUARD.lock().is_some() {
    return Err(Error::from_reason(
      "Sentry guard already set, should only initialise Sentry once.",
    ));
  }

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

  SENTRY_GUARD.lock().replace(guard);

  sentry::configure_scope(|scope| {
    scope.set_user(Some(sentry::User {
      username: Some(username()),
      ..Default::default()
    }));
  });

  for (key, val) in sentry_tags {
    configure_scope(|scope| scope.set_tag(&key, val));
  }
  log::info!("Parcel Sentry for rust setup done!");
  return Ok(());
}

#[napi]
fn close_sentry() {
  if let Some(guard) = SENTRY_GUARD.lock().take() {
    guard.close(Some(TIMEOUT));
  }
}
