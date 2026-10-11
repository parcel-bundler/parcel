//! Opens files in the user's editor, at a line and column. Ported from
//! [launch-editor](https://github.com/vitejs/launch-editor) 2.14.2 (MIT).

use std::{
  ffi::{OsStr, OsString},
  path::Path,
  process::{Command, Stdio},
  thread,
};

/// Opens `file` in the user's editor, at `line` and `column` if the editor supports them. The
/// editor is the one set in `LAUNCH_EDITOR`, otherwise a known editor that is running, otherwise
/// the one set in `VISUAL` or `EDITOR`.
pub fn launch_editor(file: &Path, line: Option<u32>, column: Option<u32>) -> Result<(), String> {
  let launch_editor_var = std::env::var_os("LAUNCH_EDITOR");
  let editor = launch_editor_var
    .clone()
    .or_else(|| running_editor().map(OsString::from))
    .or_else(|| std::env::var_os("VISUAL"))
    .or_else(|| std::env::var_os("EDITOR"))
    .ok_or("No editor found. Set LAUNCH_EDITOR to the editor to open files in.")?;

  if is_terminal_editor(&editor) {
    return Err(format!(
      "{} runs in a terminal. Set LAUNCH_EDITOR to an editor that doesn't.",
      editor.to_string_lossy()
    ));
  }

  let args = editor_args(&editor, file, line, column, launch_editor_var.is_some());
  let program = resolve_program(&editor);
  let mut child = Command::new(&program)
    .args(args)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|err| format!("Could not start {}: {err}", editor.to_string_lossy()))?;
  // Reap the process once it exits. Editor CLIs usually hand the file to a running instance.
  let file = file.to_string_lossy().into_owned();
  thread::spawn(move || {
    if let Ok(status) = child.wait()
      && !status.success()
    {
      eprintln!(
        "Could not open {file} in {}: it exited with {status}.",
        editor.to_string_lossy()
      );
    }
  });
  Ok(())
}

/// Editors that take over the terminal they are started in, i.e. the dev server's.
fn is_terminal_editor(editor: &OsStr) -> bool {
  matches!(
    editor_name(editor).as_str(),
    "vi" | "vim" | "nvim" | "nano" | "pico" | "hx" | "micro"
  )
}

/// The name of an editor's executable, without its directory or a Windows extension.
fn editor_name(editor: &OsStr) -> String {
  let editor = editor.to_string_lossy();
  let name = editor.rsplit(['/', '\\']).next().unwrap_or(&editor);
  for extension in [".exe", ".cmd", ".bat"] {
    if name.len() > extension.len()
      && name[name.len() - extension.len()..].eq_ignore_ascii_case(extension)
    {
      return name[..name.len() - extension.len()].to_owned();
    }
  }
  name.to_owned()
}

/// The arguments that open `file` in `editor`, at `line` and `column` if the editor is known to
/// support them. Other editors only get the file, since position arguments they don't understand
/// can cause errors, unless the editor was set in `LAUNCH_EDITOR`.
fn editor_args(
  editor: &OsStr,
  file: &Path,
  line: Option<u32>,
  column: Option<u32>,
  from_launch_editor_var: bool,
) -> Vec<OsString> {
  let Some(line) = line else {
    return vec![file.into()];
  };
  let column = column.unwrap_or(1);
  let file = file.to_string_lossy();
  let args: Vec<String> = match editor_name(editor).as_str() {
    "atom" | "Atom" | "Atom Beta" | "subl" | "sublime" | "sublime_text" | "wstorm" | "charm"
    | "zed" => vec![format!("{file}:{line}:{column}")],
    "notepad++" => vec![format!("-n{line}"), format!("-c{column}"), file.into()],
    "vim" | "mvim" => vec![format!("+call cursor({line}, {column})"), file.into()],
    "joe" | "gvim" => vec![format!("+{line}"), file.into()],
    "emacs" | "emacsclient" => vec![format!("+{line}:{column}"), file.into()],
    "rmate" | "mate" | "mine" => vec!["--line".into(), line.to_string(), file.into()],
    "code" | "Code" | "code-insiders" | "Code - Insiders" | "codium" | "trae" | "antigravity"
    | "cursor" | "vscodium" | "VSCodium" => {
      vec!["-r".into(), "-g".into(), format!("{file}:{line}:{column}")]
    }
    "appcode" | "clion" | "clion64" | "idea" | "idea64" | "phpstorm" | "phpstorm64" | "pycharm"
    | "pycharm64" | "rubymine" | "rubymine64" | "webstorm" | "webstorm64" | "goland"
    | "goland64" | "rider" | "rider64" => vec![
      "--line".into(),
      line.to_string(),
      "--column".into(),
      column.to_string(),
      file.into(),
    ],
    _ if from_launch_editor_var => vec![file.into(), line.to_string(), column.to_string()],
    _ => vec![file.into()],
  };
  args.into_iter().map(OsString::from).collect()
}

