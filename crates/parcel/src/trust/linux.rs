//! Trust on Linux: the CA is added to the system store with sudo, which command line tools read,
//! and to the NSS databases Chrome and Firefox read instead, with `certutil`.

use std::{
  io::Write,
  path::{Path, PathBuf},
  process::{Command, Stdio},
};

use parcel_core::ParcelOptions;

use super::{Outcome, StoreResult};
use crate::cert::{CA_NAME, LocalCa};

/// Running sudo is confirmed first, so that declining doesn't mean interrupting sudo.
pub const CONFIRM: bool = true;

/// The directories distributions read extra CAs from, and the commands that apply them, like
/// mkcert's.
const SYSTEM_STORES: &[(&str, &str, &[&str])] = &[
  (
    "/etc/pki/ca-trust/source/anchors",
    "parcel-development-ca.pem",
    &["update-ca-trust", "extract"],
  ),
  (
    "/usr/local/share/ca-certificates",
    "parcel-development-ca.crt",
    &["update-ca-certificates"],
  ),
  (
    "/etc/ca-certificates/trust-source/anchors",
    "parcel-development-ca.crt",
    &["trust", "extract-compat"],
  ),
  (
    "/usr/share/pki/trust/anchors",
    "parcel-development-ca.pem",
    &["update-ca-certificates"],
  ),
];

/// Where this distribution reads extra CAs from under `root`, and the command that applies them.
fn system_store(root: &Path) -> Option<(PathBuf, &'static [&'static str])> {
  SYSTEM_STORES
    .iter()
    .find(|(dir, _, _)| root.join(dir.trim_start_matches('/')).is_dir())
    .map(|(dir, file, command)| (Path::new(dir).join(file), *command))
}

/// The NSS databases in `home`, with the names of the browsers that read them.
fn nss_databases(home: &Path) -> Vec<(String, PathBuf)> {
  let mut databases = Vec::new();
  for (name, dir) in [
    ("Chrome", ".pki/nssdb"),
    ("Chromium (snap)", "snap/chromium/current/.pki/nssdb"),
  ] {
    let dir = home.join(dir);
    if dir.join("cert9.db").is_file() {
      databases.push((name.to_string(), dir));
    }
  }
  for (name, dir) in [
    ("Firefox", ".mozilla/firefox"),
    ("Firefox (snap)", "snap/firefox/common/.mozilla/firefox"),
    (
      "Firefox (flatpak)",
      ".var/app/org.mozilla.firefox/.mozilla/firefox",
    ),
  ] {
    let Ok(entries) = std::fs::read_dir(home.join(dir)) else {
      continue;
    };
    let mut profiles: Vec<_> = entries
      .filter_map(|entry| Some(entry.ok()?.path()))
      .filter(|profile| profile.join("cert9.db").is_file())
      .collect();
    profiles.sort();
    for profile in profiles {
      let profile_name = profile.file_name().unwrap().to_string_lossy().into_owned();
      databases.push((format!("{name} profile {profile_name}"), profile));
    }
  }
  databases
}

fn home() -> Option<PathBuf> {
  std::env::var_os("HOME").map(PathBuf::from)
}

/// Whether `program` is on the PATH.
fn has_program(program: &str) -> bool {
  std::env::var_os("PATH")
    .is_some_and(|path| std::env::split_paths(&path).any(|dir| dir.join(program).is_file()))
}

/// A command run as root: with sudo, unless already root.
fn as_root(command: &[&str]) -> Command {
  if unsafe { libc::geteuid() } == 0 {
    let mut root = Command::new(command[0]);
    root.args(&command[1..]);
    root
  } else {
    let mut sudo = Command::new("sudo");
    sudo.args(command);
    sudo
  }
}

/// The name of the CA in NSS databases, which includes its fingerprint to tell it apart from CAs
/// created earlier.
fn nickname(ca: &LocalCa) -> String {
  format!("{CA_NAME} {}", &ca.fingerprint()[..16])
}

fn in_nss_database(ca: &LocalCa, database: &Path) -> bool {
  Command::new("certutil")
    .args(["-L", "-n", &nickname(ca), "-d"])
    .arg(format!("sql:{}", database.display()))
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .is_ok_and(|status| status.success())
}

fn in_system_store(ca: &LocalCa) -> bool {
  system_store(Path::new("/")).is_some_and(|(path, _)| {
    std::fs::read_to_string(path).is_ok_and(|contents| contents == ca.cert_pem)
  })
}

/// Whether every store the CA can be added to has it.
pub fn is_trusted(ca: &LocalCa) -> bool {
  if !in_system_store(ca) {
    return false;
  }
  if !has_program("certutil") {
    return true;
  }
  let Some(home) = home() else {
    return true;
  };
  nss_databases(&home)
    .iter()
    .all(|(_, database)| in_nss_database(ca, database))
}

pub fn explanation(ca: &LocalCa, ca_path: &Path) -> String {
  let mut explanation = String::from("To make browsers trust it, Parcel will run:\n");
  if !in_system_store(ca)
    && let Some((path, command)) = system_store(Path::new("/"))
  {
    explanation.push_str(&format!(
      "  sudo cp {} {}\n  sudo {}\n",
      ca_path.display(),
      path.display(),
      command.join(" ")
    ));
  }
  if has_program("certutil")
    && let Some(home) = home()
  {
    for (name, database) in nss_databases(&home) {
      if !in_nss_database(ca, &database) {
        explanation.push_str(&format!(
          "  certutil -A -d sql:{} ... (for {name})\n",
          database.display()
        ));
      }
    }
  }
  explanation.trim_end().to_string()
}

