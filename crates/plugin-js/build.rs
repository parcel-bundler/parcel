use std::process::Command;

fn main() {
  Command::new("node")
    .arg("buildBuiltins.cjs")
    .spawn()
    .expect("Builtins failed");
}