/// Running editors' executables on macOS, and the commands that open files in them. Using the
/// executable would start another instance of the app.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const MACOS_EDITORS: &[(&str, &str)] = &[
  ("/Applications/Atom.app/Contents/MacOS/Atom", "atom"),
  (
    "/Applications/Atom Beta.app/Contents/MacOS/Atom Beta",
    "/Applications/Atom Beta.app/Contents/MacOS/Atom Beta",
  ),
  (
    "/Applications/Brackets.app/Contents/MacOS/Brackets",
    "brackets",
  ),
  (
    "/Applications/Sublime Text.app/Contents/MacOS/Sublime Text",
    "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl",
  ),
  (
    "/Applications/Sublime Text.app/Contents/MacOS/sublime_text",
    "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl",
  ),
  (
    "/Applications/Sublime Text 2.app/Contents/MacOS/Sublime Text 2",
    "/Applications/Sublime Text 2.app/Contents/SharedSupport/bin/subl",
  ),
  (
    "/Applications/Sublime Text Dev.app/Contents/MacOS/Sublime Text",
    "/Applications/Sublime Text Dev.app/Contents/SharedSupport/bin/subl",
  ),
  (
    "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    "code",
  ),
  (
    "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    "code",
  ),
  (
    "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders",
    "code-insiders",
  ),
  (
    "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron",
    "code-insiders",
  ),
  (
    "/Applications/VSCodium.app/Contents/MacOS/Electron",
    "codium",
  ),
  ("/Applications/Cursor.app/Contents/MacOS/Cursor", "cursor"),
  ("/Applications/Trae.app/Contents/MacOS/Electron", "trae"),
  (
    "/Applications/Antigravity.app/Contents/MacOS/Electron",
    "antigravity",
  ),
  (
    "/Applications/AppCode.app/Contents/MacOS/appcode",
    "/Applications/AppCode.app/Contents/MacOS/appcode",
  ),
  (
    "/Applications/CLion.app/Contents/MacOS/clion",
    "/Applications/CLion.app/Contents/MacOS/clion",
  ),
  (
    "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
    "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
  ),
  (
    "/Applications/IntelliJ IDEA Ultimate.app/Contents/MacOS/idea",
    "/Applications/IntelliJ IDEA Ultimate.app/Contents/MacOS/idea",
  ),
  (
    "/Applications/IntelliJ IDEA Community Edition.app/Contents/MacOS/idea",
    "/Applications/IntelliJ IDEA Community Edition.app/Contents/MacOS/idea",
  ),
  (
    "/Applications/PhpStorm.app/Contents/MacOS/phpstorm",
    "/Applications/PhpStorm.app/Contents/MacOS/phpstorm",
  ),
  (
    "/Applications/PyCharm.app/Contents/MacOS/pycharm",
    "/Applications/PyCharm.app/Contents/MacOS/pycharm",
  ),
  (
    "/Applications/PyCharm CE.app/Contents/MacOS/pycharm",
    "/Applications/PyCharm CE.app/Contents/MacOS/pycharm",
  ),
  (
    "/Applications/RubyMine.app/Contents/MacOS/rubymine",
    "/Applications/RubyMine.app/Contents/MacOS/rubymine",
  ),
  (
    "/Applications/WebStorm.app/Contents/MacOS/webstorm",
    "/Applications/WebStorm.app/Contents/MacOS/webstorm",
  ),
  ("/Applications/MacVim.app/Contents/MacOS/MacVim", "mvim"),
  (
    "/Applications/GoLand.app/Contents/MacOS/goland",
    "/Applications/GoLand.app/Contents/MacOS/goland",
  ),
  (
    "/Applications/Rider.app/Contents/MacOS/rider",
    "/Applications/Rider.app/Contents/MacOS/rider",
  ),
  ("/Applications/Zed.app/Contents/MacOS/zed", "zed"),
];

