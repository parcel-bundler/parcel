use parcel_core::{AssetType, Diagnostic, DiagnosticList, RenderedDiagnostics};

use crate::{
  http::{Reply, Request, Response, Server, Stream},
  launch_editor::launch_editor,
};
use parcel_js::hmr::HmrUpdate;
use std::{
  borrow::Cow,
  collections::HashMap,
  fs::File,
  net::SocketAddr,
  path::{Path, PathBuf},
  sync::{
    Arc, Condvar, Mutex,
    mpsc::{self, Receiver, Sender},
  },
};
use tungstenite::{Message, WebSocket};
use url::Url;

pub struct ServerOptions {
  pub host: Cow<'static, str>,
  pub port: u16,
  pub hmr: bool,
  /// Whether to open the page in a browser once the server starts.
  pub open: bool,
  /// The browser to open it in, otherwise the default one.
  pub browser: Option<String>,
  /// Serves HTTPS as well as HTTP when set.
  pub https: Option<HttpsOptions>,
}

/// The PEM files of the certificate and private key to serve HTTPS with.
#[derive(Clone)]
pub struct HttpsOptions {
  pub cert: PathBuf,
  pub key: PathBuf,
}

impl Default for ServerOptions {
  fn default() -> Self {
    ServerOptions {
      host: Cow::Borrowed("0.0.0.0"),
      port: 1234,
      hmr: true,
      open: false,
      browser: None,
      https: None,
    }
  }
}

/// Broadcasts HMR messages to the connected browsers, and sends them to processes started by
/// `parcel run`.
#[derive(Clone, Default)]
pub struct HmrServer {
  sockets: Arc<Mutex<Vec<WebSocket<Box<dyn Stream>>>>>,
  /// Messages to send to processes started by `parcel run`, by token.
  runners: Arc<Mutex<HashMap<String, Sender<String>>>>,
  source_roots: Arc<Mutex<SourceRoots>>,
  build: Arc<(Mutex<BuildState>, Condvar)>,
}

/// The state of the build whose output `parcel serve` serves.
#[derive(Default)]
struct BuildState {
  /// Whether a build is in progress. Requests for its output wait for it to finish.
  pending: bool,
  /// The page shown instead of the output when the build failed.
  error_page: Option<String>,
  /// Whether the error page reloads on the next HMR message.
  hmr: bool,
}

/// Serves the source maps of server code. React's RSC client requests them (from
/// `import.meta.devServer`) for the files in server stack traces it shows in the browser.
const SOURCE_MAP_ENDPOINT: &str = "/__parcel_source_map";

/// Opens a file in the user's editor, e.g. from the build error overlay. `file` is a path relative
/// to the current directory, optionally followed by `:line:column`, like diagnostics' locations.
const LAUNCH_EDITOR_ENDPOINT: &str = "/__parcel_launch_editor";

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
  let tls = options
    .https
    .as_ref()
    .map(|https| crate::http::tls_config(&https.cert, &https.key))
    .transpose()
    .map_err(|err| Diagnostic::from_message(err))?;
  let server = Server::bind((&*options.host, options.port), tls).map_err(|err| error(&err))?;
  let address = server.local_addr().map_err(|err| error(&err))?;

  let hmr = HmrServer::default();
  let hmr_clone = hmr.clone();
  let accept_websockets = options.hmr;
  hmr.build.0.lock().unwrap().hmr = options.hmr;
  let (events, receiver) = mpsc::channel();
  server.run(move |request| {
    if accept_websockets && is_websocket_upgrade(&request) {
      return hmr_clone.accept(&request, &events);
    }

    let base_url = Url::parse("http://localhost").unwrap();
    let Ok(url) = base_url.join(&request.url) else {
      return Reply::Respond(Response::new(400, "400 bad request"));
    };
    if let Some(response) = hmr_clone.respond_to_endpoint(&url) {
      return Reply::Respond(
        Response::new(response.status, response.body)
          .with_header("Content-Type", response.content_type)
          .with_header("Access-Control-Allow-Origin", "*"),
      );
    }

    Reply::Respond(match &dist_dir {
      Some(dist_dir) => match hmr_clone.wait_for_build() {
        Some(error_page) => {
          Response::new(500, error_page).with_header("Content-Type", "text/html; charset=utf-8")
        }
        None => serve_file(&url, dist_dir),
      },
      None => Response::new(404, "404 not found"),
    })
  });

  Ok((hmr, address, receiver))
}

