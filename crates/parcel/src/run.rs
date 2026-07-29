use std::process::Command;

use parcel_core::PathId;

pub fn run_node(entry: PathId) {
  std::thread::spawn(move || {
    let command = Command::new("node")
      .arg("--watch")
      .arg(&*entry.to_path_buf().to_string_lossy())
      .spawn()
      .expect("node failed to start");
  });
}