pub fn install(ca: &LocalCa, ca_path: &Path, _options: &ParcelOptions) -> Vec<StoreResult> {
  let mut results = vec![StoreResult {
    store: "system trust store".to_string(),
    outcome: install_system(ca),
  }];
  let Some(home) = home() else {
    return results;
  };
  let databases = nss_databases(&home);
  if !databases.is_empty() && !has_program("certutil") {
    results.push(StoreResult {
      store: databases
        .iter()
        .map(|(name, _)| name.as_str())
        .collect::<Vec<_>>()
        .join(", "),
      outcome: Outcome::Unavailable(
        "certutil not found. Install libnss3-tools (Debian, Ubuntu) or nss-tools (Fedora), then \
         run `parcel trust` and restart the browser"
          .to_string(),
      ),
    });
    return results;
  }
  for (name, database) in databases {
    let outcome = if in_nss_database(ca, &database) {
      Outcome::Unchanged
    } else {
      let status = Command::new("certutil")
        .args(["-A", "-t", "C,,", "-n", &nickname(ca), "-i"])
        .arg(ca_path)
        .arg("-d")
        .arg(format!("sql:{}", database.display()))
        .status();
      match status {
        Ok(status) if status.success() => Outcome::Done,
        Ok(_) => Outcome::Failed("certutil failed".to_string()),
        Err(err) => Outcome::Failed(format!("Could not run certutil: {err}")),
      }
    };
    results.push(StoreResult {
      store: name,
      outcome,
    });
  }
  results
}

fn install_system(ca: &LocalCa) -> Outcome {
  if in_system_store(ca) {
    return Outcome::Unchanged;
  }
  let Some((path, command)) = system_store(Path::new("/")) else {
    return Outcome::Unavailable("Unknown system trust store".to_string());
  };
  if unsafe { libc::geteuid() } != 0 && !has_program("sudo") {
    return Outcome::Unavailable("sudo not found".to_string());
  }
  let copied = as_root(&["tee", &path.to_string_lossy()])
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .spawn()
    .and_then(|mut tee| {
      tee
        .stdin
        .take()
        .unwrap()
        .write_all(ca.cert_pem.as_bytes())?;
      tee.wait()
    });
  match copied {
    Ok(status) if status.success() => {}
    Ok(_) => return Outcome::Canceled,
    Err(err) => return Outcome::Failed(format!("Could not run sudo: {err}")),
  }
  run(as_root(command), command[0])
}

fn run(mut command: Command, name: &str) -> Outcome {
  match command.status() {
    Ok(status) if status.success() => Outcome::Done,
    Ok(_) => Outcome::Failed(format!("{name} failed")),
    Err(err) => Outcome::Failed(format!("Could not run {name}: {err}")),
  }
}

pub fn remove(ca: &LocalCa, _ca_path: &Path) -> Vec<StoreResult> {
  let mut results = Vec::new();
  let outcome = match system_store(Path::new("/")) {
    Some((path, command)) if path.exists() => {
      match as_root(&["rm", "-f", &path.to_string_lossy()]).status() {
        Ok(status) if status.success() => run(as_root(command), command[0]),
        Ok(_) => Outcome::Canceled,
        Err(err) => Outcome::Failed(format!("Could not run sudo: {err}")),
      }
    }
    _ => Outcome::Unchanged,
  };
  results.push(StoreResult {
    store: "system trust store".to_string(),
    outcome,
  });

  if has_program("certutil")
    && let Some(home) = home()
  {
    for (name, database) in nss_databases(&home) {
      let outcome = if in_nss_database(ca, &database) {
        let mut command = Command::new("certutil");
        command
          .args(["-D", "-n", &nickname(ca), "-d"])
          .arg(format!("sql:{}", database.display()));
        run(command, "certutil")
      } else {
        Outcome::Unchanged
      };
      results.push(StoreResult {
        store: name,
        outcome,
      });
    }
  }
  results
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn finds_the_system_store() {
    let root = std::env::temp_dir().join(format!("parcel-trust-root-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    assert!(system_store(&root).is_none());
    std::fs::create_dir_all(root.join("usr/local/share/ca-certificates")).unwrap();
    let (path, command) = system_store(&root).unwrap();
    assert_eq!(
      path,
      Path::new("/usr/local/share/ca-certificates/parcel-development-ca.crt")
    );
    assert_eq!(command, ["update-ca-certificates"]);
    // Fedora's comes first, as some distributions have both.
    std::fs::create_dir_all(root.join("etc/pki/ca-trust/source/anchors")).unwrap();
    assert_eq!(
      system_store(&root).unwrap().1,
      ["update-ca-trust", "extract"]
    );
    std::fs::remove_dir_all(&root).unwrap();
  }

  #[test]
  fn finds_nss_databases() {
    let home = std::env::temp_dir().join(format!("parcel-trust-home-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    for dir in [
      ".pki/nssdb",
      ".mozilla/firefox/abc.default-release",
      ".mozilla/firefox/Crash Reports",
      "snap/firefox/common/.mozilla/firefox/xyz.default",
    ] {
      std::fs::create_dir_all(home.join(dir)).unwrap();
    }
    for db in [
      ".pki/nssdb",
      ".mozilla/firefox/abc.default-release",
      "snap/firefox/common/.mozilla/firefox/xyz.default",
    ] {
      std::fs::write(home.join(db).join("cert9.db"), "").unwrap();
    }
    let names: Vec<_> = nss_databases(&home)
      .into_iter()
      .map(|(name, _)| name)
      .collect();
    assert_eq!(
      names,
      [
        "Chrome",
        "Firefox profile abc.default-release",
        "Firefox (snap) profile xyz.default"
      ]
    );
    std::fs::remove_dir_all(&home).unwrap();
  }
}
