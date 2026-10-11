use parcel_core::{AssetType, Diagnostic, DiagnosticList};
use parcel_js::hmr::HmrUpdate;
use std::{
  borrow::Cow,
  collections::HashMap,
  fs::File,
  net::SocketAddr,
  path::{Path, PathBuf},
  sync::{
    Arc, Mutex,
    mpsc::{self, Receiver, Sender},
  },
  thread,
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
  source_roots: Arc<Mutex<SourceRoots>>,
}

/// Serves the source maps of server code. React's RSC client requests them (from
/// `import.meta.devServer`) for the files in server stack traces it shows in the browser.
const SOURCE_MAP_ENDPOINT: &str = "/__parcel_source_map";

/// The files the source map endpoint may read.
#[derive(Default)]
struct SourceRoots {
  project_root: Option<PathBuf>,
  dist_dirs: Vec<PathBuf>,
}

/// A response to a request for one of the server's endpoints.
struct EndpointResponse {
  status: u16,
  content_type: &'static str,
  body: Vec<u8>,
}

/// Serves HMR over WebSockets unless disabled, the server's endpoints, and the files in `dist_dir`
/// if given (`parcel serve`). Otherwise pages are served by something else, i.e. the process
/// started by `parcel run`. That process connects with the token it was started with (see
/// `NodeRunner`), and its messages are sent to the returned receiver. Returns the bound address,
/// whose port may differ from `options.port` when it is 0.
pub fn serve(
  options: &ServerOptions,
  dist_dir: Option<PathBuf>,
) -> Result<(HmrServer, SocketAddr, Receiver<RunnerEvent>), DiagnosticList> {
  let error = |err: &dyn std::fmt::Display| {
    Diagnostic::from_message(format!(
      "Could not start server on {}:{}: {err}",
      options.host, options.port
    ))
  };
  let server = Server::http((&*options.host, options.port)).map_err(|err| error(&err))?;
  let address = server
    .server_addr()
    .to_ip()
    .ok_or_else(|| error(&"not an IP address"))?;

  let hmr = HmrServer::default();
  let hmr_clone = hmr.clone();
  let accept_websockets = options.hmr;
  let (events, receiver) = mpsc::channel();
  thread::spawn(move || {
    for request in server.incoming_requests() {
      if accept_websockets && is_websocket_upgrade(&request) {
        hmr_clone.accept(request, &events);
        continue;
      }

      let base_url = Url::parse("http://localhost").unwrap();
      let url = match base_url.join(request.url()) {
        Ok(url) => url,
        Err(_) => {
          let response = Response::from_string("400 bad request").with_status_code(400);
          let _ = request.respond(response);
          continue;
        }
      };
      if let Some(response) = hmr_clone.respond_to_endpoint(&url) {
        let response = Response::from_data(response.body)
          .with_status_code(response.status)
          .with_header(Header::from_bytes(b"Content-Type", response.content_type).unwrap())
          .with_header(Header::from_bytes(b"Access-Control-Allow-Origin", b"*").unwrap());
        let _ = request.respond(response);
        continue;
      }

      match &dist_dir {
        Some(dist_dir) => serve_file(request, &url, dist_dir),
        None => {
          let response = Response::from_string("404 not found").with_status_code(404);
          let _ = request.respond(response);
        }
      }
    }
  });

  Ok((hmr, address, receiver))
}

