use std::{
  hash::BuildHasher,
  net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
  process::{Child, Command},
  sync::mpsc::{Receiver, RecvTimeoutError},
  time::{Duration, Instant},
};

use fixedbitset::FixedBitSet;
use parcel_core::{AssetType, BundleFlags, BundleGraph, PathId};
use parcel_js::hmr::HmrUpdate;

use crate::server::{HmrServer, RunnerEvent, RunnerMessage};

/// How long a process is given to exit after SIGTERM before it is killed.
#[cfg(unix)]
const STOP_TIMEOUT: Duration = Duration::from_secs(2);
/// How long to wait for a started process to run its entry before updating browsers anyway.
const START_TIMEOUT: Duration = Duration::from_secs(5);
/// How long a process is given to apply an update before it is restarted.
const UPDATE_TIMEOUT: Duration = Duration::from_secs(10);
/// How often to check whether the process exited while waiting for it.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// The id of the running process, for the signal handler to stop. 0 when there is none.
#[cfg(unix)]
static CHILD_PID: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

/// Stops the running process when Parcel is terminated by a signal, which skips `Drop`. Otherwise
/// it would keep running (and holding its server's port) after Parcel exits, e.g. when a process
/// manager sends SIGTERM or the terminal closes. Ctrl+C reaches both processes on its own.
#[cfg(unix)]
fn install_signal_handlers() {
  extern "C" fn handle(signal: libc::c_int) {
    let pid = CHILD_PID.load(std::sync::atomic::Ordering::SeqCst);
    unsafe {
      if pid > 0 {
        libc::kill(pid, libc::SIGTERM);
      }
      // Then exit the way the signal would have, so the exit status still reports it.
      libc::signal(signal, libc::SIG_DFL);
      libc::raise(signal);
    }
  }

  static INSTALL: std::sync::Once = std::sync::Once::new();
  INSTALL.call_once(|| {
    for signal in [libc::SIGTERM, libc::SIGHUP, libc::SIGINT] {
      unsafe {
        libc::signal(
          signal,
          handle as extern "C" fn(libc::c_int) as libc::sighandler_t,
        )
      };
    }
  });
}

/// Runs the Node entry of a build. With HMR, updates are applied to the running process, which is
/// restarted when it doesn't accept them. Otherwise it is restarted whenever code it runs changes.
pub struct NodeRunner {
  child: Option<Child>,
  hmr: Option<RunnerHmr>,
  /// The NODE_ENV the build used, which may be a default the parent process doesn't have.
  node_env: Option<String>,
}

/// Where the process connects to, and the token identifying the current one.
struct RunnerHmr {
  server: HmrServer,
  events: Receiver<RunnerEvent>,
  address: SocketAddr,
  token: String,
}

impl NodeRunner {
  pub fn new(
    hmr: Option<(HmrServer, SocketAddr, Receiver<RunnerEvent>)>,
    node_env: Option<String>,
  ) -> Self {
    #[cfg(unix)]
    install_signal_handlers();
    NodeRunner {
      child: None,
      node_env,
      hmr: hmr.map(|(server, address, events)| {
        // The process connects locally even when the server listens on all interfaces.
        let ip = match address.ip() {
          IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
          IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
          ip => ip,
        };
        RunnerHmr {
          server,
          events,
          address: SocketAddr::new(ip, address.port()),
          token: String::new(),
        }
      }),
    }
  }

  /// Starts `entry`, stopping the running process first. With HMR, waits until the new process
  /// has run its entry, so that pages reloaded afterwards reach it.
  pub fn restart(&mut self, entry: PathId) {
    self.stop();
    if let Some(hmr) = &mut self.hmr {
      hmr.token = format!(
        "{:016x}",
        std::collections::hash_map::RandomState::new().hash_one(std::time::SystemTime::now())
      );
    }
    match self.command(entry).spawn() {
      Ok(child) => {
        #[cfg(unix)]
        CHILD_PID.store(child.id() as i32, std::sync::atomic::Ordering::SeqCst);
        self.child = Some(child);
      }
      Err(err) => {
        eprintln!("Could not start node: {err}");
        return;
      }
    }

    self.wait_for(&[RunnerMessage::Ready], START_TIMEOUT);
  }