/// Running editors' process names on Linux, and the commands that open files in them.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const LINUX_EDITORS: &[(&str, &str)] = &[
  ("atom", "atom"),
  ("Brackets", "brackets"),
  ("code-insiders", "code-insiders"),
  ("code", "code"),
  ("cursor", "cursor"),
  ("trae", "trae"),
  ("antigravity", "antigravity"),
  ("vscodium", "vscodium"),
  ("codium", "codium"),
  ("emacs", "emacs"),
  ("gvim", "gvim"),
  ("idea", "idea"),
  ("idea.sh", "idea"),
  ("phpstorm", "phpstorm"),
  ("phpstorm.sh", "phpstorm"),
  ("pycharm", "pycharm"),
  ("pycharm.sh", "pycharm"),
  ("rubymine", "rubymine"),
  ("rubymine.sh", "rubymine"),
  ("sublime_text", "subl"),
  ("vim", "vim"),
  ("webstorm", "webstorm"),
  ("webstorm.sh", "webstorm"),
  ("goland", "goland"),
  ("goland.sh", "goland"),
  ("rider", "rider"),
  ("rider.sh", "rider"),
  ("zed", "zed"),
];

/// Running editors' executable names on Windows, which also open files.
#[cfg_attr(not(windows), allow(dead_code))]
const WINDOWS_EDITORS: &[&str] = &[
  "Brackets.exe",
  "Code.exe",
  "Code - Insiders.exe",
  "VSCodium.exe",
  "Cursor.exe",
  "atom.exe",
  "sublime_text.exe",
  "notepad++.exe",
  "clion.exe",
  "clion64.exe",
  "idea.exe",
  "idea64.exe",
  "phpstorm.exe",
  "phpstorm64.exe",
  "pycharm.exe",
  "pycharm64.exe",
  "rubymine.exe",
  "rubymine64.exe",
  "webstorm.exe",
  "webstorm64.exe",
  "goland.exe",
  "goland64.exe",
  "rider.exe",
  "rider64.exe",
  "Trae.exe",
  "zed.exe",
  "Antigravity.exe",
];

/// The command that opens files in a known editor that is running, given the executable paths of
/// the user's processes.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn editor_from_macos_processes(processes: &[String]) -> Option<String> {
  for &(executable, command) in MACOS_EDITORS {
    if processes.iter().any(|process| process == executable) {
      return Some(command.into());
    }
    // The app may be installed elsewhere, e.g. in ~/Applications.
    let in_app = executable.trim_start_matches("/Applications");
    if let Some(process) = processes.iter().find(|process| process.ends_with(in_app)) {
      // Use the command if it's on PATH, and otherwise the executable wherever it's installed.
      return Some(if command != executable {
        command.into()
      } else {
        process.clone()
      });
    }
  }
  None
}

/// The command that opens files in a known editor that is running, given the names of the user's
/// processes.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn editor_from_linux_processes(processes: &[String]) -> Option<String> {
  LINUX_EDITORS
    .iter()
    .find(|(name, _)| processes.iter().any(|process| process == name))
    .map(|&(_, command)| command.into())
}

/// The executable of a known editor that is running, given the executable paths of processes.
#[cfg_attr(not(windows), allow(dead_code))]
fn editor_from_windows_processes(processes: &[String]) -> Option<String> {
  processes
    .iter()
    .find(|process| {
      let name = process.rsplit(['\\', '/']).next().unwrap_or(process);
      WINDOWS_EDITORS.contains(&name)
    })
    .cloned()
}

#[cfg(target_os = "macos")]
fn running_editor() -> Option<String> {
  editor_from_macos_processes(&macos::process_paths())
}

#[cfg(target_os = "linux")]
fn running_editor() -> Option<String> {
  editor_from_linux_processes(&linux::process_names())
}

