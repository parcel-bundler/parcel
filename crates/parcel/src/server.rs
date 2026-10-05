use parcel_core::{AssetType, Diagnostic, DiagnosticList, LogLevel, Reporters};
use parcel_js::hmr::HmrUpdate;
use std::{
  borrow::Cow,
  collections::HashMap,
  fs::File,
  io::ErrorKind,
  net::{SocketAddr, TcpListener},
  path::Path,
  sync::{
    Arc, Mutex,
    mpsc::{self, Receiver, Sender},
  },
  thread,
  time::Duration,
};
use tiny_http::{Header, ReadWrite, Request, Response, Server};
use tungstenite::{Message, WebSocket};
use url::Url;

pub struct ServerOptions {
  pub host: Cow<'static, str>,
  pub port: u16,
  pub hmr: bool,
}

impl Default for ServerOptions {
  fn default() -> Self {
    ServerOptions {
      host: Cow::Borrowed("0.0.0.0"),
      port: 1234,
      hmr: true,
    }
  }
}

/// Broadcasts HMR messages to the connected browsers, and sends them to processes started by
/// `parcel run`.
#[derive(Clone, Default)]
pub struct HmrServer {
  sockets: Arc<Mutex<Vec<WebSocket<Box<dyn ReadWrite + Send>>>>>,
  /// Messages to send to processes started by `parcel run`, by token.
  runners: Arc<Mutex<HashMap<String, Sender<String>>>>,
}

fn listen(options: &ServerOptions) -> Result<Server, DiagnosticList> {
  Server::http((&*options.host, options.port)).map_err(|err| {
    Diagnostic::from_message(format!(
      "Could not start server on {}:{}: {err}",
      options.host, options.port
    ))
    .into()
  })
}

/// Serves `path` over HTTP, and HMR over WebSockets on the same port unless disabled.
pub fn serve_dir(
  path: &Path,
  options: ServerOptions,
  reporters: Arc<Reporters>,
) -> Result<HmrServer, DiagnosticList> {
  let path = path.to_owned();
  let server = listen(&options)?;
  reporters.log(
    LogLevel::Info,
    &format!("Server listening on http://localhost:{}", options.port),
  );

  let hmr = HmrServer::default();
  let hmr_clone = hmr.clone();
  std::thread::spawn(move || {
    for request in server.incoming_requests() {
      let request = if options.hmr {
        match hmr_clone.accept(request) {
          Some(request) => request,
          None => continue,
        }
      } else {
        request
      };

      let base_url = Url::parse("http://localhost").unwrap();
      let url = match base_url.join(request.url()) {
        Ok(url) => url,
        Err(_) => {
          let response = Response::from_string("400 bad request").with_status_code(400);
          let _ = request.respond(response);
          continue;
        }
      };
      let mut full_path = path.clone();
      let mut bad_request = false;
      for segment in url.path_segments().unwrap() {
        let decoded = match percent_encoding::percent_decode(segment.as_bytes()).decode_utf8() {
          Ok(d) => d,
          Err(_) => {
            bad_request = true;
            break;
          }
        };
        if decoded.is_empty() {
          continue;
        }
        if decoded == ".." || decoded == "." || decoded.contains('/') || decoded.contains('\\') {
          bad_request = true;
          break;
        }
        full_path.push(decoded.as_ref());
      }
      if bad_request {
        let response = Response::from_string("400 bad request").with_status_code(400);
        let _ = request.respond(response);
        continue;
      }

      if full_path.is_dir() {
        full_path.push("index.html");
      }

      if full_path.is_file() && full_path.starts_with(&path) {
        let file = match File::open(&full_path) {
          Ok(file) => file,
          Err(_) => {
            let response = Response::from_string("404 not found").with_status_code(404);
            let _ = request.respond(response);
            continue;
          }
        };
        let ty = full_path
          .extension()
          .and_then(|e| e.to_str())
          .map(|e| AssetType::from_extension(e).mime())
          .unwrap_or("application/octet-stream");
        let response = Response::from_file(file)
          .with_header(Header::from_bytes(b"Content-Type", ty.as_bytes()).unwrap());

        let _ = request.respond(response);
      } else {
        let response = Response::from_string("404 not found").with_status_code(404);
        let _ = request.respond(response);
      }
    }
  });

  Ok(hmr)
}

