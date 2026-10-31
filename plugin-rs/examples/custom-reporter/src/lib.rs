use std::sync::atomic::{AtomicUsize, Ordering};

use parcel_plugin::{
  BuildFailure, BuildSuccess, Diagnostic, Diagnostics, Log, Options, Plugin, register_plugin,
};

struct CustomReporter {
  builds: AtomicUsize,
}

impl Plugin for CustomReporter {
  fn new(_config: &[u8]) -> Result<Self, Diagnostic> {
    Ok(CustomReporter {
      builds: AtomicUsize::new(0),
    })
  }

  fn build_start(&self, _options: &Options) -> Result<(), Diagnostic> {
    let build = self.builds.fetch_add(1, Ordering::Relaxed) + 1;
    println!("build {build} starting");
    Ok(())
  }

  fn build_success(&self, event: &BuildSuccess, _options: &Options) -> Result<(), Diagnostic> {
    println!(
      "built {} bundles in {:?} ({} assets changed)",
      event.bundle_graph.bundle_count(),
      event.build_time,
      event.changed_assets.len()
    );
    Ok(())
  }

  fn build_failure(&self, event: &BuildFailure, options: &Options) -> Result<(), Diagnostic> {
    let summary = summarize(&event.diagnostics);
    // Written to a file when the build's environment names one, e.g. for CI.
    match options.env("REPORT_SUMMARY") {
      Some(path) => std::fs::write(path, summary)
        .map_err(|error| Diagnostic::new(format!("could not write the summary: {error}")))?,
      None => print!(
        "build failed with {} diagnostics:\n{summary}",
        event.diagnostics.len()
      ),
    }
    Ok(())
  }

  fn log(&self, event: &Log, _options: &Options) -> Result<(), Diagnostic> {
    let level = event.level;
    if let Some(message) = event.message {
      println!("[{level:?}] {message}");
    }
    for diagnostic in event.diagnostics.iter().flat_map(|d| d.iter()) {
      println!("[{level:?}] {}", diagnostic.message());
    }
    Ok(())
  }
}

/// Describes each diagnostic, with where it points and what to read about it.
fn summarize(diagnostics: &Diagnostics) -> String {
  let mut summary = String::new();
  for diagnostic in diagnostics.iter() {
    summary += &format!("message: {}\n", diagnostic.message());
    if let Some(url) = diagnostic.documentation_url() {
      summary += &format!("docs: {url}\n");
    }
    for frame in diagnostic.code_frames() {
      summary += &format!(
        "frame: {} {}\n",
        frame.file_path.or(frame.url).unwrap_or_default(),
        frame.language.unwrap_or_default()
      );
      for highlight in frame.highlights {
        summary += &format!(
          "highlight: {}:{}-{}:{} {}\n",
          highlight.start_line,
          highlight.start_column,
          highlight.end_line,
          highlight.end_column,
          highlight.message.unwrap_or_default()
        );
      }
    }
  }
  summary
}

register_plugin!(CustomReporter);
