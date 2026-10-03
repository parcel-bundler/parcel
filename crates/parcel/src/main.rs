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

#[derive(Clone, Copy, Debug, PartialEq)]
enum Command {
  Build,
  Serve,
  Watch,
  Run,
  Targets,
  Help,
}

impl Command {
  fn parse(name: &str) -> Result<Self, String> {
    match name {
      "build" => Ok(Self::Build),
      "serve" => Ok(Self::Serve),
      "watch" => Ok(Self::Watch),
      "run" => Ok(Self::Run),
      "targets" => Ok(Self::Targets),
      "help" => Ok(Self::Help),
      _ => Err(format!("Unknown command {name}")),
    }
  }

  fn name(self) -> &'static str {
    match self {
      Self::Build => "build",
      Self::Serve => "serve",
      Self::Watch => "watch",
      Self::Run => "run",
      Self::Targets => "targets",
      Self::Help => "help",
    }
  }
}

fn help(command: Option<Command>) -> String {
  if command == Some(Command::Help) {
    return "Usage: parcel help [command]\n\nShow help for all commands or a specific command.\n"
      .into();
  }
  let mut help = match command {
    Some(command) => format!("Usage: parcel {} [entries...] [options]\n", command.name()),
    None => String::from(concat!(
      "Usage: parcel <command> [entries...] [options]\n",
      "\nCommands:\n",
      "  build             Build for production\n",
      "  serve             Start a development server\n",
      "  watch             Rebuild when files change\n",
      "  run               Build and run a Node.js entry\n",
      "  targets           Show resolved entries and targets\n",
      "  help [command]    Show help for all commands or a specific command\n",
    )),
  };
  help.push_str(concat!(
    "\nEntries default to the current working directory.\n",
    "\nOptions:\n",
    "  --config <file>       Use a Parcel configuration file\n",
    "  --optimize            Enable optimization\n",
    "  --no-optimize         Disable optimization\n",
    "  --no-content-hash     Disable content hashes in bundle names\n",
    "  --no-source-maps      Disable source maps\n",
    "  --dist-dir <dir>      Set the output directory\n",
    "  --public-url <url>    Set the public URL for bundles\n",
    "  --log-level <level>   none, error, warn, info, verbose (default: verbose)\n",
    "  -h, --help            Show help\n",
  ));
  if command.is_none() || command == Some(Command::Serve) {
    help.push_str(concat!(
      "\nServer options (serve):\n",
      "  -p, --port <port>     Set the port (default: PORT environment variable or 1234)\n",
      "  --host <host>         Set the host (default: 0.0.0.0)\n",
      "  --no-hmr              Disable hot module replacement\n",
    ));
  }
  help
}

enum CliAction {
  Help(Option<Command>),
  Run {
    command: Command,
    entries: Vec<String>,
    options: BuildOptions,
    server_options: ServerOptions,
  },
}

