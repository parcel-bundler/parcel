//! This module configures `sentry` to report panics.
//!
//! Sentry is disabled by default.
use std::collections::HashMap;

use anyhow::anyhow;
use sentry::configure_scope;
use sentry::ClientInitGuard;
use serde_json::Value;
use whoami::username;

use crate::from_env::{optional_var, required_var, FromEnvError};

fn value_to_string(value: &Value) -> String {
  match value {
    Value::String(inner) => inner.clone(),
    other => other.to_string(),
  }
}

#[derive(Debug)]
pub struct SentryOptions {
  pub sentry_dsn: String,
  pub sentry_tags: HashMap<String, String>,
}

impl SentryOptions {
  pub fn from_env() -> Result<Option<SentryOptions>, FromEnvError> {
    if optional_var("PARCEL_ENABLE_SENTRY").is_none() {
      return Ok(None);
    }

    let sentry_tags = match optional_var("PARCEL_SENTRY_TAGS") {
      Some(tags_string) => {
        let sentry_tags =
          serde_json::from_str::<HashMap<String, Value>>(&tags_string).map_err(|err| {
            FromEnvError::InvalidKey(
              String::from("PARCEL_SENTRY_TAGS"),
              anyhow!("Invalid JSON on tags: {:#?}", err),
            )
          })?;
        let sentry_tags: HashMap<String, String> = sentry_tags
          .iter()
          .map(|(k, v)| (k.clone(), value_to_string(v)))
          .collect::<HashMap<String, String>>();

        sentry_tags
      }
      None => HashMap::new(),
    };

    Ok(Some(SentryOptions {
      sentry_dsn: required_var("PARCEL_SENTRY_DSN")?,
      sentry_tags,
    }))
  }
}

/// Initializes sentry for error monitoring. This will report panics.
pub fn init_sentry(options: SentryOptions) -> anyhow::Result<ClientInitGuard> {
  tracing::info!("Initialising Sentry in rust...");

  let mut sentry_client_options = sentry::ClientOptions {
    ..Default::default()
  };

  if let Some(release) = options.sentry_tags.get("release") {
    sentry_client_options.release = Some(release.to_string().into());
  }
  if let Some(environment) = options.sentry_tags.get("environment") {
    sentry_client_options.environment = Some(environment.to_string().into());
  }
  if let Some(debug) = options.sentry_tags.get("debug") {
    sentry_client_options.debug = debug.to_string() == "true";
  }

  let guard = sentry::init((options.sentry_dsn, sentry_client_options));

  configure_scope(|scope| {
    scope.set_user(Some(sentry::User {
      username: Some(username()),
      ..Default::default()
    }));
  });

  configure_scope(|scope| {
    for (key, val) in options.sentry_tags {
      scope.set_tag(&key, val);
    }
  });
  tracing::info!("Parcel Sentry for rust setup done!");

  Ok(guard)
}

#[cfg(test)]
mod test {
  use super::*;

  static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

  #[test]
  fn test_sentry_options_from_env_if_disabled_returns_none() {
    let _guard = TEST_LOCK.lock();
    std::env::remove_var("PARCEL_ENABLE_SENTRY");
    let options = SentryOptions::from_env().unwrap();
    assert!(options.is_none());
  }

  #[test]
  fn test_sentry_options_from_env_returns_some_if_dsn_is_set() {
    let _guard = TEST_LOCK.lock();
    std::env::set_var("PARCEL_ENABLE_SENTRY", "1");
    std::env::set_var("PARCEL_SENTRY_DSN", "1234");
    std::env::remove_var("PARCEL_SENTRY_TAGS");
    let options = SentryOptions::from_env().unwrap().expect("missing options");
    assert_eq!(options.sentry_dsn, "1234");
    assert_eq!(options.sentry_tags, HashMap::new());
  }

  #[test]
  fn test_sentry_options_from_env_parses_tags_properly() {
    let _guard = TEST_LOCK.lock();
    std::env::set_var("PARCEL_ENABLE_SENTRY", "1");
    std::env::set_var("PARCEL_SENTRY_DSN", "1234");
    std::env::set_var("PARCEL_SENTRY_TAGS", "{\"key\":\"value\"}");
    let options = SentryOptions::from_env().unwrap().expect("missing options");
    assert_eq!(options.sentry_dsn, "1234");
    assert_eq!(
      options.sentry_tags,
      HashMap::from([(String::from("key"), String::from("value"))])
    );
  }

  #[test]
  fn test_sentry_options_from_env_stringifies_non_string_tags() {
    let _guard = TEST_LOCK.lock();
    std::env::set_var("PARCEL_ENABLE_SENTRY", "1");
    std::env::set_var("PARCEL_SENTRY_DSN", "1234");
    std::env::set_var("PARCEL_SENTRY_TAGS", "{\"key\":1234,\"other\":[]}");
    let options = SentryOptions::from_env().unwrap().expect("missing options");
    assert_eq!(options.sentry_dsn, "1234");
    assert_eq!(
      options.sentry_tags,
      HashMap::from([
        (String::from("key"), String::from("1234")),
        (String::from("other"), String::from("[]")),
      ])
    );
  }

  #[test]
  fn test_sentry_options_from_env_fails_if_dsn_is_missing() {
    let _guard = TEST_LOCK.lock();
    std::env::set_var("PARCEL_ENABLE_SENTRY", "1");
    std::env::remove_var("PARCEL_SENTRY_DSN");
    std::env::set_var("PARCEL_SENTRY_TAGS", "{\"key\":1234,\"other\":[]}");
    let options = SentryOptions::from_env();
    assert!(options.is_err());
    assert!(matches!(options, Err(FromEnvError::MissingKey(_, _))));
  }

  #[test]
  fn test_sentry_options_from_env_fails_if_tags_are_invalid() {
    let _guard = TEST_LOCK.lock();
    std::env::set_var("PARCEL_ENABLE_SENTRY", "1");
    std::env::set_var("PARCEL_SENTRY_DSN", "1234");
    std::env::set_var("PARCEL_SENTRY_TAGS", "asdf");
    let options = SentryOptions::from_env();
    assert!(options.is_err());
    assert!(matches!(options, Err(FromEnvError::InvalidKey(_, _))));
  }
}
