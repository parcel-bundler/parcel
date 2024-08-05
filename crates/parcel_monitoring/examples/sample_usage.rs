//! This is https://github.com/EmbarkStudios/crash-handling/blob/e2891a4c6a8d43374ec63d791c7e6d42ff2e6545/minidumper/examples/diskwrite.rs

use minidumper::Server;

use parcel_monitoring::{
  initialize_monitoring, CrashReporterOptions, MonitoringOptions, MONITORING_GUARD,
};

const SOCKET_NAME: &str = "minidumper-example";

fn run_server() {
  let pid = std::process::id();
  tracing::info!(%pid, "Starting server");
  let mut server = Server::with_name(SOCKET_NAME).expect("Failed to create server");

  let shutdown = std::sync::atomic::AtomicBool::new(false);

  struct Handler;

  impl minidumper::ServerHandler for Handler {
    fn create_minidump_file(&self) -> Result<(std::fs::File, std::path::PathBuf), std::io::Error> {
      let dump_path = std::path::PathBuf::from("dumps/test.dmp");
      let pid = std::process::id();
      tracing::info!(%pid, ?dump_path, "Create minidump file");
      if let Some(dir) = dump_path.parent() {
        if !dir.try_exists()? {
          std::fs::create_dir_all(dir)?;
        }
      }
      let file = std::fs::File::create(&dump_path)?;
      Ok((file, dump_path))
    }

    fn on_minidump_created(
      &self,
      result: Result<minidumper::MinidumpBinary, minidumper::Error>,
    ) -> minidumper::LoopAction {
      match result {
        Ok(mut minidump_binary) => {
          use std::io::Write;
          let _ = minidump_binary.file.flush();
          let pid = std::process::id();
          tracing::info!(%pid, "Wrote minidump to disk");
        }
        Err(e) => {
          tracing::error!("Failed to write minidump: {:#}", e);
        }
      }

      // Tells the server to exit, which will in turn exit the process
      minidumper::LoopAction::Exit
    }

    fn on_message(&self, kind: u32, buffer: Vec<u8>) {
      let pid = std::process::id();
      tracing::info!(
        %pid,
        "Server process received message - kind: {kind}, message: {}",
        String::from_utf8(buffer).unwrap()
      );
    }
  }

  server
    .run(Box::new(Handler), &shutdown, None)
    .expect("Failed to run server");
}

fn main() {
  tracing_subscriber::FmtSubscriber::builder().init();
  let pid = std::process::id();

  if std::env::args().any(|a| a == "--server") {
    run_server();
    return;
  }

  let exe = std::env::current_exe().expect("Unable to find ourselves");
  let server = std::process::Command::new(exe)
    .arg("--server")
    .spawn()
    .expect("Unable to spawn server process");
  tracing::info!(%pid, "Waiting for server to start");

  initialize_monitoring(MonitoringOptions {
    sentry_options: None,
    tracing_options: None,
    crash_reporter_options: Some(CrashReporterOptions {
      minidumper_server_socket_name: SOCKET_NAME.to_string(),
      minidumper_server_pid: server.id(),
    }),
  })
  .expect("Failed to set-up monitoring");

  let monitoring_guard = MONITORING_GUARD.lock().unwrap();
  let handler = monitoring_guard.as_ref().unwrap().crash_handler().unwrap();

  tracing::info!(%pid, "Simulating crash");
  cfg_if::cfg_if! {
      if #[cfg(any(target_os = "linux", target_os = "android"))] {
          handler.simulate_signal(libc::SIGALRM as _);
      } else if #[cfg(windows)] {
          handler.simulate_exception(None);
      } else if #[cfg(target_os = "macos")] {
          handler.simulate_exception(None);
      }
  }
}
