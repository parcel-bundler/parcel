//! Adds the local certificate authority (see `cert`) to the system's trust stores, so that browsers
//! trust the certificates it signs, and removes it again.
//!
//! - macOS: the login keychain, trusted for the user. Firefox reads it too.
//! - Windows: the current user's trusted root store. Firefox reads it too.
//! - Linux: the system store, and the NSS databases Chrome and Firefox read instead.

use std::{
  io::{BufRead, IsTerminal},
  path::Path,
};

use parcel_core::{LogLevel, ParcelOptions};

use crate::cert::{CA_CERT_FILE, LocalCa, ca_dir};

#[cfg(target_os = "macos")]
#[path = "trust/macos.rs"]
mod platform;
#[cfg(windows)]
#[path = "trust/windows.rs"]
mod platform;
#[cfg(all(unix, not(target_os = "macos")))]
#[path = "trust/linux.rs"]
mod platform;

/// Written next to the CA when the user declines to trust it, so that they aren't asked again.
const DECLINED_FILE: &str = ".declined";

/// What happened to one trust store.
#[derive(Debug, PartialEq)]
pub enum Outcome {
  /// The CA was added or removed.
  Done,
  /// There was nothing to do: the CA was already trusted, or wasn't there to remove.
  Unchanged,
  /// The user declined, e.g. by canceling the system's password dialog.
  Canceled,
  /// The store can't be changed, e.g. because a tool is missing.
  Unavailable(String),
  Failed(String),
}

#[derive(Debug)]
pub struct StoreResult {
  pub store: String,
  pub outcome: Outcome,
}

/// Before serving with certificates signed by the local CA, offers to trust it if the system
/// doesn't. Asks in the terminal unless the user declined before, and otherwise warns that it isn't
/// trusted.
pub fn offer(options: &ParcelOptions) {
  // Errors are reported when the server loads the CA.
  let Some(dir) = ca_dir() else {
    return;
  };
  let Ok((ca, _)) = LocalCa::load_or_create(&dir) else {
    return;
  };
  if platform::is_trusted(&ca) {
    return;
  }
  let warn = || {
    options.log(
      LogLevel::Warn,
      "Parcel's local certificate authority isn't trusted, so browsers warn about the \
       certificates it signs. Run `parcel trust` to trust it.",
    )
  };
  // Questions are only asked when they're shown.
  let interactive = std::io::stdin().is_terminal()
    && std::io::stdout().is_terminal()
    && options.log_level.allows(LogLevel::Info);
  if dir.join(DECLINED_FILE).exists() || !interactive {
    warn();
    return;
  }

  let ca_path = dir.join(CA_CERT_FILE);
  options.log(
    LogLevel::Info,
    format!(
      "Parcel serves HTTPS with certificates signed by a local certificate authority in {}.",
      dir.display()
    ),
  );
  options.log(LogLevel::Info, platform::explanation(&ca, &ca_path));
  if platform::CONFIRM && !confirm(options, "Trust it now? [Y/n]") {
    decline(&dir);
    warn();
    return;
  }
  let results = platform::install(&ca, &ca_path, options);
  log_results(options, &results, false);
  if results.iter().any(|r| r.outcome == Outcome::Canceled) {
    decline(&dir);
  }
  if !platform::is_trusted(&ca) {
    warn();
  }
}

/// `parcel trust`: adds the local CA to the system's trust stores, creating it if needed. With
/// `remove`, removes it from them and deletes it.
pub fn trust_command(remove: bool, options: &ParcelOptions) -> Result<(), String> {
  // sudo changes HOME on most Linux systems, which would find a different CA.
  #[cfg(unix)]
  if std::env::var_os("SUDO_USER").is_some() && unsafe { libc::geteuid() } == 0 {
    return Err(
      "Run parcel trust without sudo. It asks for permission when it needs to.".to_string(),
    );
  }
  let dir = ca_dir()
    .ok_or("Could not find a directory for the local certificate authority. Set PARCEL_CAROOT")?;
  let ca_path = dir.join(CA_CERT_FILE);

  if remove {
    if !ca_path.exists() {
      options.log(
        LogLevel::Info,
        format!("No local certificate authority in {}.", dir.display()),
      );
      return Ok(());
    }
    let ca = LocalCa::load(&dir).map_err(|err| {
      format!(
        "Could not read the local certificate authority in {}: {err}",
        dir.display()
      )
    })?;
    let results = platform::remove(&ca, &ca_path);
    log_results(options, &results, true);
    if results
      .iter()
      .any(|r| matches!(r.outcome, Outcome::Canceled | Outcome::Failed(_)))
    {
      return Err(format!(
        "Kept the local certificate authority in {}, since some stores may still trust it.",
        dir.display()
      ));
    }
    std::fs::remove_dir_all(&dir)
      .map_err(|err| format!("Could not delete {}: {err}", dir.display()))?;
    options.log(
      LogLevel::Info,
      format!(
        "Deleted the local certificate authority in {}.",
        dir.display()
      ),
    );
    return Ok(());
  }

  let (ca, created) = LocalCa::load_or_create(&dir)?;
  if created {
    options.log(
      LogLevel::Info,
      format!(
        "Created a local certificate authority in {}.",
        dir.display()
      ),
    );
  }
  let _ = std::fs::remove_file(dir.join(DECLINED_FILE));
  let results = platform::install(&ca, &ca_path, options);
  log_results(options, &results, false);
  if platform::is_trusted(&ca) {
    Ok(())
  } else {
    Err("The local certificate authority isn't trusted.".to_string())
  }
}

fn decline(dir: &Path) {
  let _ = std::fs::write(dir.join(DECLINED_FILE), "");
}

/// Asks a question in the terminal, answered on the next line, defaulting to yes.
fn confirm(options: &ParcelOptions, question: &str) -> bool {
  options.log(LogLevel::Info, question);
  let mut answer = String::new();
  if std::io::stdin().lock().read_line(&mut answer).is_err() {
    return false;
  }
  matches!(
    answer.trim().to_ascii_lowercase().as_str(),
    "" | "y" | "yes"
  )
}

fn log_results(options: &ParcelOptions, results: &[StoreResult], removing: bool) {
  for result in results {
    let (ok, message) = match &result.outcome {
      Outcome::Done if removing => (true, "removed"),
      Outcome::Done => (true, "trusted"),
      Outcome::Unchanged if removing => (true, "not present"),
      Outcome::Unchanged => (true, "already trusted"),
      Outcome::Canceled => (false, "canceled"),
      Outcome::Unavailable(reason) | Outcome::Failed(reason) => (false, reason.as_str()),
    };
    if ok {
      options.log(LogLevel::Info, format!("  ✓ {}: {message}", result.store));
    } else {
      options.log(LogLevel::Warn, format!("  ✗ {}: {message}", result.store));
    }
  }
}
