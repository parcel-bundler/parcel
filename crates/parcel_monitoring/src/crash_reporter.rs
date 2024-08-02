//! This module crash reporting with [`minidumper`].
//!
//! This is disabled by default.
use std::time::Duration;

use anyhow::anyhow;
use crash_handler::CrashHandler;
use minidumper::Client;

use crate::from_env::{optional_var, required_var, FromEnvError};

#[derive(Debug)]
pub struct CrashReporterOptions {
  pub minidumper_server_socket_name: String,
  pub minidumper_server_pid: u32,
}

impl CrashReporterOptions {
  pub fn from_env() -> Result<Option<Self>, FromEnvError> {
    if optional_var("PARCEL_ENABLE_MINIDUMPER").is_none() {
      return Ok(None);
    }

    let minidumper_server_pid_var = String::from("PARCEL_MINIDUMPER_SERVER_PID_FILE");

    let pid_file = required_var(&minidumper_server_pid_var)?;
    let server_pid_string = std::fs::read_to_string(&pid_file).map_err(|err| {
      tracing::error!("Failed to read server PID");
      FromEnvError::InvalidKey(
        minidumper_server_pid_var.clone(),
        anyhow!("Failed to read server PID file: {}", err),
      )
    })?;
    let server_pid = server_pid_string.parse().map_err(|err| {
      tracing::error!("Invalid PID on pid file");
      FromEnvError::InvalidKey(
        minidumper_server_pid_var,
        anyhow!("Invalid PID on minidumper pid file: {}", err),
      )
    })?;

    Ok(Some(Self {
      minidumper_server_socket_name: required_var("PARCEL_MINIDUMPER_SERVER_SOCKET_NAME")?,
      minidumper_server_pid: server_pid,
    }))
  }
}

/// Initializes crash_reporter for error monitoring. This will report crashes to a supervisor
/// process.
pub fn init_crash_reporter(options: CrashReporterOptions) -> anyhow::Result<CrashHandler> {
  let client = try_to_connect_to_server(&options)
      .map_err(|err| {
        tracing::error!(
      "Failed to connect to socket {}, the supervisor is not running: {}",
      options.minidumper_server_socket_name,
      err
    );
        anyhow!(
      "Failed to connect to PARCEL_MINIDUMPER_SERVER_SOCKET_NAME, the supervisor is not running: {}",
      err
    )
      })?;

  let handler = CrashHandler::attach(unsafe {
    // TODO: Send more data on a subsequent message.
    crash_handler::make_crash_event(move |crash_context: &crash_handler::CrashContext| {
      // Before we request the crash, send a message to the server
      client.send_message(2, "process_crashed").unwrap();

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
    handler.set_ptracer(Some(options.minidumper_server_pid));
  }

  Ok(handler)
}

/// Attempt to connect to the server waiting 1s in between attempts
fn try_to_connect_to_server(options: &CrashReporterOptions) -> anyhow::Result<Client> {
  let mut remaining_attempts = 10;
  let client = loop {
    remaining_attempts -= 1;
    let socket_name = &options.minidumper_server_socket_name;
    tracing::debug!(%socket_name, %remaining_attempts, "Attempting to connect to minidumper server");
    let result = Client::with_name(socket_name);

    match result {
      Ok(client) => {
        break client;
      }
      Err(err) => {
        if remaining_attempts == 0 {
          return Err(anyhow!(err));
        }
      }
    }

    std::thread::sleep(Duration::from_secs(1));
  };
  Ok(client)
}

#[cfg(test)]
mod test {
  use std::env::temp_dir;

  use super::*;

  static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

  #[test]
  fn test_crash_reporter_set_to_none() {
    let _guard = TEST_LOCK.lock();
    std::env::remove_var("PARCEL_ENABLE_MINIDUMPER");
    let options = CrashReporterOptions::from_env().unwrap();
    assert!(options.is_none());
  }

  #[test]
  fn test_crash_reporter_server_pid_file_missing() {
    let _guard = TEST_LOCK.lock();
    std::env::set_var("PARCEL_ENABLE_MINIDUMPER", "1");
    std::env::remove_var("PARCEL_MINIDUMPER_SERVER_PID_FILE");
    let options = CrashReporterOptions::from_env();
    assert!(matches!(options, Err(FromEnvError::MissingKey(_, _))));
  }

  #[test]
  fn test_crash_reporter_server_pid_file_does_not_exist() {
    let _guard = TEST_LOCK.lock();
    std::env::set_var("PARCEL_ENABLE_MINIDUMPER", "1");
    std::env::set_var("PARCEL_MINIDUMPER_SERVER_PID_FILE", "does not exist");
    let options = CrashReporterOptions::from_env();
    assert!(matches!(options, Err(FromEnvError::InvalidKey(_, _))));
  }

  #[test]
  fn test_crash_reporter_server_pid_does_not_have_valid_contents() {
    let _guard = TEST_LOCK.lock();
    let pid_file = temp_dir().join("minidumper-test.pid");
    std::fs::write(&pid_file, "invalid").unwrap();
    std::env::set_var("PARCEL_ENABLE_MINIDUMPER", "1");
    std::env::set_var("PARCEL_MINIDUMPER_SERVER_PID_FILE", pid_file);
    std::env::set_var("PARCEL_MINIDUMPER_SERVER_SOCKET_NAME", "socket");
    let options = CrashReporterOptions::from_env();

    assert!(matches!(options, Err(FromEnvError::InvalidKey(_, _))));
  }

  #[test]
  fn test_crash_reporter_socket_var_missing() {
    let _guard = TEST_LOCK.lock();
    let pid_file = temp_dir().join("minidumper-test.pid");
    std::fs::write(&pid_file, "1234").unwrap();
    std::env::set_var("PARCEL_ENABLE_MINIDUMPER", "1");
    std::env::set_var("PARCEL_MINIDUMPER_SERVER_PID_FILE", pid_file);
    std::env::remove_var("PARCEL_MINIDUMPER_SERVER_SOCKET_NAME");
    let options = CrashReporterOptions::from_env();

    assert!(matches!(options, Err(FromEnvError::MissingKey(_, _))));
  }

  #[test]
  fn test_crash_reporter_server_pid_file_valid() {
    let _guard = TEST_LOCK.lock();
    let pid_file = temp_dir().join("minidumper-test.pid");
    std::fs::write(&pid_file, "1234").unwrap();
    std::env::set_var("PARCEL_ENABLE_MINIDUMPER", "1");
    std::env::set_var("PARCEL_MINIDUMPER_SERVER_PID_FILE", pid_file);
    std::env::set_var("PARCEL_MINIDUMPER_SERVER_SOCKET_NAME", "socket");
    let options = CrashReporterOptions::from_env().unwrap().unwrap();

    assert_eq!(options.minidumper_server_pid, 1234);
    assert_eq!(options.minidumper_server_socket_name, "socket");
  }
}