/// Serves HMR over WebSockets for builds whose pages are served by something else, i.e. the
/// process started by `parcel run`. That process connects with the token it was started with (see
/// `NodeRunner`), and its messages are sent to the returned receiver. Returns the bound address,
/// whose port may differ from `options.port` when it is 0.
pub fn serve_hmr(
  options: &ServerOptions,
) -> Result<(HmrServer, SocketAddr, Receiver<RunnerEvent>), DiagnosticList> {
  let error = |err: std::io::Error| {
    Diagnostic::from_message(format!(
      "Could not start HMR server on {}:{}: {err}",
      options.host, options.port
    ))
  };
  let listener = TcpListener::bind((&*options.host, options.port)).map_err(error)?;
  let address = listener.local_addr().map_err(error)?;

  let hmr = HmrServer::default();
  let hmr_clone = hmr.clone();
  let (events, receiver) = mpsc::channel();
  std::thread::spawn(move || {
    for stream in listener.incoming().flatten() {
      let hmr = hmr_clone.clone();
      let events = events.clone();
      thread::spawn(move || {
        // Socket options are shared by clones, so this sets the WebSocket's read timeout later.
        let Ok(socket) = stream.try_clone() else {
          return;
        };
        let mut token = None;
        let stream: Box<dyn ReadWrite + Send> = Box::new(stream);
        let accepted = tungstenite::accept_hdr(
          stream,
          |request: &tungstenite::handshake::server::Request, response| {
            token = request.uri().query().and_then(|query| {
              url::form_urlencoded::parse(query.as_bytes())
                .find(|(key, _)| key == "token")
                .map(|(_, token)| token.into_owned())
            });
            Ok(response)
          },
        );
        let Ok(websocket) = accepted else {
          return;
        };
        match token {
          Some(token) if socket.set_read_timeout(Some(RUNNER_POLL_INTERVAL)).is_ok() => {
            hmr.serve_runner(websocket, token, events)
          }
          _ => hmr.sockets.lock().unwrap().push(websocket),
        }
      });
    }
  });

  Ok((hmr, address, receiver))
}

/// How long a read from the process started by `parcel run` blocks before checking for messages
/// to send it.
const RUNNER_POLL_INTERVAL: Duration = Duration::from_millis(20);

/// A message from the process started by `parcel run`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunnerMessage {
  /// The process has run its entry.
  Ready,
  /// The last update was applied.
  Updated,
  /// The last update wasn't accepted, so the process must be restarted.
  Restart,
  /// The connection closed, e.g. because the process exited.
  Disconnected,
}

/// A [`RunnerMessage`] from the process started with `token`.
#[derive(Debug)]
pub struct RunnerEvent {
  pub token: String,
  pub message: RunnerMessage,
}

#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum RunnerReply {
  Ready,
  Updated,
  Restart,
}

fn is_websocket_upgrade(request: &tiny_http::Request) -> bool {
  request
    .headers()
    .iter()
    .any(|h| h.field.equiv("Upgrade") && h.value.as_str().eq_ignore_ascii_case("websocket"))
}

impl HmrServer {
  /// Takes over `request` as an HMR client connection if it is a WebSocket upgrade, or returns
  /// it otherwise.
  fn accept(&self, request: Request) -> Option<Request> {
    if !is_websocket_upgrade(&request) {
      return Some(request);
    }

    let ws_key = request
      .headers()
      .iter()
      .find(|h| h.field.equiv("Sec-WebSocket-Key"))
      .map(|h| h.value.as_str());
    let mut response = Response::empty(101);
    response.add_header(Header::from_bytes(b"Upgrade", b"websocket").unwrap());
    response.add_header(Header::from_bytes(b"Connection", b"Upgrade").unwrap());
    if let Some(key) = ws_key {
      let accept_key = tungstenite::handshake::derive_accept_key(key.as_bytes());
      response
        .add_header(Header::from_bytes(b"Sec-WebSocket-Accept", accept_key.as_bytes()).unwrap());
    }

    let stream = request.upgrade("websocket", response);
    let sockets = Arc::clone(&self.sockets);
    thread::spawn(move || {
      let websocket =
        tungstenite::WebSocket::from_raw_socket(stream, tungstenite::protocol::Role::Server, None);
      sockets.lock().unwrap().push(websocket);
    });
    None
  }

