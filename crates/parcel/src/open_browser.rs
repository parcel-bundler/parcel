//! Opens the dev server's page in the user's browser. On macOS, a tab that already shows it (e.g.
//! from before the server restarted) is reused when the browser can be scripted.

use std::{
  process::{Command, Stdio},
  thread,
};

/// Browser names that `--open` accepts without `=`, e.g. `--open chrome`.
pub fn is_browser_name(name: &str) -> bool {
  matches!(
    name.to_ascii_lowercase().as_str(),
    "chrome"
      | "google"
      | "google chrome"
      | "chrome canary"
      | "google chrome canary"
      | "chromium"
      | "brave"
      | "edge"
      | "microsoft edge"
      | "vivaldi"
      | "arc"
      | "firefox"
      | "safari"
  )
}

/// Opens `url` in `browser`, a name like `chrome` or an app, or the default browser.
pub fn open_browser(url: &str, browser: Option<&str>) -> Result<(), String> {
  open(url, browser)
}

#[cfg(target_os = "macos")]
fn open(url: &str, browser: Option<&str>) -> Result<(), String> {
  use crate::macos::{bundle_identifier, default_app_for_url, open_url_in_app};

  let app = match browser {
    Some(browser) => macos_browser(browser).ok_or_else(|| format!("Could not find {browser}."))?,
    None => default_app_for_url(url).ok_or("Could not find the default browser.")?,
  };
  let app_id = bundle_identifier(&app);
  // Without a browser specified, the page may be open in another running browser than the default
  // one, e.g. one the user is testing in.
  let others = tabs::BROWSERS
    .iter()
    .map(|(id, _)| *id)
    .filter(|id| browser.is_none() && app_id.as_deref() != Some(*id));
  for id in app_id.as_deref().into_iter().chain(others) {
    if let Some(dialect) = tabs::dialect(id)
      && tabs::show_tab(id, dialect, url) == Ok(true)
    {
      return Ok(());
    }
  }
  open_url_in_app(&app, url).map_err(|_| format!("Could not open {url} in {}.", app.display()))
}

/// The app for a browser name like `chrome`, an app name like `Firefox Developer Edition`, or an
/// app's path.
#[cfg(target_os = "macos")]
fn macos_browser(name: &str) -> Option<std::path::PathBuf> {
  use std::path::Path;

  let bundle_identifier = match name.to_ascii_lowercase().as_str() {
    "chrome" | "google" | "google chrome" => Some("com.google.Chrome"),
    "chrome canary" | "google chrome canary" => Some("com.google.Chrome.canary"),
    "chromium" => Some("org.chromium.Chromium"),
    "brave" | "brave browser" => Some("com.brave.Browser"),
    "edge" | "microsoft edge" => Some("com.microsoft.edgemac"),
    "vivaldi" => Some("com.vivaldi.Vivaldi"),
    "arc" => Some("company.thebrowser.Browser"),
    "firefox" => Some("org.mozilla.firefox"),
    "safari" => Some("com.apple.Safari"),
    _ => None,
  };
  if let Some(bundle_identifier) = bundle_identifier {
    return crate::macos::app_with_bundle_identifier(bundle_identifier);
  }
  let path = Path::new(name);
  if path.extension().is_some_and(|ext| ext == "app") && path.is_dir() {
    return Some(path.to_path_buf());
  }
  let home = std::env::var_os("HOME").map(|home| Path::new(&home).join("Applications"));
  [Some(Path::new("/Applications").to_path_buf()), home]
    .into_iter()
    .flatten()
    .map(|dir| dir.join(format!("{name}.app")))
    .find(|app| app.is_dir())
}

#[cfg(target_os = "linux")]
fn open(url: &str, browser: Option<&str>) -> Result<(), String> {
  let Some(browser) = browser else {
    let is_wsl = std::env::var_os("WSL_DISTRO_NAME").is_some()
      || std::fs::read_to_string("/proc/sys/kernel/osrelease")
        .is_ok_and(|release| release.to_ascii_lowercase().contains("microsoft"));
    let command = linux_open_command(
      url,
      is_wsl,
      std::env::var("BROWSER").ok().as_deref(),
      on_path,
    )
    .ok_or_else(|| {
      format!("Could not find a browser to open {url} in. Set BROWSER to the browser to use.")
    })?;
    return spawn(&command);
  };
  let program = match browser.to_ascii_lowercase().as_str() {
    "chrome" | "google" | "google chrome" => [
      "google-chrome",
      "google-chrome-stable",
      "chromium-browser",
      "chromium",
    ]
    .into_iter()
    .find(|program| on_path(program))
    .unwrap_or("google-chrome")
    .to_owned(),
    "brave" => "brave-browser".to_owned(),
    "edge" | "microsoft edge" => "microsoft-edge".to_owned(),
    _ => browser.to_owned(),
  };
  spawn(&[program, url.to_owned()])
}

