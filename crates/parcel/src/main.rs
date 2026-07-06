use parcel::ServerOptions;
use parcel_core::{BuildOptions, OsFileSystem, PathId};
use std::borrow::Cow;
use std::path::Path;
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
      _ => {
        eprintln!("Unknown command {}", cmd);
        return ExitCode::from(1);
      }
    },
  };

  let mode = match cmd {
    Command::Build => parcel_core::BuildMode::Production,
    _ => parcel_core::BuildMode::Development,
  };

  let mut env: HashMap<String, String> = std::env::vars().collect();
  env.insert(
    "NODE_ENV".into(),
    if mode == parcel_core::BuildMode::Production {
      "production".into()
    } else {
      "development".into()
    },
  );

  let mut options = BuildOptions {
    env,
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: Arc::new(OsFileSystem {}),
    log_level: parcel_core::LogLevel::Verbose,
    mode,
    optimize: None,
    config: None,
    source_map: Some(Default::default()),
    cwd: PathId::new(&std::env::current_dir().unwrap()),
    dist_dir: None,
    public_url: Default::default(),
  };

  let mut server_options = ServerOptions::default();

  let mut entries = Vec::new();
  while let Some(arg) = args.next() {
    if arg.starts_with('-') {
      match arg.as_str() {
        "--config" => {
          options.config = args.next();
        }
        "--no-optimize" => {
          options.optimize = Some(false);
        }
        "--optimize" => {
          options.optimize = Some(true);
        }
        "--port" | "-p" => {
          if let Some(port) = args.next() {
            server_options.port = port.parse().expect("invalid port");
          }
        }
        "--host" => {
          server_options.host = Cow::Owned(args.next().expect("invalid host"));
        }
        "--no-hmr" => {
          server_options.hmr = false;
        }
        "--no-source-maps" => {
          options.source_map = None;
        }
        "--dist-dir" => {
          options.dist_dir = args.next().map(|p| PathId::new(Path::new(&p)));
        }
        "--public-url" => {
          options.public_url = args.next().unwrap_or_default();
        }
        arg => {
          eprintln!("Unknown argument {}", arg);
          return ExitCode::from(1);
        }
      }
    } else {
      entries.push(arg);
    }
  }

  let res = match cmd {
    Command::Build => parcel::build(&entries, options).map(|_| ()),
    Command::Watch => parcel::watch(&entries, options),
    Command::Serve => parcel::serve(&entries, options, server_options),
    Command::Targets => {
      let entries = parcel_core::resolve_entries(&entries, &options).unwrap();
      println!("{:#?}", entries);
      return ExitCode::from(0);
    }
  };

  match res {
    Ok(_) => {}
    Err(err) => {
      let mut stderr = std::io::stderr();
      err.report(&mut stderr).unwrap();
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
