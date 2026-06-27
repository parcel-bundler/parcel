use parcel_core::{BuildOptions, OsFileSystem, SourceUrl};
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

  let res = match cmd {
    Command::Build => parcel::build(&entries, options).map(|_| ()),
    Command::Watch => parcel::watch(&entries, options),
    Command::Serve => parcel::serve(&entries, options),
    Command::Targets => {
      let entries = parcel_core::resolve_entries(&entries, &options).unwrap();
      println!("{:#?}", entries);
      return ExitCode::from(0);
    }
  };

  match res {
    Ok(_) => {}
    Err(err) => {
      let mut paths = Vec::new();
      let cwd = parcel_core::PathId::new(&std::env::current_dir().unwrap());
      let fs = OsFileSystem {};
      for entry in entries {
        for path in parcel_core::glob(&fs, &entry, cwd) {
          paths.push(path);
        }
      }
      let project_root = SourceUrl::from_absolute_directory_path(
        &parcel_core::find_project_root(&fs, &paths, cwd).to_path_buf(),
      )
      .unwrap();

      let mut stderr = std::io::stderr();
      err.report(&mut stderr, &project_root).unwrap();
      return ExitCode::from(1);
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