#[cfg(windows)]
fn running_editor() -> Option<String> {
  windows::editor_process()
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn running_editor() -> Option<String> {
  None
}

/// The program to run for `editor`. On Windows, `Command` only finds `.exe` files on PATH, but
/// editors' CLIs are often batch files, e.g. `code.cmd`.
#[cfg(windows)]
fn resolve_program(editor: &OsStr) -> OsString {
  let path = Path::new(editor);
  if path.extension().is_some() || path.components().count() > 1 {
    return editor.into();
  }
  let Some(paths) = std::env::var_os("PATH") else {
    return editor.into();
  };
  for dir in std::env::split_paths(&paths) {
    for extension in ["exe", "cmd", "bat"] {
      let candidate = dir.join(path).with_extension(extension);
      if candidate.is_file() {
        return candidate.into();
      }
    }
  }
  editor.into()
}

#[cfg(not(windows))]
fn resolve_program(editor: &OsStr) -> OsString {
  editor.into()
}

#[cfg(target_os = "macos")]
mod macos {
  use std::{ffi::c_void, mem};

  /// The executable paths of the current user's processes, like `ps x -o comm=`.
  pub fn process_paths() -> Vec<String> {
    let uid = unsafe { libc::getuid() };
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if count <= 0 {
      return Vec::new();
    }
    // Leave room for processes started in the meantime.
    let mut pids = vec![0 as libc::pid_t; count as usize + 64];
    let count = unsafe {
      libc::proc_listallpids(
        pids.as_mut_ptr() as *mut c_void,
        (pids.len() * mem::size_of::<libc::pid_t>()) as libc::c_int,
      )
    };
    pids.truncate(count.max(0) as usize);

    let mut paths = Vec::new();
    let mut path = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    for pid in pids {
      let mut info: libc::proc_bsdinfo = unsafe { mem::zeroed() };
      let size = mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
      let read = unsafe {
        libc::proc_pidinfo(
          pid,
          libc::PROC_PIDTBSDINFO,
          0,
          &mut info as *mut _ as *mut c_void,
          size,
        )
      };
      if read != size || info.pbi_uid != uid {
        continue;
      }
      let len =
        unsafe { libc::proc_pidpath(pid, path.as_mut_ptr() as *mut c_void, path.len() as u32) };
      if len > 0 {
        paths.push(String::from_utf8_lossy(&path[..len as usize]).into_owned());
      }
    }
    paths
  }
}

#[cfg(target_os = "linux")]
mod linux {
  use std::os::unix::fs::MetadataExt;

  /// The names of the current user's processes, like `ps x -o comm`.
  pub fn process_names() -> Vec<String> {
    let uid = unsafe { libc::getuid() };
    let Ok(entries) = std::fs::read_dir("/proc") else {
      return Vec::new();
    };
    entries
      .flatten()
      .filter(|entry| {
        entry
          .file_name()
          .to_string_lossy()
          .bytes()
          .all(|b| b.is_ascii_digit())
          && entry.metadata().is_ok_and(|metadata| metadata.uid() == uid)
      })
      .filter_map(|entry| std::fs::read_to_string(entry.path().join("comm")).ok())
      .map(|name| name.trim_end().to_owned())
      .collect()
  }
}

#[cfg(windows)]
mod windows {
  use std::{ffi::OsString, mem, os::windows::ffi::OsStringExt};
  use windows_sys::Win32::{
    Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
    System::{
      Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
      },
      Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
      },
    },
  };

  /// The executable path of a running editor's process.
  pub fn editor_process() -> Option<String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
      return None;
    }
    let mut entry: PROCESSENTRY32W = unsafe { mem::zeroed() };
    entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut editor = None;
    let mut found = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while found {
      let len = entry
        .szExeFile
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(entry.szExeFile.len());
      let name = OsString::from_wide(&entry.szExeFile[..len])
        .to_string_lossy()
        .into_owned();
      // Only look up the full paths of processes that may be editors.
      if super::WINDOWS_EDITORS.contains(&name.as_str())
        && let Some(path) = process_path(entry.th32ProcessID)
      {
        editor = super::editor_from_windows_processes(&[path]);
        if editor.is_some() {
          break;
        }
      }
      found = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    editor
  }

  fn process_path(pid: u32) -> Option<String> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
      return None;
    }
    let mut path = vec![0u16; 32768];
    let mut len = path.len() as u32;
    let ok = unsafe {
      QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut len)
    };
    unsafe { CloseHandle(process) };
    (ok != 0).then(|| {
      OsString::from_wide(&path[..len as usize])
        .to_string_lossy()
        .into_owned()
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn args(editor: &str, line: Option<u32>, column: Option<u32>) -> Vec<String> {
    editor_args(
      OsStr::new(editor),
      Path::new("/p/src/a.js"),
      line,
      column,
      false,
    )
    .into_iter()
    .map(|arg| arg.into_string().unwrap())
    .collect()
  }

  #[test]
  fn positions_files_for_known_editors() {
    assert_eq!(
      args("code", Some(3), Some(5)),
      ["-r", "-g", "/p/src/a.js:3:5"]
    );
    assert_eq!(
      args(
        r"C:\Program Files\Microsoft VS Code\Code.exe",
        Some(3),
        None
      ),
      ["-r", "-g", "/p/src/a.js:3:1"]
    );
    assert_eq!(args("zed", Some(3), Some(5)), ["/p/src/a.js:3:5"]);
    assert_eq!(
      args(
        "/Applications/WebStorm.app/Contents/MacOS/webstorm",
        Some(3),
        Some(5)
      ),
      ["--line", "3", "--column", "5", "/p/src/a.js"]
    );
    assert_eq!(args("emacs", Some(3), Some(5)), ["+3:5", "/p/src/a.js"]);
    // Without a position, or for other editors, only the file.
    assert_eq!(args("code", None, None), ["/p/src/a.js"]);
    assert_eq!(args("unknown", Some(3), Some(5)), ["/p/src/a.js"]);
    // Editors set in LAUNCH_EDITOR get the position as separate arguments.
    let args = editor_args(
      OsStr::new("my-editor"),
      Path::new("a.js"),
      Some(3),
      Some(5),
      true,
    );
    assert_eq!(args, ["a.js", "3", "5"]);
  }

  #[test]
  fn finds_running_macos_editors() {
    let processes = |paths: &[&str]| paths.iter().map(|p| p.to_string()).collect::<Vec<_>>();
    assert_eq!(
      editor_from_macos_processes(&processes(&[
        "/usr/libexec/logd",
        "/Applications/Visual Studio Code.app/Contents/MacOS/Code"
      ])),
      Some("code".into())
    );
    // Apps installed outside /Applications are found too.
    assert_eq!(
      editor_from_macos_processes(&processes(&[
        "/Users/me/Applications/Sublime Text.app/Contents/MacOS/sublime_text"
      ])),
      Some("/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl".into())
    );
    // Without a command, the executable is used wherever it's installed.
    assert_eq!(
      editor_from_macos_processes(&processes(&[
        "/Users/me/Applications/WebStorm.app/Contents/MacOS/webstorm"
      ])),
      Some("/Users/me/Applications/WebStorm.app/Contents/MacOS/webstorm".into())
    );
    assert_eq!(editor_from_macos_processes(&processes(&["/bin/zsh"])), None);
  }

  #[test]
  fn finds_running_linux_and_windows_editors() {
    let names = ["bash".to_string(), "webstorm.sh".to_string()];
    assert_eq!(editor_from_linux_processes(&names), Some("webstorm".into()));
    assert_eq!(editor_from_linux_processes(&["bash".to_string()]), None);

    let paths = [
      r"C:\Windows\explorer.exe".to_string(),
      r"C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe".to_string(),
    ];
    assert_eq!(
      editor_from_windows_processes(&paths),
      Some(paths[1].clone())
    );
  }

  #[test]
  fn skips_terminal_editors() {
    assert!(is_terminal_editor(OsStr::new("/usr/bin/vim")));
    assert!(is_terminal_editor(OsStr::new("nano")));
    assert!(!is_terminal_editor(OsStr::new("code")));
    assert!(!is_terminal_editor(OsStr::new("emacs")));
  }

  #[cfg(target_os = "macos")]
  #[test]
  fn lists_the_current_users_processes() {
    let paths = macos::process_paths();
    let current = std::env::current_exe().unwrap();
    assert!(
      paths.iter().any(|path| Path::new(path) == current),
      "{paths:?}"
    );
  }
}
