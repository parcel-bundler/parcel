use anstyle::{AnsiColor, Color, Style};
use parcel::ServerOptions;
use parcel_core::{
  BuildOptions, BuildSuccess, HmrOptions, LogEvent, LogLevel, LogMessage, OsFileSystem, PathId,
  Reporter, ReporterEvent,
};
use std::borrow::Cow;
use std::io::Write;
use std::path::Path;
use std::process::ExitCode;
use std::{collections::HashMap, sync::Arc};

#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

enum Command {
  Build,
  Serve,
  Watch,
  Run,
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
      "run" => Command::Run,
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

  let mut server_options = ServerOptions::default();
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
    hmr: None,
    reporters: vec![Arc::new(CLIReporter {})],
  };

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
          options.dist_dir = args.next().map(|p| options.cwd.join(Path::new(&p)));
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

  if matches!(cmd, Command::Serve) {
    options.hmr = Some(HmrOptions {
      host: server_options.host.clone(),
      port: server_options.port,
    });
  }

  let res = match cmd {
    Command::Build => parcel::build(&entries, options).map(|_| ()),
    Command::Watch => parcel::watch(&entries, options),
    Command::Serve => parcel::serve(&entries, options, server_options),
    Command::Run => parcel::run(&entries, options),
    Command::Targets => {
      let entries = parcel_core::resolve_entries(&entries, &options).unwrap();
      println!("{:#?}", entries);
      return ExitCode::from(0);
    }
  };

  if res.is_ok() {
    ExitCode::SUCCESS
  } else {
    ExitCode::FAILURE
  }
}

struct CLIReporter;

impl Reporter for CLIReporter {
  fn report(
    &self,
    event: &parcel_core::ReporterEvent,
    _options: &parcel_core::ParcelOptions,
  ) -> Result<(), parcel_core::DiagnosticList> {
    match event {
      ReporterEvent::Log(LogEvent {
        level,
        message: LogMessage::Text(log),
      }) => {
        let mut stdio = stdio(level);
        writeln!(&mut stdio, "{}", log)?;
      }
      ReporterEvent::Log(LogEvent {
        level,
        message: LogMessage::Diagnostics(diagnostics),
      }) => {
        let mut stdio = stdio(level);
        for diagnostic in *diagnostics {
          writeln!(&mut stdio)?;
          diagnostic.report(&mut stdio)?;
        }
        writeln!(&mut stdio)?;
      }
      ReporterEvent::BuildSuccess(BuildSuccess { build_time, .. }) => {
        let style = Style::new()
          .fg_color(Some(Color::Ansi(AnsiColor::BrightGreen)))
          .bold();
        println!("{style}✨ Built in {:?}{style:#}", build_time);
      }
      ReporterEvent::BuildFailure { diagnostics } => {
        let style = Style::new()
          .fg_color(Some(Color::Ansi(AnsiColor::Red)))
          .bold();
        println!("{style}🚨 Build failed.{style:#}\n");
        let mut stderr = std::io::stderr();
        diagnostics.report(&mut stderr).unwrap();
      }
      _ => {}
    }

    Ok(())
  }
}

fn stdio(level: &LogLevel) -> either::Either<std::io::Stderr, std::io::Stdout> {
  match level {
    LogLevel::Error | LogLevel::Warn => either::Either::Left(std::io::stderr()),
    _ => either::Either::Right(std::io::stdout()),
  }
}
