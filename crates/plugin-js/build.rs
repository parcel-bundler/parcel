use std::process::Command;

fn main() {
  let status = Command::new("node")
    .arg("buildBuiltins.cjs")
    .status()
    .expect("Failed to run buildBuiltins.cjs");
  assert!(status.success(), "buildBuiltins.cjs exited with {status}");
}
