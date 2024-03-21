use napi_derive::napi;
use once_cell::sync::Lazy;
use querystring::querify;
use sentry::configure_scope;
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
fn init_sentry() {
  println!("Initialising Sentry in rust...");

  if SENTRY_GUARD.lock().unwrap().is_some() {
    println!("Sentry guard already set, skipping initialisation.");
    return;
  }

  let Ok(sentry_dsn) = std::env::var("PARCEL_SENTRY_DSN") else {
    println!("PARCEL_SENTRY_DSN environment variable not provided.");
    return;
  };

  let guard = init((
    sentry_dsn,
    sentry::ClientOptions {
      environment: Some("test".into()),
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

  if let Ok(sentry_tags_raw) = std::env::var("PARCEL_SENTRY_TAGS") {
    let url = querify(&sentry_tags_raw);
    for (key, val) in url.iter() {
      if *key == "" || *val == "" {
        continue;
      }
      configure_scope(|scope| scope.set_tag(key, val));
    }
  }
  println!("Parcel Sentry for rust setup done!");
  panic!("Please ignore");
}

#[napi]
fn close_sentry() {
  if let Some(guard) = SENTRY_GUARD.lock().unwrap().take() {
    guard.close(Some(TIMEOUT));
  }
}