/// The command that opens `url` in the default browser on Linux. That's `xdg-open`, but it isn't
/// installed everywhere (e.g. minimal installs and containers), so this falls back to the browsers
/// it would try. Under WSL, pages open in the Windows browser.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn linux_open_command(
  url: &str,
  is_wsl: bool,
  browser_var: Option<&str>,
  on_path: impl Fn(&str) -> bool,
) -> Option<Vec<String>> {
  let command = |program: &str| vec![program.to_owned(), url.to_owned()];
  let wsl_programs: &[&str] = if is_wsl {
    &["wslview", "explorer.exe"]
  } else {
    &[]
  };
  if let Some(program) = wsl_programs
    .iter()
    .chain(&["xdg-open"])
    .find(|program| on_path(program))
  {
    return Some(command(program));
  }

  // BROWSER is a list of commands separated by `:`, in which `%s` stands for the URL.
  for entry in browser_var.unwrap_or_default().split(':') {
    let mut words: Vec<String> = entry
      .split_whitespace()
      .map(|word| word.replace("%s", url))
      .collect();
    if words.first().is_some_and(|program| on_path(program)) {
      if !entry.contains("%s") {
        words.push(url.to_owned());
      }
      return Some(words);
    }
  }

  // Debian's default browser, then common browsers.
  [
    "x-www-browser",
    "firefox",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "brave-browser",
    "microsoft-edge",
  ]
  .into_iter()
  .find(|program| on_path(program))
  .map(command)
}

/// Whether `program` is a path to a file, or the name of one on PATH.
#[cfg(target_os = "linux")]
fn on_path(program: &str) -> bool {
  if program.contains('/') {
    return std::path::Path::new(program).is_file();
  }
  std::env::var_os("PATH")
    .is_some_and(|paths| std::env::split_paths(&paths).any(|dir| dir.join(program).is_file()))
}

#[cfg(windows)]
fn open(url: &str, browser: Option<&str>) -> Result<(), String> {
  use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
  use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

  let wide = |s: &str| OsStr::new(s).encode_wide().chain([0]).collect::<Vec<u16>>();
  let browser = browser.map(|browser| match browser.to_ascii_lowercase().as_str() {
    "chrome" | "google" | "google chrome" => "chrome".to_owned(),
    "edge" | "microsoft edge" => "msedge".to_owned(),
    "brave" => "brave".to_owned(),
    _ => browser.to_owned(),
  });
  // The default browser opens URLs, and other browsers are found by their executable names.
  let (file, parameters) = match &browser {
    Some(browser) => (wide(browser), Some(wide(url))),
    None => (wide(url), None),
  };
  let result = unsafe {
    ShellExecuteW(
      std::ptr::null_mut(),
      wide("open").as_ptr(),
      file.as_ptr(),
      parameters.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()),
      std::ptr::null(),
      SW_SHOWNORMAL,
    )
  };
  // Values above 32 mean success.
  if result as isize > 32 {
    Ok(())
  } else {
    Err(format!("Could not open {url}."))
  }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn open(url: &str, browser: Option<&str>) -> Result<(), String> {
  spawn(&[browser.unwrap_or("xdg-open").to_owned(), url.to_owned()])
}

#[cfg_attr(any(target_os = "macos", windows), allow(dead_code))]
fn spawn(command: &[String]) -> Result<(), String> {
  let mut child = Command::new(&command[0])
    .args(&command[1..])
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|err| format!("Could not start {}: {err}", command[0]))?;
  thread::spawn(move || child.wait());
  Ok(())
}

/// Shows browsers' tabs with Apple Events, using the codes from their scripting dictionaries.
#[cfg(target_os = "macos")]
mod tabs {
  use crate::macos::apple_events::{App, C_WINDOW, Desc, KEY_DIRECT_OBJECT, P_INDEX, code};

  /// The scripting dictionaries of browsers whose tabs can be shown.
  #[derive(Clone, Copy, Debug, PartialEq)]
  pub enum Dialect {
    Chromium,
    Safari,
  }

  /// The bundle identifiers of browsers whose tabs can be shown.
  pub const BROWSERS: &[(&str, Dialect)] = &[
    ("com.google.Chrome", Dialect::Chromium),
    ("com.google.Chrome.beta", Dialect::Chromium),
    ("com.google.Chrome.dev", Dialect::Chromium),
    ("com.google.Chrome.canary", Dialect::Chromium),
    ("org.chromium.Chromium", Dialect::Chromium),
    ("com.microsoft.edgemac", Dialect::Chromium),
    ("com.microsoft.edgemac.Beta", Dialect::Chromium),
    ("com.microsoft.edgemac.Dev", Dialect::Chromium),
    ("com.microsoft.edgemac.Canary", Dialect::Chromium),
    ("com.brave.Browser", Dialect::Chromium),
    ("com.brave.Browser.beta", Dialect::Chromium),
    ("com.brave.Browser.nightly", Dialect::Chromium),
    ("com.vivaldi.Vivaldi", Dialect::Chromium),
    ("com.apple.Safari", Dialect::Safari),
    ("com.apple.SafariTechnologyPreview", Dialect::Safari),
  ];

  pub fn dialect(bundle_identifier: &str) -> Option<Dialect> {
    BROWSERS
      .iter()
      .find(|(id, _)| *id == bundle_identifier)
      .map(|&(_, dialect)| dialect)
  }