/// Responds to `request` with the file at `url` in `dir`.
fn serve_file(request: Request, url: &Url, dir: &Path) {
  let mut full_path = dir.to_path_buf();
  for segment in url.path_segments().unwrap() {
    let decoded = match percent_encoding::percent_decode(segment.as_bytes()).decode_utf8() {
      Ok(d) => d,
      Err(_) => {
        let response = Response::from_string("400 bad request").with_status_code(400);
        let _ = request.respond(response);
        return;
      }
    };
    if decoded.is_empty() {
      continue;
    }
    if decoded == ".." || decoded == "." || decoded.contains('/') || decoded.contains('\\') {
      let response = Response::from_string("400 bad request").with_status_code(400);
      let _ = request.respond(response);
      return;
    }
    full_path.push(decoded.as_ref());
  }

  if full_path.is_dir() {
    full_path.push("index.html");
  }

  let file = if full_path.is_file() && full_path.starts_with(dir) {
    File::open(&full_path).ok()
  } else {
    None
  };
  let Some(file) = file else {
    let response = Response::from_string("404 not found").with_status_code(404);
    let _ = request.respond(response);
    return;
  };
  let ty = full_path
    .extension()
    .and_then(|e| e.to_str())
    .map(|e| AssetType::from_extension(e).mime())
    .unwrap_or("application/octet-stream");
  let response = Response::from_file(file)
    .with_header(Header::from_bytes(b"Content-Type", ty.as_bytes()).unwrap());
  let _ = request.respond(response);
}

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

/// A source map of `contents` to itself, for a source file shown by devtools.
fn identity_source_map(source: &Path, contents: &str) -> Vec<u8> {
  let mut mappings = String::from("AAAA");
  for _ in 1..contents.split('\n').count() {
    mappings.push_str(";AACA");
  }
  let source = source
    .components()
    .map(|component| component.as_os_str().to_string_lossy())
    .collect::<Vec<_>>()
    .join("/");
  serde_json::to_vec(&serde_json::json!({
    "version": 3,
    "sources": [source],
    "sourcesContent": [contents],
    "names": [],
    "mappings": mappings,
  }))
  .unwrap()
}

impl HmrServer {
  /// Sets the files the source map endpoint may read: those in `project_root`, of which the ones in
  /// `dist_dirs` are bundles.
  pub fn set_source_roots(
    &self,
    project_root: &Path,
    dist_dirs: impl IntoIterator<Item = PathBuf>,
  ) {
    let mut dist_dirs: Vec<_> = dist_dirs
      .into_iter()
      .filter_map(|dir| dir.canonicalize().ok())
      .collect();
    dist_dirs.sort();
    dist_dirs.dedup();
    *self.source_roots.lock().unwrap() = SourceRoots {
      project_root: project_root.canonicalize().ok(),
      dist_dirs,
    };
  }

  /// Responds to a request for one of the server's endpoints, or returns `None` for other URLs.
  fn respond_to_endpoint(&self, url: &Url) -> Option<EndpointResponse> {
    if url.path() != SOURCE_MAP_ENDPOINT {
      return None;
    }

    let map = url
      .query_pairs()
      .find(|(key, _)| key == "filename")
      .and_then(|(_, filename)| self.source_map(&filename));
    Some(match map {
      Some(map) => EndpointResponse {
        status: 200,
        content_type: "application/json",
        body: map,
      },
      None => EndpointResponse {
        status: 404,
        content_type: "text/plain",
        body: b"404 not found".to_vec(),
      },
    })
  }

  /// The source map of the file a stack frame refers to. Node prints the sources of Parcel's maps
  /// relative to the project root (see `SourceMapIndex`), and React's RSC client asks for the
  /// absolute paths or `file:` URLs of bundles, which it reads from V8 without Node's mapping.
  fn source_map(&self, filename: &str) -> Option<Vec<u8>> {
    let roots = self.source_roots.lock().unwrap();
    let project_root = roots.project_root.as_ref()?;
    let (path, is_absolute) = if filename.starts_with("file:") {
      (Url::parse(filename).ok()?.to_file_path().ok()?, true)
    } else {
      let path = Path::new(filename);
      (
        project_root.join(path),
        !path.is_relative() || path.has_root(),
      )
    };
    let path = path.canonicalize().ok()?;
    if roots.dist_dirs.iter().any(|dir| path.starts_with(dir)) {
      // A bundle, whose map is written next to it.
      let mut map_path = path.into_os_string();
      map_path.push(".map");
      return std::fs::read(map_path).ok();
    }

    // Only bundles are referred to by absolute paths, so other files are only read from the
    // project, mapped to themselves so that devtools show them.
    if is_absolute {
      return None;
    }
    let relative = path.strip_prefix(project_root).ok()?;
    let contents = std::fs::read_to_string(&path).ok()?;
    Some(identity_source_map(relative, &contents))
  }

