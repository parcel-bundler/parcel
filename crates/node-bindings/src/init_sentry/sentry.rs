use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
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

fn get_tag(sentry_tags: HashMap<String, Value>, tag: String) -> Option<&Value> {
  let tag_ref = &tag;
  return sentry_tags.get(tag_ref);
}

fn value_to_string(value: &serde_json::Value) -> String {
  match value {
    serde_json::Value::String(inner) => inner.clone(),
    other => other.to_string(),
  }
}

#[napi]
fn init_sentry() -> Result<(), Status> {
  if std::env::var("PARCEL_ENABLE_SENTRY").is_err() {
    return Ok(());
  }

  log::info!("Initialising Sentry in rust...");

  if SENTRY_GUARD.lock().unwrap().is_some() {
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

  if let Some(release) = value_to_string(sentry_tags.get("release")) {
    sentry_client_options.release = Some(release.as_str().unwrap().into());
  }
  if let Some(environment) = value_to_string(sentry_tags.get("environment")) {
    sentry_client_options.environment = Some(environment.as_str().unwrap().into());
  }
  if let Some(debug) = sentry_tags.get("debug") {
    sentry_client_options.debug = debug.to_string() == "true";
  }

  let guard = init((sentry_dsn, sentry_client_options));

  SENTRY_GUARD.lock().unwrap().replace(guard);

  sentry::configure_scope(|scope| {
    scope.set_user(Some(sentry::User {
      username: Some(username()),
      ..Default::default()
    }));
  });

  for (key, val) in sentry_tags {
    configure_scope(|scope| scope.set_tag(&key, value_to_string(&val)));
  }
  log::info!("Parcel Sentry for rust setup done!");
  panic!("test, please ignore");
  return Ok(());
}

#[napi]
fn close_sentry() {
  if let Some(guard) = SENTRY_GUARD.lock().unwrap().take() {
    guard.close(Some(TIMEOUT));
  }
}