  /// Selects, reloads, and brings to the front a tab of the running browser with
  /// `bundle_identifier` that shows a page of `url`. Returns whether there is one. The first time,
  /// macOS asks the user whether to allow controlling the browser. Browsers that aren't running are
  /// skipped without asking.
  pub fn show_tab(bundle_identifier: &str, dialect: Dialect, url: &str) -> Result<bool, i32> {
    let app = App::new(bundle_identifier)?;
    // Fails if the browser isn't running, or isn't allowed to be controlled.
    app.request_permission()?;

    let (tab_class, url_property) = match dialect {
      Dialect::Chromium => (code(b"CrTb"), code(b"URL ")),
      Dialect::Safari => (code(b"bTab"), code(b"pURL")),
    };
    let window = |index| Desc::index(C_WINDOW, Desc::null(), index);
    let tab = |window_index, tab_index| Desc::index(tab_class, window(window_index)?, tab_index);

    // `URL of every tab of every window`, a list of each window's list of tabs' URLs.
    let urls = app.get(Desc::property(
      url_property,
      Desc::every(tab_class, Desc::every(C_WINDOW, Desc::null())?)?,
    )?)?;
    let Some((window_index, tab_index, tab_url)) = find_tab(&urls, url)? else {
      return Ok(false);
    };

    match dialect {
      Dialect::Chromium => {
        app.set(
          Desc::property(code(b"acTI"), window(window_index)?)?,
          Desc::int(tab_index as i32)?,
        )?;
        app.send(
          b"CrSu",
          b"Rlod",
          vec![(KEY_DIRECT_OBJECT, tab(window_index, tab_index)?)],
        )?;
      }
      Dialect::Safari => {
        app.set(
          Desc::property(code(b"cTab"), window(window_index)?)?,
          tab(window_index, tab_index)?,
        )?;
        // Safari has no reload command, but loads the tab's URL again when it's set.
        app.set(
          Desc::property(url_property, tab(window_index, tab_index)?)?,
          Desc::text(&tab_url)?,
        )?;
      }
    }
    // Raise the window, then bring the browser to the front.
    app.set(
      Desc::property(P_INDEX, window(window_index)?)?,
      Desc::int(1)?,
    )?;
    app.send(b"misc", b"actv", Vec::new())?;
    Ok(true)
  }

  /// The window and tab, counting from 1, and the URL of the first tab that shows a page of `url`.
  fn find_tab(urls: &Desc, url: &str) -> Result<Option<(usize, usize, String)>, i32> {
    for (window_index, tabs) in urls.items()?.iter().enumerate() {
      for (tab_index, tab_url) in tabs.items()?.iter().enumerate() {
        if let Some(tab_url) = tab_url.to_text()
          && tab_url.starts_with(url)
        {
          return Ok(Some((window_index + 1, tab_index + 1, tab_url)));
        }
      }
    }
    Ok(None)
  }

  #[cfg(test)]
  mod tests {
    use super::*;

    #[test]
    fn identifies_scriptable_browsers() {
      assert_eq!(dialect("com.google.Chrome"), Some(Dialect::Chromium));
      assert_eq!(dialect("com.microsoft.edgemac"), Some(Dialect::Chromium));
      assert_eq!(dialect("com.apple.Safari"), Some(Dialect::Safari));
      assert_eq!(dialect("org.mozilla.firefox"), None);
    }

    #[test]
    fn does_not_control_browsers_that_are_not_running() {
      // Not a real app, so it can't be running, and macOS doesn't ask for permission.
      assert!(
        show_tab(
          "com.example.not-running",
          Dialect::Chromium,
          "http://localhost/"
        )
        .is_err()
      );
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn finds_a_linux_browser() {
    let url = "http://localhost:1234/";
    let command = |is_wsl, browser_var, installed: &[&str]| {
      linux_open_command(url, is_wsl, browser_var, |program| {
        installed.contains(&program)
      })
    };
    let expected = |command: &[&str]| Some(command.iter().map(|s| s.to_string()).collect());

    assert_eq!(
      command(false, None, &["xdg-open", "firefox"]),
      expected(&["xdg-open", url])
    );
    // Under WSL, the Windows browser.
    assert_eq!(
      command(true, None, &["xdg-open", "explorer.exe"]),
      expected(&["explorer.exe", url])
    );
    // BROWSER's first installed command, with the URL in place of `%s` or after it.
    assert_eq!(
      command(false, Some("missing:chromium --incognito"), &["chromium"]),
      expected(&["chromium", "--incognito", url])
    );
    assert_eq!(
      command(false, Some("open-url %s --new-tab"), &["open-url"]),
      expected(&["open-url", url, "--new-tab"])
    );
    // Then Debian's default browser, or common browsers.
    assert_eq!(
      command(false, None, &["firefox"]),
      expected(&["firefox", url])
    );
    assert_eq!(command(false, None, &[]), None);
  }

  #[test]
  fn recognizes_browser_names() {
    assert!(is_browser_name("chrome"));
    assert!(is_browser_name("Safari"));
    assert!(!is_browser_name("src/index.html"));
  }
}
