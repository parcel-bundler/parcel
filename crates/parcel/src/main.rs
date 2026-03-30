use parcel_core::{BuildOptions, OsFileSystem};
use std::{collections::HashMap, sync::Arc};

enum Command {
  Build,
  Serve,
  Watch,
  Targets,
}

pub fn main() {
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
  };

  let mut entries = Vec::new();
  for arg in args {
    if arg.starts_with("--") {
      // TODO
    } else {
      entries.push(arg);
    }
  }

  match cmd {
    Command::Build => {
      parcel::build(entries, options).unwrap();
    }
    Command::Watch => {
      parcel::watch(entries, options);
    }
    Command::Serve => {
      parcel::serve(entries, options);
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
}
