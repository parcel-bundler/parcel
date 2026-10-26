//! Tests of the `parcel run` CLI command, which runs the built Node entry in a child process.
#![cfg(unix)]

use std::{
  fs,
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  time::{Duration, Instant},
};

/// A project whose entry writes its process id to `pid` and then keeps running, like a server.
fn project(name: &str) -> PathBuf {
  let dir = std::env::temp_dir().join(format!("parcel-run-{name}-{}", std::process::id()));
  let _ = fs::remove_dir_all(&dir);
  fs::create_dir_all(&dir).unwrap();
  fs::write(
    dir.join("package.json"),
    r#"{"private": true, "engines": {"node": ">=18"}}"#,
  )
  .unwrap();
  fs::write(
    dir.join("index.js"),
    "require('fs').writeFileSync('pid', String(process.pid));\nsetInterval(() => {}, 1000);\n",
  )
  .unwrap();
  dir
}

fn run(dir: &Path) -> Child {
  Command::new(env!("CARGO_BIN_EXE_parcel"))
    .args(["run", "index.js", "--no-hmr"])
    .current_dir(dir)
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .unwrap()
}

/// Polls `condition` until it holds, panicking with `message` after a timeout.
fn wait_until(message: &str, mut condition: impl FnMut() -> bool) {
  let start = Instant::now();
  while !condition() {
    assert!(start.elapsed() < Duration::from_secs(30), "{message}");
    std::thread::sleep(Duration::from_millis(50));
  }
}

fn is_running(pid: libc::pid_t) -> bool {
  unsafe { libc::kill(pid, 0) == 0 }
}

fn stops_the_process_on(signal: libc::c_int, name: &str) {
  let dir = project(name);
  let pid_file = dir.join("pid");
  let mut parcel = run(&dir);

  wait_until("the entry never started", || pid_file.exists());
  let pid: libc::pid_t = fs::read_to_string(&pid_file).unwrap().parse().unwrap();
  assert!(is_running(pid));

  unsafe { libc::kill(parcel.id() as libc::pid_t, signal) };
  let status = parcel.wait().unwrap();
  // Parcel still exits the way the signal would have made it.
  assert_eq!(
    std::os::unix::process::ExitStatusExt::signal(&status),
    Some(signal)
  );
  wait_until("the entry kept running after Parcel exited", || {
    !is_running(pid)
  });

  let _ = fs::remove_dir_all(&dir);
}

#[test]
fn stops_the_process_on_sigterm() {
  stops_the_process_on(libc::SIGTERM, "sigterm");
}

#[test]
fn stops_the_process_on_sighup() {
  stops_the_process_on(libc::SIGHUP, "sighup");
}
