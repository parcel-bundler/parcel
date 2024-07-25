use anyhow::anyhow;
use napi_derive::napi;

/// JavaScript provided options to configure the `tracing_subscriber` rust logs into a file or the
/// console.
#[napi(object)]
pub struct ParcelTracingOptions {
  /// Enable tracing
  pub enabled: bool,
  /// If set to some, will trace to a file with the given options, otherwise the console will be
  /// used.
  pub output_file_options: Option<ParcelTracingOutputFileOptions>,
}

impl Default for ParcelTracingOptions {
  fn default() -> Self {
    Self {
      enabled: false,
      output_file_options: Some(ParcelTracingOutputFileOptions {
        directory: std::env::temp_dir().to_string_lossy().to_string(),
        prefix: "parcel-tracing".to_string(),
        max_files: 4,
      }),
    }
  }
}

/// Output file configuration.
/// Tracing log files will be rotated hourly on the provided directory.
#[napi(object)]
pub struct ParcelTracingOutputFileOptions {
  /// The directory where the log files will be written.
  pub directory: String,
  /// A prefix for the log file names.
  pub prefix: String,
  /// The maximum number of rotated files to keep.
  pub max_files: u32,
}

/// This is a guard, when it's dropped certain resources related to tracing might flush to disk or
/// be released. It should be kept alive for the duration of the program.
pub struct ParcelTracingGuard {
  guard: Option<tracing_appender::non_blocking::WorkerGuard>,
}

/// Set-up tracing based on JavaScript provided options and return a guard.
pub fn setup_tracing(options: &Option<ParcelTracingOptions>) -> anyhow::Result<ParcelTracingGuard> {
  let default_options = Default::default();
  let options = options.as_ref().unwrap_or(&default_options);
  if !options.enabled {
    return Ok(ParcelTracingGuard { guard: None });
  }

  if let Some(output_file_options) = &options.output_file_options {
    let file_appender = tracing_appender::rolling::Builder::new()
      .rotation(tracing_appender::rolling::Rotation::HOURLY)
      .max_log_files(output_file_options.max_files as usize)
      .filename_prefix(&output_file_options.prefix)
      .build(&output_file_options.directory)?;
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::fmt()
      .with_writer(non_blocking)
      .try_init()
      .map_err(|err| anyhow!(err).context("Failed to setup file tracing"))?;
    Ok(ParcelTracingGuard { guard: Some(guard) })
  } else {
    tracing_subscriber::fmt()
      .try_init()
      .map_err(|err| anyhow!(err).context("Failed to setup tracing"))?;
    Ok(ParcelTracingGuard { guard: None })
  }
}