  /// Takes over `request`, a WebSocket upgrade, as an HMR client connection: a browser, or the
  /// process started by `parcel run` if it has a token.
  fn accept(&self, request: Request, events: &Sender<RunnerEvent>) {
    let token = Url::parse("http://localhost")
      .unwrap()
      .join(request.url())
      .ok()
      .and_then(|url| {
        url
          .query_pairs()
          .find(|(key, _)| key == "token")
          .map(|(_, token)| token.into_owned())
      });
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
    let hmr = self.clone();
    let events = events.clone();
    thread::spawn(move || {
      let websocket =
        tungstenite::WebSocket::from_raw_socket(stream, tungstenite::protocol::Role::Server, None);
      match token {
        Some(token) => hmr.serve_runner(websocket, token, events),
        None => hmr.sockets.lock().unwrap().push(websocket),
      }
    });
  }

  /// Exchanges messages with a process started by `parcel run`, which sends a message once it has
  /// run its entry, and replies to each update.
  fn serve_runner(
    &self,
    mut websocket: WebSocket<Box<dyn ReadWrite + Send>>,
    token: String,
    events: Sender<RunnerEvent>,
  ) {
    let (sender, outgoing) = mpsc::channel();
    {
      // Only one process runs at a time. Dropping the others' senders ends their threads.
      let mut runners = self.runners.lock().unwrap();
      runners.clear();
      runners.insert(token.clone(), sender);
    }
    let send = |message| {
      let _ = events.send(RunnerEvent {
        token: token.clone(),
        message,
      });
    };

    loop {
      let reply = match websocket.read() {
        Ok(Message::Text(text)) => serde_json::from_str(&text),
        Ok(Message::Close(_)) | Err(_) => break,
        Ok(_) => continue,
      };
      match reply {
        Ok(RunnerReply::Ready) => send(RunnerMessage::Ready),
        Ok(RunnerReply::Updated) => send(RunnerMessage::Updated),
        Ok(RunnerReply::Restart) => send(RunnerMessage::Restart),
        Err(_) => continue,
      }

      let Ok(message) = outgoing.recv() else {
        break;
      };
      if websocket.send(Message::Text(message.into())).is_err() {
        break;
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
  use std::{
    io::{Read, Write},
    net::TcpStream,
    time::{Duration, Instant},
  };

  const TIMEOUT: Duration = Duration::from_secs(5);

  fn serve() -> (HmrServer, SocketAddr, Receiver<RunnerEvent>) {
    super::serve(
      &ServerOptions {
        host: "127.0.0.1".into(),
        port: 0,
        hmr: true,
      },
      None,
    )
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

    // A closed connection is noticed when the next update is sent.
    drop(websocket);
    assert!(server.send_to_runner("abc", &HmrUpdate::Reload));
    assert_eq!(
      events.recv_timeout(TIMEOUT).unwrap().message,
      RunnerMessage::Disconnected
    );
    assert!(!server.send_to_runner("abc", &HmrUpdate::Reload));
  }

  #[test]
  fn a_new_runner_replaces_the_previous_one() {
    let (server, address, events) = serve();
    let (mut first, _) = tungstenite::connect(format!("ws://{address}/?token=first")).unwrap();
    first
      .send(Message::Text(r#"{"type":"ready"}"#.into()))
      .unwrap();
    assert_eq!(events.recv_timeout(TIMEOUT).unwrap().token, "first");

    let (mut second, _) = tungstenite::connect(format!("ws://{address}/?token=second")).unwrap();
    second
      .send(Message::Text(r#"{"type":"ready"}"#.into()))
      .unwrap();
    // The first runner's thread ends rather than waiting for updates forever.
    let mut events: Vec<_> = (0..2)
      .map(|_| {
        let event = events.recv_timeout(TIMEOUT).unwrap();
        (event.token, event.message)
      })
      .collect();
    events.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
      events,
      vec![
        ("first".into(), RunnerMessage::Disconnected),
        ("second".into(), RunnerMessage::Ready)
      ]
    );
    assert!(!server.send_to_runner("first", &HmrUpdate::Reload));
    assert!(server.send_to_runner("second", &HmrUpdate::Reload));
  }

  fn http_get(address: SocketAddr, path: &str) -> (String, String) {
    let mut stream = TcpStream::connect(address).unwrap();
    write!(
      stream,
      "GET {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    let (head, body) = response.split_once("\r\n\r\n").unwrap();
    (head.lines().next().unwrap().to_owned(), body.to_owned())
  }

  fn source_map_path(filename: &str) -> String {
    format!(
      "{SOURCE_MAP_ENDPOINT}?{}",
      url::form_urlencoded::Serializer::new(String::new())
        .append_pair("filename", filename)
        .append_pair("env", "Server")
        .finish()
    )
  }

  #[test]
  fn serves_source_maps_over_http() {
    let root =
      std::env::temp_dir().join(format!("parcel-source-map-endpoint-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let project = root.join("project");
    std::fs::create_dir_all(project.join("src")).unwrap();
    std::fs::create_dir_all(project.join("dist")).unwrap();
    std::fs::write(
      project.join("src/page.js"),
      "export function Page() {\n  return 1;\n}\n",
    )
    .unwrap();
    std::fs::write(project.join("dist/index.js"), "code").unwrap();
    std::fs::write(project.join("dist/index.js.map"), r#"{"version":3}"#).unwrap();
    std::fs::write(root.join("outside.js"), "secret").unwrap();

    let (server, address, _events) = serve();
    server.set_source_roots(&project, [project.join("dist")]);

    // Bundles are served their maps.
    assert_eq!(
      http_get(address, &source_map_path("dist/index.js")),
      ("HTTP/1.1 200 OK".into(), r#"{"version":3}"#.into())
    );

    // Source files are mapped to themselves.
    let (status, body) = http_get(address, &source_map_path("src/page.js"));
    assert_eq!(status, "HTTP/1.1 200 OK");
    let map: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(map["sources"], serde_json::json!(["src/page.js"]));
    assert_eq!(
      map["sourcesContent"],
      serde_json::json!(["export function Page() {\n  return 1;\n}\n"])
    );
    assert_eq!(map["mappings"], "AAAA;AACA;AACA;AACA");

    // React's RSC client refers to bundles by their absolute paths or URLs.
    let bundle = project.join("dist/index.js");
    for filename in [
      bundle.to_str().unwrap().to_owned(),
      Url::from_file_path(&bundle).unwrap().to_string(),
    ] {
      assert_eq!(
        http_get(address, &source_map_path(&filename)),
        ("HTTP/1.1 200 OK".into(), r#"{"version":3}"#.into())
      );
    }

    // Nothing outside the project is readable, nor are other files by absolute paths or URLs.
    let not_found = |filename: &str| {
      let (status, _) = http_get(address, &source_map_path(filename));
      assert_eq!(status, "HTTP/1.1 404 Not Found", "{filename}");
    };
    not_found("../outside.js");
    not_found("src/../../outside.js");
    not_found(root.join("outside.js").to_str().unwrap());
    let source = project.join("src/page.js");
    not_found(source.to_str().unwrap());
    not_found(Url::from_file_path(&source).unwrap().as_str());
    let (status, _) = http_get(address, "/other");
    assert_eq!(status, "HTTP/1.1 404 Not Found");

    std::fs::remove_dir_all(&root).unwrap();
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