/// The file at `url` in `dir`.
fn serve_file(url: &Url, dir: &Path) -> Response {
  let mut full_path = dir.to_path_buf();
  for segment in url.path_segments().unwrap() {
    let Ok(decoded) = percent_encoding::percent_decode(segment.as_bytes()).decode_utf8() else {
      return Response::new(400, "400 bad request");
    };
    if decoded.is_empty() {
      continue;
    }
    if decoded == ".." || decoded == "." || decoded.contains('/') || decoded.contains('\\') {
      return Response::new(400, "400 bad request");
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
    return Response::new(404, "404 not found");
  };
  let ty = full_path
    .extension()
    .and_then(|e| e.to_str())
    .map(|e| AssetType::from_extension(e).mime())
    .unwrap_or("application/octet-stream");
  Response::file(file).with_header("Content-Type", ty)
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

fn is_websocket_upgrade(request: &Request) -> bool {
  request
    .header("Upgrade")
    .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
}

/// A page showing build errors, like the overlay the HMR runtime shows over pages. With HMR, it
/// reloads on the next update.
fn error_page(diagnostics: &RenderedDiagnostics, hmr: bool) -> String {
  use std::fmt::Write;

  // The diagnostics are HTML, but the editor links need their plain locations.
  let unescape = |html: &str| {
    html
      .replace("&lt;", "<")
      .replace("&gt;", ">")
      .replace("&quot;", "\"")
      .replace("&#39;", "'")
      .replace("&amp;", "&")
  };
  let mut body = String::new();
  for diagnostic in &diagnostics.html {
    write!(body, "<h2 class=\"message\">{}</h2>", diagnostic.message).unwrap();
    body.push_str("<div class=\"stack\">");
    if diagnostic.frames.is_empty() {
      body.push_str(diagnostic.stack.as_deref().unwrap_or_default());
    }
    for frame in &diagnostic.frames {
      let file: String =
        url::form_urlencoded::byte_serialize(unescape(&frame.location).as_bytes()).collect();
      write!(
        body,
        "<a href=\"{LAUNCH_EDITOR_ENDPOINT}?file={file}\" onclick=\"fetch(this.href); return false\">{}</a>\n{}\n",
        frame.location, frame.code
      )
      .unwrap();
    }
    body.push_str("</div><ul class=\"hints\">");
    for hint in &diagnostic.hints {
      write!(body, "<li>{hint}</li>").unwrap();
    }
    body.push_str("</ul>");
    if let Some(documentation) = &diagnostic.documentation {
      write!(
        body,
        "<div class=\"documentation\">📝 <a href=\"{documentation}\" target=\"_blank\">Learn more</a></div>"
      )
      .unwrap();
    }
  }

  let script = if hmr {
    // HMR messages are only sent after a later build, which this page then shows.
    "<script>
      var ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/');
      ws.onmessage = function () {
        location.reload();
      };
    </script>"
  } else {
    ""
  };

  format!(
    r#"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>🚨 Build Error</title>
    <style>
      html {{ color-scheme: dark light; background-color: #282c33; }}
      body {{ margin: 0; font-family: sans-serif; }}
      h1 {{ font-size: 2rem; background-color: #fe0140; color: #ffffff; margin: 0 0 20px 0; padding: 10px; }}
      .message {{ font-size: 1.2rem; color: salmon; margin: 10px; font-family: Menlo, Consolas, monospace; white-space: pre; }}
      .stack {{ padding: 20px 10px; color: #c5ccdb; font-family: Menlo, Consolas, monospace; font-size: 0.8rem; white-space: pre; }}
      .stack a {{ color: #888; }}
      .hints {{ margin: 5px 0 20px 0; list-style: none; padding: 0; }}
      .hints li {{ color: #5e8af7; font-size: 0.8rem; padding: 0 0 0 5px; font-family: Menlo, Consolas, monospace; }}
      .hints li:before {{ content: '💡 '; }}
      .documentation {{ padding: 0 5px; font-family: Menlo, Consolas, monospace; font-size: 0.8rem; }}
      .documentation a {{ color: violet; }}
    </style>
  </head>
  <body>
    <h1>🚨 Parcel encountered errors</h1>
    {body}
    {script}
  </body>
</html>
"#
  )
}

enum EditorError {
  NotFound,
  Launch(String),
}

/// Splits `location` into a path and the line and column at its end, e.g. `src/a.js:3:5`.
fn parse_location(location: &str) -> (&str, Option<u32>, Option<u32>) {
  let number = |s: &str| {
    (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
      .then(|| s.parse().ok())
      .flatten()
  };
  let Some((rest, last)) = location.rsplit_once(':') else {
    return (location, None, None);
  };
  let Some(last) = number(last) else {
    return (location, None, None);
  };
  match rest.rsplit_once(':') {
    Some((file, line)) if let Some(line) = number(line) => (file, Some(line), Some(last)),
    _ => (rest, Some(last), None),
  }
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

  /// Holds requests for the build's output until it finishes (see `wait_for_build`).
  pub fn build_started(&self) {
    self.build.0.lock().unwrap().pending = true;
  }

  pub fn build_succeeded(&self) {
    self.finish_build(None);
  }

  /// Shows `diagnostics` instead of the build's output until a later build succeeds.
  pub fn build_failed(&self, diagnostics: &DiagnosticList) {
    let hmr = self.build.0.lock().unwrap().hmr;
    self.finish_build(Some(error_page(&diagnostics.render_for_browser(), hmr)));
  }

  fn finish_build(&self, error_page: Option<String>) {
    let (state, finished) = &*self.build;
    let mut state = state.lock().unwrap();
    state.pending = false;
    state.error_page = error_page;
    finished.notify_all();
  }

  /// Waits for a build in progress, so that pages reflect the latest changes, and returns the error
  /// page if the build failed.
  fn wait_for_build(&self) -> Option<String> {
    let (state, finished) = &*self.build;
    let state = finished
      .wait_while(state.lock().unwrap(), |state| state.pending)
      .unwrap();
    state.error_page.clone()
  }

  /// Responds to a request for one of the server's endpoints, or returns `None` for other URLs.
  fn respond_to_endpoint(&self, url: &Url) -> Option<EndpointResponse> {
    if url.path() == LAUNCH_EDITOR_ENDPOINT {
      let file = url
        .query_pairs()
        .find(|(key, _)| key == "file")
        .map(|(_, file)| file.into_owned());
      return Some(match file.map(|file| self.launch_editor(&file)) {
        Some(Ok(())) => EndpointResponse {
          status: 200,
          content_type: "text/plain",
          body: Vec::new(),
        },
        Some(Err(EditorError::Launch(message))) => {
          eprintln!("{message}");
          EndpointResponse {
            status: 500,
            content_type: "text/plain",
            body: message.into_bytes(),
          }
        }
        None | Some(Err(EditorError::NotFound)) => EndpointResponse {
          status: 404,
          content_type: "text/plain",
          body: b"404 not found".to_vec(),
        },
      });
    }
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

  /// Opens the project file at `location`, a path relative to the current directory optionally
  /// followed by `:line:column`, in the user's editor.
  fn launch_editor(&self, location: &str) -> Result<(), EditorError> {
    let (file, line, column) = parse_location(location);
    let file = Path::new(file);
    if !file.is_relative() || file.has_root() {
      return Err(EditorError::NotFound);
    }
    let path = std::env::current_dir()
      .map_err(|_| EditorError::NotFound)?
      .join(file);
    let canonical = path.canonicalize().map_err(|_| EditorError::NotFound)?;
    let roots = self.source_roots.lock().unwrap();
    if !roots
      .project_root
      .as_ref()
      .is_some_and(|root| canonical.starts_with(root))
      || !canonical.is_file()
    {
      return Err(EditorError::NotFound);
    }
    drop(roots);
    launch_editor(&path, line, column).map_err(EditorError::Launch)
  }

  /// Takes over the connection of `request`, a WebSocket upgrade, as an HMR client connection: a
  /// browser, or the process started by `parcel run` if it has a token.
  fn accept(&self, request: &Request, events: &Sender<RunnerEvent>) -> Reply {
    let token = Url::parse("http://localhost")
      .unwrap()
      .join(&request.url)
      .ok()
      .and_then(|url| {
        url
          .query_pairs()
          .find(|(key, _)| key == "token")
          .map(|(_, token)| token.into_owned())
      });
    let mut response = Response::new(101, "")
      .with_header("Upgrade", "websocket")
      .with_header("Connection", "Upgrade");
    if let Some(key) = request.header("Sec-WebSocket-Key") {
      let accept_key = tungstenite::handshake::derive_accept_key(key.as_bytes());
      response = response.with_header("Sec-WebSocket-Accept", accept_key);
    }

    let hmr = self.clone();
    let events = events.clone();
    Reply::Upgrade(
      response,
      Box::new(move |stream, rest| {
        let websocket =
          WebSocket::from_partially_read(stream, rest, tungstenite::protocol::Role::Server, None);
        match token {
          Some(token) => hmr.serve_runner(websocket, token, events),
          None => hmr.sockets.lock().unwrap().push(websocket),
        }
      }),
    )
  }

  /// Exchanges messages with a process started by `parcel run`, which sends a message once it has
  /// run its entry, and replies to each update.
  fn serve_runner(
    &self,
    mut websocket: WebSocket<Box<dyn Stream>>,
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
  use rustls::pki_types::CertificateDer;
  use std::{
    io::{Read, Write},
    net::TcpStream,
    thread,
    time::{Duration, Instant},
  };

  const TIMEOUT: Duration = Duration::from_secs(5);

  fn serve() -> (HmrServer, SocketAddr, Receiver<RunnerEvent>) {
    super::serve(
      &ServerOptions {
        host: "127.0.0.1".into(),
        port: 0,
        hmr: true,
        ..Default::default()
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
  fn shows_build_errors_instead_of_the_output() {
    let root = std::env::temp_dir().join(format!("parcel-build-errors-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("index.html"), "output").unwrap();
    let (server, address, _events) = super::serve(
      &ServerOptions {
        host: "127.0.0.1".into(),
        port: 0,
        hmr: true,
        ..Default::default()
      },
      Some(root.clone()),
    )
    .unwrap();

    server.build_failed(&DiagnosticList(vec![Diagnostic {
      message: "Unexpected <token>".into(),
      code_frames: vec![parcel_core::CodeFrame {
        code: Some("let x = ;\n".into()),
        url: Some(parcel_core::SourceUrl::from_path(
          &parcel_core::PathId::new(&std::env::current_dir().unwrap().join("src/a&b.js")),
        )),
        language: Some(AssetType::Js),
        code_highlights: vec![parcel_core::CodeHighlight {
          start: parcel_core::Location { line: 1, column: 9 },
          end: parcel_core::Location { line: 1, column: 9 },
          message: None,
        }],
      }],
      ..Diagnostic::from_message(String::new())
    }]));
    let (status, body) = http_get(address, "/");
    assert_eq!(status, "HTTP/1.1 500 Internal Server Error");
    assert!(body.contains("Unexpected &lt;token&gt;"), "{body}");
    assert!(
      body.contains(&format!(
        "{LAUNCH_EDITOR_ENDPOINT}?file=src%2Fa%26b.js%3A1%3A9"
      )),
      "{body}"
    );
    assert!(body.contains("new WebSocket"), "{body}");

    // Requests during a build wait for it.
    server.build_started();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || sender.send(http_get(address, "/")).unwrap());
    assert!(receiver.recv_timeout(Duration::from_millis(200)).is_err());
    server.build_succeeded();
    assert_eq!(
      receiver.recv_timeout(TIMEOUT).unwrap(),
      ("HTTP/1.1 200 OK".into(), "output".into())
    );

    std::fs::remove_dir_all(&root).unwrap();
  }

  #[test]
  fn parses_locations() {
    assert_eq!(parse_location("src/a.js"), ("src/a.js", None, None));
    assert_eq!(parse_location("src/a.js:3"), ("src/a.js", Some(3), None));
    assert_eq!(
      parse_location("src/a.js:3:5"),
      ("src/a.js", Some(3), Some(5))
    );
    assert_eq!(
      parse_location("src/a:b.js:3:5"),
      ("src/a:b.js", Some(3), Some(5))
    );
    assert_eq!(parse_location("src/a.js:x"), ("src/a.js:x", None, None));
  }

  #[test]
  fn only_opens_project_files_in_the_editor() {
    let root = std::env::temp_dir().join(format!("parcel-launch-editor-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("project/src")).unwrap();
    std::fs::write(root.join("outside.js"), "").unwrap();
    let (server, address, _events) = serve();
    server.set_source_roots(&root.join("project"), []);

    let cwd = std::env::current_dir().unwrap();
    let relative = |path: &Path| {
      let mut relative = PathBuf::new();
      for _ in cwd.components().skip(1) {
        relative.push("..");
      }
      relative.join(path.strip_prefix("/").unwrap_or(path))
    };
    for file in [
      relative(&root.join("outside.js"))
        .to_string_lossy()
        .into_owned(),
      relative(&root.join("project/src/missing.js"))
        .to_string_lossy()
        .into_owned(),
      root.join("outside.js").to_string_lossy().into_owned(),
    ] {
      let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("file", &format!("{file}:1:1"))
        .finish();
      let (status, _) = http_get(address, &format!("{LAUNCH_EDITOR_ENDPOINT}?{query}"));
      assert_eq!(status, "HTTP/1.1 404 Not Found", "{file}");
    }

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

  #[test]
  fn keeps_connections_alive() {
    let (_server, address, _events) = serve();
    let mut stream = TcpStream::connect(address).unwrap();
    let mut response = Vec::new();
    for _ in 0..2 {
      write!(stream, "GET /other HTTP/1.1\r\nHost: {address}\r\n\r\n").unwrap();
      let mut chunk = [0; 1024];
      let read = stream.read(&mut chunk).unwrap();
      response.extend_from_slice(&chunk[..read]);
    }
    let response = String::from_utf8(response).unwrap();
    assert_eq!(
      response.matches("HTTP/1.1 404 Not Found\r\n").count(),
      2,
      "{response}"
    );
  }

  /// A certificate for localhost signed by a new CA, written to `dir`, and the CA's certificate.
  fn certificate(dir: &Path) -> (HttpsOptions, CertificateDer<'static>) {
    let ca_key = rcgen::KeyPair::generate().unwrap();
    let mut ca_params = rcgen::CertificateParams::new(Vec::<String>::new()).unwrap();
    ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    let ca_cert = ca_params.self_signed(&ca_key).unwrap();
    let issuer = rcgen::Issuer::new(ca_params, ca_key);
    let key = rcgen::KeyPair::generate().unwrap();
    let cert = rcgen::CertificateParams::new(vec!["localhost".to_string()])
      .unwrap()
      .signed_by(&key, &issuer)
      .unwrap();

    std::fs::create_dir_all(dir).unwrap();
    let options = HttpsOptions {
      cert: dir.join("cert.pem"),
      key: dir.join("key.pem"),
    };
    std::fs::write(&options.cert, cert.pem()).unwrap();
    std::fs::write(&options.key, key.serialize_pem()).unwrap();
    (options, ca_cert.der().clone())
  }

  /// A TLS connection to localhost at `address`, trusting `ca`.
  fn tls_connect(
    address: SocketAddr,
    ca: &CertificateDer<'static>,
  ) -> rustls::StreamOwned<rustls::ClientConnection, TcpStream> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(ca.clone()).unwrap();
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
      rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_root_certificates(roots)
    .with_no_client_auth();
    let connection =
      rustls::ClientConnection::new(Arc::new(config), "localhost".try_into().unwrap()).unwrap();
    rustls::StreamOwned::new(connection, TcpStream::connect(address).unwrap())
  }

  #[test]
  fn serves_https_and_http_on_the_same_port() {
    let root = std::env::temp_dir().join(format!("parcel-https-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let (https, ca) = certificate(&root.join("certs"));
    std::fs::create_dir_all(root.join("dist")).unwrap();
    std::fs::write(root.join("dist/index.html"), "output").unwrap();
    let (server, address, events) = super::serve(
      &ServerOptions {
        host: "127.0.0.1".into(),
        port: 0,
        hmr: true,
        https: Some(https),
        ..Default::default()
      },
      Some(root.join("dist")),
    )
    .unwrap();
    server.build_succeeded();

    let mut stream = tls_connect(address, &ca);
    write!(
      stream,
      "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    // The server closes without a TLS close_notify, which rustls reports as an error.
    let _ = stream.read_to_string(&mut response);
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
    assert!(response.ends_with("\r\n\r\noutput"), "{response}");

    assert_eq!(
      http_get(address, "/"),
      ("HTTP/1.1 200 OK".into(), "output".into())
    );

    // Browsers connect over TLS.
    let (mut browser, _) = tungstenite::client(
      format!("wss://localhost:{}/", address.port()),
      tls_connect(address, &ca),
    )
    .unwrap();
    let start = Instant::now();
    while server.sockets.lock().unwrap().is_empty() {
      assert!(start.elapsed() < TIMEOUT);
      thread::sleep(Duration::from_millis(10));
    }
    server.emit_hmr(&HmrUpdate::Reload);
    assert_eq!(
      browser.read().unwrap(),
      Message::Text(r#"{"type":"reload"}"#.into())
    );

    // The process started by `parcel run` connects without TLS.
    let (mut runner, _) = tungstenite::connect(format!("ws://{address}/?token=abc")).unwrap();
    runner
      .send(Message::Text(r#"{"type":"ready"}"#.into()))
      .unwrap();
    assert_eq!(
      events.recv_timeout(TIMEOUT).unwrap().message,
      RunnerMessage::Ready
    );

    std::fs::remove_dir_all(&root).unwrap();
  }

  #[test]
  fn reports_invalid_certificates() {
    let root = std::env::temp_dir().join(format!("parcel-bad-cert-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("empty.pem"), "").unwrap();
    let serve = |cert: &str, key: &str| {
      super::serve(
        &ServerOptions {
          host: "127.0.0.1".into(),
          port: 0,
          https: Some(HttpsOptions {
            cert: root.join(cert),
            key: root.join(key),
          }),
          ..Default::default()
        },
        None,
      )
      .err()
      .unwrap()
      .0[0]
        .message
        .clone()
    };
    assert!(
      serve("missing.pem", "key.pem").starts_with("Could not read certificate"),
      "{}",
      serve("missing.pem", "key.pem")
    );
    assert!(serve("empty.pem", "key.pem").starts_with("No certificates found"));
    std::fs::remove_dir_all(&root).unwrap();
  }
}