  /// Exchanges messages with a process started by `parcel run`. Its WebSocket is only used from
  /// this thread, which alternates between sending queued messages and reading with a timeout.
  fn serve_runner(
    &self,
    mut websocket: WebSocket<Box<dyn ReadWrite + Send>>,
    token: String,
    events: Sender<RunnerEvent>,
  ) {
    let (sender, outgoing) = mpsc::channel();
    self.runners.lock().unwrap().insert(token.clone(), sender);
    let send = |message| {
      let _ = events.send(RunnerEvent {
        token: token.clone(),
        message,
      });
    };

    loop {
      if let Ok(message) = outgoing.try_recv()
        && websocket.send(Message::Text(message.into())).is_err()
      {
        break;
      }
      match websocket.read() {
        Ok(Message::Text(text)) => match serde_json::from_str(&text) {
          Ok(RunnerReply::Ready) => send(RunnerMessage::Ready),
          Ok(RunnerReply::Updated) => send(RunnerMessage::Updated),
          Ok(RunnerReply::Restart) => send(RunnerMessage::Restart),
          Err(_) => {}
        },
        Ok(Message::Close(_)) => break,
        Ok(_) => {}
        Err(tungstenite::Error::Io(err))
          if matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
        Err(_) => break,
      }
    }
    self.runners.lock().unwrap().remove(&token);
    send(RunnerMessage::Disconnected);
  }

  /// Sends `update` to the process started by `parcel run` with `token`. Returns whether it is
  /// connected.
  pub fn send_to_runner(&self, token: &str, update: &HmrUpdate) -> bool {
    let runners = self.runners.lock().unwrap();
    runners
      .get(token)
      .is_some_and(|runner| runner.send(serde_json::to_string(update).unwrap()).is_ok())
  }

  pub fn emit_hmr(&self, update: &HmrUpdate) {
    let serialized = serde_json::to_string(update).unwrap();
    self.broadcast(serialized);
  }

  pub fn emit_hmr_error(&self, diagnostics: &DiagnosticList) {
    let message = HmrUpdate::Error {
      diagnostics: diagnostics.render_for_browser(),
    };
    let serialized = serde_json::to_string(&message).unwrap();
    self.broadcast(serialized);
  }

  fn broadcast(&self, message: String) {
    let mut sockets = self.sockets.lock().unwrap();
    sockets.retain_mut(|ws| {
      match ws.send(Message::Text(message.clone().into())) {
        Ok(_) => true,   // Keep the client
        Err(_) => false, // Drop the client (they disconnected)
      }
    });
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::Instant;

  const TIMEOUT: Duration = Duration::from_secs(5);

  fn serve() -> (HmrServer, SocketAddr, Receiver<RunnerEvent>) {
    serve_hmr(&ServerOptions {
      host: "127.0.0.1".into(),
      port: 0,
      hmr: true,
    })
    .unwrap()
  }

  #[test]
  fn runner_exchanges_messages_by_token() {
    let (server, address, events) = serve();
    let (mut websocket, _) = tungstenite::connect(format!("ws://{address}/?token=abc")).unwrap();
    websocket
      .send(Message::Text(r#"{"type":"ready"}"#.into()))
      .unwrap();
    let event = events.recv_timeout(TIMEOUT).unwrap();
    assert_eq!(event.token, "abc");
    assert_eq!(event.message, RunnerMessage::Ready);

    assert!(!server.send_to_runner("other", &HmrUpdate::Reload));
    assert!(server.send_to_runner("abc", &HmrUpdate::Reload));
    assert_eq!(
      websocket.read().unwrap(),
      Message::Text(r#"{"type":"reload"}"#.into())
    );
    // Browsers don't receive messages for the runner, and vice versa.
    assert!(server.sockets.lock().unwrap().is_empty());

    websocket
      .send(Message::Text(r#"{"type":"restart"}"#.into()))
      .unwrap();
    assert_eq!(
      events.recv_timeout(TIMEOUT).unwrap().message,
      RunnerMessage::Restart
    );

    drop(websocket);
    assert_eq!(
      events.recv_timeout(TIMEOUT).unwrap().message,
      RunnerMessage::Disconnected
    );
    assert!(!server.send_to_runner("abc", &HmrUpdate::Reload));
  }

  #[test]
  fn browsers_connect_without_a_token() {
    let (server, address, _events) = serve();
    let (mut websocket, _) = tungstenite::connect(format!("ws://{address}/")).unwrap();
    let start = Instant::now();
    while server.sockets.lock().unwrap().is_empty() {
      assert!(start.elapsed() < TIMEOUT);
      thread::sleep(Duration::from_millis(10));
    }

    server.emit_hmr(&HmrUpdate::Reload);
    assert_eq!(
      websocket.read().unwrap(),
      Message::Text(r#"{"type":"reload"}"#.into())
    );
  }
}
