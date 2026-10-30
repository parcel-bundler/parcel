use std::sync::atomic::{AtomicUsize, Ordering};

use parcel_plugin::{Diagnostic, Diagnostics, Options, Plugin, ReportEvent, register_plugin};

struct CustomReporter {
  builds: AtomicUsize,
}

impl Plugin for CustomReporter {
  fn new(_config: &[u8]) -> Result<Self, Diagnostic> {
    Ok(CustomReporter {
      builds: AtomicUsize::new(0),
    })
  }

  fn report(&self, event: &ReportEvent, options: &Options) -> Result<(), Diagnostic> {
    match event {
      ReportEvent::BuildStart => {
        let build = self.builds.fetch_add(1, Ordering::Relaxed) + 1;
        println!("build {build} starting");
      }

      ReportEvent::BuildSuccess {
        bundle_graph,
        build_time,
        changed_assets,
        ..
      } => {
        println!(
          "built {} bundles in {:?} ({} assets changed)",
          bundle_graph.bundle_count(),
          build_time,
          changed_assets.len()
        );
      }

      ReportEvent::BuildFailure { diagnostics, .. } => {
        let summary = summarize(diagnostics);
        // Written to a file when the build's environment names one, e.g. for CI.
        match options.env("REPORT_SUMMARY") {
          Some(path) => std::fs::write(path, summary)
            .map_err(|error| Diagnostic::new(format!("could not write the summary: {error}")))?,
          None => print!(
            "build failed with {} diagnostics:\n{summary}",
            diagnostics.len()
          ),
        }
      }

      ReportEvent::Log {
        level,
        message,
        diagnostics,
        ..
      } => {
        if let Some(message) = message {
          println!("[{level:?}] {message}");
        }
        for diagnostic in diagnostics.iter().flat_map(|d| d.iter()) {
          println!("[{level:?}] {}", diagnostic.message());
        }
      }

      // An event added after this plugin was built.
      _ => {}
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
