use parcel_core::{BuildOptions, OsFileSystem};
use std::process::ExitCode;
use std::{collections::HashMap, sync::Arc};

#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

enum Command {
  Build,
  Serve,
  Watch,
  Targets,
}

pub fn main() -> ExitCode {
  let mut args = std::env::args().skip(1);
  let cmd = match args.next() {
    None => todo!(),
    Some(cmd) => match cmd.as_ref() {
      "build" => Command::Build,
      "serve" => Command::Serve,
      "watch" => Command::Watch,
      "targets" => Command::Targets,
      _ => todo!(),
    },
  };

  let mut entries = Vec::new();
  let mut config = None;
  while let Some(arg) = args.next() {
    if arg.starts_with("--") {
      match arg.as_str() {
        "--config" => {
          config = args.next();
        }
        _ => {}
      }
    } else {
      entries.push(arg);
    }
  }

  let mode = match cmd {
    Command::Build => parcel_core::BuildMode::Production,
    _ => parcel_core::BuildMode::Development,
  };
  let mut env = HashMap::new();
  env.insert(
    "NODE_ENV".into(),
    if mode == parcel_core::BuildMode::Production {
      "production".into()
    } else {
      "development".into()
    },
  );
  let options = BuildOptions {
    env,
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: Arc::new(OsFileSystem {}),
    log_level: parcel_core::LogLevel::Verbose,
    mode,
    config,
    cwd: std::env::current_dir().unwrap(),
  };

  match cmd {
    Command::Build => match parcel::build(entries, options) {
      Ok(_) => {}
      Err(err) => {
        let mut stderr = std::io::stderr();
        err.report(&mut stderr).unwrap();
        return ExitCode::from(1);
      }
    },
    Command::Watch => {
      let _ = parcel::watch(entries, options);
    }
    Command::Serve => {
      let _ = parcel::serve(entries, options);
    }
    Command::Targets => {
      let entries = parcel_core::resolve_entries(entries, &options).unwrap();
      println!("{:#?}", entries);
    }
  }

  // parcel::serve(
  //   // vec!["/Users/devongovett/dev/esbuild/require/parcel2/bench/three/entry.parcel2.js".into()],
  //   // vec!["/Users/devongovett/dev/parcel/test/index.html".into()],
  //   vec!["/Users/devongovett/dev/parcel/test/library".into()],
  //   options,
  // );
  ExitCode::from(0)
}
