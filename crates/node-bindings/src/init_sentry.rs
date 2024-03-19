use napi_derive::napi;
use once_cell::sync::Lazy;
use sentry::{init, ClientInitGuard};
use std::{
  sync::{Arc, Mutex},
  time::Duration,
};
use whoami::username;

static SENTRY_GUARD: Lazy<Arc<Mutex<Option<ClientInitGuard>>>> =
  Lazy::new(|| Arc::new(Mutex::new(None)));
const TIMEOUT: Duration = Duration::from_secs(2);

#[napi]
fn init_sentry(release: napi::JsString) {
  if SENTRY_GUARD.lock().unwrap().is_some() {
    return;
  }

  let Ok(sentry_dsn) = std::env::var("PARCEL_SENTRY_DSN") else {
    return;
  };
  let release_utf8: napi::JsStringUtf8 = release.into_utf8().unwrap();
  let release_str: String = release_utf8.into_owned().unwrap();

  let guard = init((
    sentry_dsn,
    sentry::ClientOptions {
      release: Some(release_str.into()),
      debug: true,
      environment: Some("local".into()),
      ..Default::default()
    },
  ));
  SENTRY_GUARD.lock().unwrap().replace(guard);
  sentry::configure_scope(|scope| {
    scope.set_user(Some(sentry::User {
      username: Some(username()),
      ..Default::default()
    }));
  });
}

#[napi]
fn close_sentry() {
  if let Some(guard) = SENTRY_GUARD.lock().unwrap().take() {
    guard.close(Some(TIMEOUT));
  }
}