  /// The command that runs `entry`. The process inherits Parcel's environment, as if it was run
  /// with node directly.
  fn command(&self, entry: PathId) -> Command {
    let mut command = Command::new("node");
    command
      .arg("--enable-source-maps")
      .arg(&*entry.to_path_buf().to_string_lossy());
    if let Some(node_env) = &self.node_env {
      command.env("NODE_ENV", node_env);
    }
    if let Some(hmr) = &self.hmr {
      // The runtime connects to this instead of the HMR server browsers use, and its token tells
      // the server which process is on the other end.
      command.env(
        "PARCEL_HMR_URL",
        format!("ws://{}/?token={}", hmr.address, hmr.token),
      );
    }
    command
  }

  /// Applies `update` to the running process, and restarts it with `entry` if the process doesn't
  /// accept it. Returns once the process is running the new code.
  pub fn update(&mut self, entry: PathId, update: &HmrUpdate) {
    let sent = matches!(update, HmrUpdate::Update { .. })
      && self
        .hmr
        .as_ref()
        .is_some_and(|hmr| hmr.server.send_to_runner(&hmr.token, update));
    let applied = sent
      && self.wait_for(
        &[
          RunnerMessage::Updated,
          RunnerMessage::Restart,
          RunnerMessage::Disconnected,
        ],
        UPDATE_TIMEOUT,
      ) == Some(RunnerMessage::Updated);
    if !applied {
      self.restart(entry);
    }
  }

  /// Waits for one of `messages` from the current process. Returns `None` on timeout, or if the
  /// process exits first.
  fn wait_for(&mut self, messages: &[RunnerMessage], timeout: Duration) -> Option<RunnerMessage> {
    let hmr = self.hmr.as_ref()?;
    let deadline = Instant::now() + timeout;
    loop {
      let remaining = deadline.saturating_duration_since(Instant::now());
      if remaining.is_zero() {
        return None;
      }
      match hmr.events.recv_timeout(remaining.min(POLL_INTERVAL)) {
        Ok(event) if event.token == hmr.token && messages.contains(&event.message) => {
          return Some(event.message);
        }
        Ok(_) => {}
        Err(RecvTimeoutError::Timeout) => {
          let exited = self
            .child
            .as_mut()
            .is_none_or(|child| !matches!(child.try_wait(), Ok(None)));
          if exited {
            return None;
          }
        }
        Err(RecvTimeoutError::Disconnected) => return None,
      }
    }
  }

  pub fn stop(&mut self) {
    let Some(mut child) = self.child.take() else {
      return;
    };
    #[cfg(unix)]
    CHILD_PID.store(0, std::sync::atomic::Ordering::SeqCst);
    if let Ok(Some(_)) = child.try_wait() {
      return;
    }

    // Let the process shut down cleanly (e.g. close its server so the port is free for the next
    // one), but don't wait forever on one that ignores SIGTERM.
    #[cfg(unix)]
    {
      unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) };
      let start = Instant::now();
      while start.elapsed() < STOP_TIMEOUT {
        if let Ok(Some(_)) = child.try_wait() {
          return;
        }
        std::thread::sleep(Duration::from_millis(10));
      }
    }
    let _ = child.kill();
    let _ = child.wait();
  }
}

impl Drop for NodeRunner {
  fn drop(&mut self) {
    self.stop();
  }
}

/// The index of the bundle `parcel run` executes.
pub fn node_entry(bundle_graph: &BundleGraph) -> Option<usize> {
  bundle_graph.bundles.iter().position(|b| {
    b.flags.contains(BundleFlags::ENTRY) && b.ty == AssetType::Js && b.target.environment.is_node()
  })
}

/// The assets the process running `entry` may load: those in the entry and the JS bundles in its
/// execution context, including client code it renders on the server.
pub fn entry_context_assets(bundle_graph: &BundleGraph, entry: usize) -> FixedBitSet {
  let mut assets = FixedBitSet::with_capacity(bundle_graph.asset_graph.assets.len());
  let closure = bundle_graph.context_closure(&bundle_graph.bundles[entry]);
  for &index in std::iter::once(&entry).chain(closure) {
    let bundle = &bundle_graph.bundles[index];
    if bundle.ty == AssetType::Js {
      assets.extend(bundle.assets.iter().map(|asset| asset.index()));
    }
  }
  assets
}

#[cfg(test)]
mod tests {
  use std::{ffi::OsStr, path::Path};

  use super::*;

  #[test]
  fn command_sets_build_node_env() {
    let runner = NodeRunner::new(None, Some("development".into()));
    let command = runner.command(PathId::new(Path::new("/dist/index.js")));
    let envs: Vec<_> = command.get_envs().collect();
    assert_eq!(
      envs,
      vec![(OsStr::new("NODE_ENV"), Some(OsStr::new("development")))]
    );
  }
}