fn parse_args(
  mut args: impl Iterator<Item = String>,
  mut env: HashMap<String, String>,
  cwd: PathId,
) -> Result<CliAction, String> {
  let Some(command) = args.next() else {
    return Ok(CliAction::Help(None));
  };
  if matches!(command.as_str(), "help" | "--help" | "-h") {
    let command = args.next().map(|name| Command::parse(&name)).transpose()?;
    if let Some(arg) = args.next() {
      return Err(format!("Unexpected argument {arg}"));
    }
    return Ok(CliAction::Help(command));
  }
  let command = Command::parse(&command)?;

  let mode = match command {
    Command::Build => parcel_core::BuildMode::Production,
    _ => parcel_core::BuildMode::Development,
  };

  if !env.contains_key("NODE_ENV") {
    env.insert(
      "NODE_ENV".into(),
      if mode == parcel_core::BuildMode::Production {
        "production".into()
      } else {
        "development".into()
      },
    );
  }

  let mut server_options = ServerOptions::default();
  let mut options = BuildOptions {
    env,
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: Arc::new(OsFileSystem {}),
    log_level: LogLevel::Verbose,
    mode,
    optimize: None,
    content_hash: None,
    config: None,
    source_map: Some(Default::default()),
    cwd,
    dist_dir: None,
    public_url: Default::default(),
    hmr: None,
    reporters: vec![Arc::new(CLIReporter {})],
  };

  let mut entries = Vec::new();
  let mut port_provided = false;
  while let Some(arg) = args.next() {
    if arg.starts_with('-') {
      match arg.as_str() {
        "--help" | "-h" => return Ok(CliAction::Help(Some(command))),
        "--" => {
          entries.extend(args);
          break;
        }
        "--config" => {
          let config = argument_value(&arg, &mut args)?;
          if !cwd.join(Path::new(&config)).to_path_buf().is_file() {
            return Err(format!(
              "Config file {config} does not exist or is not a file"
            ));
          }
          options.config = Some(config);
        }
        "--no-optimize" => {
          options.optimize = Some(false);
        }
        "--optimize" => {
          options.optimize = Some(true);
        }
        "--no-content-hash" => {
          options.content_hash = Some(false);
        }
        "--port" | "-p" => {
          let port = argument_value(&arg, &mut args)?;
          server_options.port = parse_port(&port, &arg)?;
          port_provided = true;
        }
        "--host" => {
          server_options.host = Cow::Owned(argument_value(&arg, &mut args)?);
        }
        "--no-hmr" => {
          server_options.hmr = false;
        }
        "--no-source-maps" => {
          options.source_map = None;
        }
        "--dist-dir" => {
          options.dist_dir = Some(cwd.join(Path::new(&argument_value(&arg, &mut args)?)));
        }
        "--public-url" => {
          options.public_url = argument_value(&arg, &mut args)?;
        }
        "--log-level" => {
          let level = argument_value(&arg, &mut args)?;
          options.log_level = match level.as_str() {
            "none" => LogLevel::None,
            "error" => LogLevel::Error,
            "warn" => LogLevel::Warn,
            "info" => LogLevel::Info,
            "verbose" => LogLevel::Verbose,
            _ => {
              return Err(format!(
                "Invalid log level {level}. Expected none, error, warn, info, or verbose"
              ));
            }
          };
        }
        arg => {
          return Err(format!("Unknown argument {arg}"));
        }
      }
    } else {
      entries.push(arg);
    }
  }

  if entries.is_empty() {
    entries.push(".".into());
  }

  if command == Command::Serve {
    if !port_provided {
      if let Some(port) = options.env.get("PORT") {
        server_options.port = parse_port(port, "PORT")?;
      }
    }
    if server_options.hmr {
      options.hmr = Some(HmrOptions {
        host: server_options.host.clone(),
        port: server_options.port,
      });
    }
  }

  Ok(CliAction::Run {
    command,
    entries,
    options,
    server_options,
  })
}

fn argument_value(arg: &str, args: &mut impl Iterator<Item = String>) -> Result<String, String> {
  args
    .next()
    .filter(|value| !value.starts_with('-'))
    .ok_or_else(|| format!("Missing value for {arg}"))
}

fn parse_port(port: &str, source: &str) -> Result<u16, String> {
  port
    .parse()
    .map_err(|_| format!("Invalid port {port} for {source}. Expected a number from 0 to 65535"))
}

pub fn main() -> ExitCode {
  let cwd = match std::env::current_dir() {
    Ok(cwd) => PathId::new(&cwd),
    Err(error) => {
      eprintln!("Could not determine the current working directory: {error}");
      return ExitCode::FAILURE;
    }
  };
  let action = match parse_args(std::env::args().skip(1), std::env::vars().collect(), cwd) {
    Ok(action) => action,
    Err(error) => {
      eprint!("{error}\n\n{}", help(None));
      return ExitCode::FAILURE;
    }
  };
  let CliAction::Run {
    command,
    entries,
    options,
    server_options,
  } = action
  else {
    if let CliAction::Help(command) = action {
      print!("{}", help(command));
    }
    return ExitCode::SUCCESS;
  };

  let res = match command {
    Command::Help => {
      print!("{}", help(None));
      return ExitCode::SUCCESS;
    }
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
    options: &parcel_core::ParcelOptions,
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
      ReporterEvent::BuildSuccess(BuildSuccess { build_time, .. })
        if options.log_level.allows(LogLevel::Info) =>
      {
        let style = Style::new()
          .fg_color(Some(Color::Ansi(AnsiColor::BrightGreen)))
          .bold();
        println!("{style}✨ Built in {:?}{style:#}", build_time);
      }
      ReporterEvent::BuildFailure { diagnostics } if options.log_level.allows(LogLevel::Error) => {
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
