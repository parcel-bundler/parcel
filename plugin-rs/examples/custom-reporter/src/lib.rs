use std::sync::atomic::{AtomicUsize, Ordering};

use parcel_plugin::{Diagnostic, Options, Plugin, ReportEvent, register_plugin};

struct CustomReporter {
  builds: AtomicUsize,
}

impl Plugin for CustomReporter {
  fn new(_config: &[u8]) -> Result<Self, Diagnostic> {
    Ok(CustomReporter {
      builds: AtomicUsize::new(0),
    })
  }

  fn report(&self, event: &ReportEvent, _options: &Options) -> Result<(), Diagnostic> {
    match event {
      ReportEvent::BuildStart => {
        let build = self.builds.fetch_add(1, Ordering::Relaxed) + 1;
        println!("build {build} starting");
      }

      ReportEvent::BuildSuccess {
        bundle_graph,
        build_time,
        changed_assets,
      } => {
        println!(
          "built {} bundles in {:?} ({} assets changed)",
          bundle_graph.bundle_count(),
          build_time,
          changed_assets.len()
        );
      }

      ReportEvent::BuildFailure { diagnostics } => {
        println!("build failed with {} diagnostics:", diagnostics.len());
        for diagnostic in diagnostics.iter() {
          println!("{}", diagnostic.message());
        }
      }

      ReportEvent::Log {
        level,
        message,
        diagnostics,
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

register_plugin!(CustomReporter);
