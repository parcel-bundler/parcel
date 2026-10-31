use parcel_core::{AssetType, DiagnosticList, LogLevel, RenderedDiagnostics, Reporters};

use crate::{
  http::{Reply, Request, Response, Server, Stream},
  launch_editor::launch_editor,
};
use parcel_js::hmr::HmrUpdate;
use std::{
  borrow::Cow,
  collections::HashMap,
  fs::File,
  io,
  net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener},
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
  /// Whether `port` must be used. Otherwise, when it is taken the following ports are tried in
  /// order, so that the port only changes when something else is running.
  pub strict_port: bool,
  pub hmr: bool,
  /// Whether to open the page in a browser once the server starts.
  pub open: bool,
  /// The browser to open it in, otherwise the default one.
  pub browser: Option<String>,
  /// Serves HTTPS as well as HTTP when set.
  pub https: Option<HttpsOptions>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum HttpsOptions {
  /// Certificates signed by the local CA (see `cert`).
  Generate,
  /// The PEM files of the certificate and private key to serve.
  Files { cert: PathBuf, key: PathBuf },
}

impl Default for ServerOptions {
  fn default() -> Self {
    ServerOptions {
      host: Cow::Borrowed("0.0.0.0"),
      port: 1234,
      strict_port: false,
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
  /// Where the server logs, once the build's reporters exist (see `set_reporters`).
  reporters: Arc<std::sync::OnceLock<Arc<Reporters>>>,
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

/// The build output served by `parcel serve`.
pub struct Output {
  pub dir: PathBuf,
  /// The URL path it's served under, from the public URL, e.g. `/app/` for `/app` or
  /// `https://cdn.example.com/app/`. Relative public URLs depend on the page, so they serve from `/`.
  pub base_path: String,
}

impl Output {
  pub fn new(dir: PathBuf, public_url: &str) -> Self {
    let base_path = if public_url.starts_with('/') || Url::parse(public_url).is_ok() {
      let url = Url::parse("http://localhost/")
        .unwrap()
        .join(public_url)
        .unwrap();
      let path = url.path().trim_end_matches('/');
      format!("{path}/")
    } else {
      "/".to_owned()
    };
    Output { dir, base_path }
  }
}

/// Binds the server's port, which is the next free one after `options.port` if that is taken and
/// it isn't strict.
pub fn listen(options: &ServerOptions) -> Result<TcpListener, DiagnosticList> {
  let mut port = options.port;
  loop {
    match bind(&options.host, port) {
      Err(err)
        if err.kind() == io::ErrorKind::AddrInUse && !options.strict_port && port < u16::MAX =>
      {
        port += 1
      }
      result => {
        return result.map_err(|err| {
          DiagnosticList(vec![crate::cli_diagnostic(format!(
            "Could not start server on {}:{port}: {err}",
            options.host
          ))])
        });
      }
    }
  }
}

fn bind(host: &str, port: u16) -> io::Result<TcpListener> {
  // Binding all interfaces succeeds on some platforms (e.g. macOS) even if another server is
  // listening on the loopback address, which would then receive requests to localhost instead.
  let unspecified = host.parse::<IpAddr>().is_ok_and(|ip| ip.is_unspecified());
  if unspecified && port != 0 {
    for loopback in [
      IpAddr::from(Ipv4Addr::LOCALHOST),
      IpAddr::from(Ipv6Addr::LOCALHOST),
    ] {
      match TcpListener::bind((loopback, port)) {
        Err(err) if err.kind() == io::ErrorKind::AddrInUse => return Err(err),
        // E.g. IPv6 is unavailable.
        _ => {}
      }
    }
  }
  TcpListener::bind((host, port))
}

/// Serves HMR over WebSockets unless disabled, the server's endpoints, and `output` if given
/// (`parcel serve`). Otherwise pages are served by something else, i.e. the process
/// started by `parcel run`. That process connects with the token it was started with (see
/// `NodeRunner`), and its messages are sent to the returned receiver. Returns the bound address,
/// whose port may differ from `options.port` (see `listen`).
pub fn serve(
  options: &ServerOptions,
  output: Option<Output>,
) -> Result<(HmrServer, SocketAddr, Receiver<RunnerEvent>), DiagnosticList> {
  serve_on(listen(options)?, options, output)
}

/// Like `serve`, on a port bound by `listen`.
pub fn serve_on(
  listener: TcpListener,
  options: &ServerOptions,
  output: Option<Output>,
) -> Result<(HmrServer, SocketAddr, Receiver<RunnerEvent>), DiagnosticList> {
  let address = listener
    .local_addr()
    .map_err(|err| crate::cli_diagnostic(format!("Could not start server: {err}")))?;
  let tls = options
    .https
    .as_ref()
    .map(|https| match https {
      HttpsOptions::Generate => {
        let dir = crate::cert::ca_dir().ok_or(
          "Could not find a directory for the local certificate authority. Set PARCEL_CAROOT",
        )?;
        let (ca, _) = crate::cert::LocalCa::load_or_create(&dir)?;
        let provider = crate::http::crypto_provider();
        let resolver = crate::cert::CertResolver::new(ca, provider.clone(), &options.host)?;
        crate::http::resolver_tls_config(provider, Arc::new(resolver))
      }
      HttpsOptions::Files { cert, key } => crate::http::tls_config(cert, key),
    })
    .transpose()
    .map_err(crate::cli_diagnostic)?;
  let server = Server::new(listener, tls);

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

    Reply::Respond(match &output {
      Some(output) => match hmr_clone.wait_for_build() {
        Some(error_page) => {
          Response::new(500, error_page).with_header("Content-Type", "text/html; charset=utf-8")
        }
        None => serve_file(&request, &url, output),
      },
      None => Response::new(404, "404 not found"),
    })
  });

  Ok((hmr, address, receiver))
}

/// The file at `url` in `dir`. Like static hosts, pages may be requested without `.html`, and a
/// directory serves its `index.html`. Navigations to other missing paths get the nearest `404.html`,
/// or if there is none, the nearest `index.html`, so that single page apps' client-side routes load.
/// Other requests, e.g. for scripts, get a 404 rather than a page.
fn serve_file(request: &Request, url: &Url, output: &Output) -> Response {
  let dir = &output.dir;
  let Some(path) = url
    .path()
    .strip_prefix(&output.base_path)
    .or_else(|| (url.path() == output.base_path.trim_end_matches('/')).then_some(""))
  else {
    if !is_navigation(request) {
      return Response::new(404, "404 not found");
    }
    if url.path() == "/" {
      return Response::new(302, "").with_header("Location", output.base_path.clone());
    }
    return Response::new(404, not_found_page(url.path(), output, &html_pages(dir)))
      .with_header("Content-Type", "text/html; charset=utf-8");
  };

  let mut full_path = dir.to_path_buf();
  for segment in path.split('/') {
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

  let mut html_path = full_path.clone().into_os_string();
  html_path.push(".html");
  for path in [full_path.clone(), PathBuf::from(html_path)] {
    if let Some(response) = file_response(&path, dir) {
      return response;
    }
  }
  let index = full_path.join("index.html");
  if index.is_file() && index.starts_with(dir) {
    // Like static hosts, so that the page's relative URLs resolve within the directory.
    if !url.path().ends_with('/') {
      let query = url
        .query()
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
      return Response::new(302, "").with_header("Location", format!("{}/{query}", url.path()));
    }
    if let Some(response) = file_response(&index, dir) {
      return response;
    }
  }

  if !is_navigation(request) {
    return Response::new(404, "404 not found");
  }

  let fallback = |path: &Path, status: u16| {
    let response = file_response(path, dir)?;
    let served = path.strip_prefix(dir).unwrap().to_string_lossy();
    Some(
      response
        .with_status(status)
        .with_header("Cache-Control", "no-cache")
        .with_header(
          "X-Parcel-Fallback",
          format!("{}{}", output.base_path, served.replace('\\', "/")),
        ),
    )
  };

  // A 404 page means the site isn't a single page app.
  let ancestors = || {
    full_path
      .ancestors()
      .take_while(|path| path.starts_with(dir))
  };
  let page = |name: &str, status: u16| {
    ancestors().find_map(|ancestor| fallback(&ancestor.join(name), status))
  };
  if let Some(response) = page("404.html", 404).or_else(|| page("index.html", 200)) {
    return response;
  }

  // An app whose only page isn't named index.html.
  let pages = html_pages(dir);
  if let [page] = pages.as_slice()
    && let Some(response) = fallback(&dir.join(page), 200)
  {
    return response;
  }

  Response::new(404, not_found_page(url.path(), output, &pages))
    .with_header("Content-Type", "text/html; charset=utf-8")
}

/// The file at `path` if it is one within `dir`.
fn file_response(path: &Path, dir: &Path) -> Option<Response> {
  if !path.is_file() || !path.starts_with(dir) {
    return None;
  }
  let file = File::open(path).ok()?;
  let ty = path
    .extension()
    .and_then(|e| e.to_str())
    .map(|e| AssetType::from_extension(e).mime())
    .unwrap_or("application/octet-stream");
  Some(Response::file(file).with_header("Content-Type", ty))
}

/// Whether the browser is loading a page, rather than e.g. a script or `fetch()`. Browsers only
/// send `Sec-Fetch-Dest` to secure origins, which plain HTTP on a LAN address isn't, so otherwise
/// pages are those that accept HTML. `*/*` doesn't count, since `fetch()` sends it.
fn is_navigation(request: &Request) -> bool {
  if request.method != "GET" && request.method != "HEAD" {
    return false;
  }
  match request.header("Sec-Fetch-Dest") {
    Some(dest) => matches!(dest, "document" | "iframe" | "frame"),
    None => request.header("Accept").is_some_and(|accept| {
      accept.split(',').any(|ty| {
        let ty = ty.split(';').next().unwrap().trim();
        ty.eq_ignore_ascii_case("text/html") || ty.eq_ignore_ascii_case("application/xhtml+xml")
      })
    }),
  }
}

/// The paths of the HTML files in `dir`, relative to it with `/` separators.
fn html_pages(dir: &Path) -> Vec<String> {
  fn visit(dir: &Path, prefix: &str, pages: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
      return;
    };
    for entry in entries.flatten() {
      let name = entry.file_name().to_string_lossy().into_owned();
      let path = entry.path();
      if path.is_dir() {
        visit(&path, &format!("{prefix}{name}/"), pages);
      } else if path.extension().is_some_and(|e| e == "html") {
        pages.push(format!("{prefix}{name}"));
      }
    }
  }
  let mut pages = Vec::new();
  visit(dir, "", &mut pages);
  pages.sort();
  pages
}

/// The page shown for a missing page, linking to the ones that exist.
fn not_found_page(path: &str, output: &Output, pages: &[String]) -> String {
  use std::fmt::Write;

  let escape = |s: &str| {
    s.replace('&', "&amp;")
      .replace('<', "&lt;")
      .replace('>', "&gt;")
      .replace('"', "&quot;")
      .replace('\'', "&#39;")
  };
  let mut list = String::new();
  for page in pages {
    let mut url = Url::parse("http://localhost").unwrap();
    url.set_path(&output.base_path);
    url
      .path_segments_mut()
      .unwrap()
      .pop_if_empty()
      .extend(page.split('/'));
    write!(
      list,
      "<li><a href=\"{}\">{}</a></li>",
      escape(url.path()),
      escape(&percent_encoding::percent_decode_str(url.path()).decode_utf8_lossy())
    )
    .unwrap();
  }
  let mut pages = if list.is_empty() {
    "<p>The build has no pages.</p>".to_owned()
  } else {
    format!("<p>The build has these pages:</p><ul>{list}</ul>")
  };
  if output.base_path != "/" {
    pages = format!(
      "<p>The build is served under its public URL, <code>{}</code>.</p>{pages}",
      escape(&output.base_path)
    );
  }

  format!(
    r#"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>404 Not Found</title>
    <style>
      html {{ color-scheme: dark light; }}
      body {{ margin: 20px; font-family: sans-serif; }}
      code, li {{ font-family: Menlo, Consolas, monospace; }}
    </style>
  </head>
  <body>
    <h1>404 Not Found</h1>
    <p>There is no page at <code>{}</code>.</p>
    {pages}
  </body>
</html>
"#,
    escape(path)
  )
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

  /// Sets the reporters the server logs to. They're created with the build, which may be after the
  /// server starts.
  pub fn set_reporters(&self, reporters: Arc<Reporters>) {
    let _ = self.reporters.set(reporters);
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
          if let Some(reporters) = self.reporters.get() {
            reporters.log(LogLevel::Warn, &message);
          }
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
  use parcel_core::Diagnostic;
  use rustls::pki_types::CertificateDer;
  use std::{
    io::{Read, Write},
    net::TcpStream,
    thread,
    time::{Duration, Instant},
  };

  const TIMEOUT: Duration = Duration::from_secs(5);

  #[test]
  fn listen_uses_the_next_free_port() {
    // Another server on the loopback address takes the port even when binding all interfaces.
    let taken = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port();
    let options = |host: &'static str, strict_port| ServerOptions {
      host: host.into(),
      port,
      strict_port,
      ..Default::default()
    };
    for host in ["127.0.0.1", "0.0.0.0"] {
      let listener =
        listen(&options(host, false)).unwrap_or_else(|err| panic!("{}", err.0[0].message));
      assert!(listener.local_addr().unwrap().port() > port);
      assert!(listen(&options(host, true)).is_err());
    }
  }

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
      Some(Output::new(root.clone(), "")),
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
    let separator = if cfg!(windows) { "%5C" } else { "%2F" };
    assert!(
      body.contains(&format!(
        "{LAUNCH_EDITOR_ENDPOINT}?file=src{separator}a%26b.js%3A1%3A9"
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

  /// The status, `X-Parcel-Fallback` header, and body of a GET request with the given headers.
  fn http_get_with(
    address: SocketAddr,
    path: &str,
    headers: &str,
  ) -> (String, Option<String>, String) {
    let mut stream = TcpStream::connect(address).unwrap();
    write!(
      stream,
      "GET {path} HTTP/1.1\r\nHost: {address}\r\n{headers}Connection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    let (head, body) = response.split_once("\r\n\r\n").unwrap();
    let fallback = head
      .lines()
      .find_map(|line| line.strip_prefix("X-Parcel-Fallback: "))
      .map(str::to_owned);
    (
      head.lines().next().unwrap().to_owned(),
      fallback,
      body.to_owned(),
    )
  }

  /// Where a GET request is redirected to, if it is.
  fn redirect(address: SocketAddr, path: &str, headers: &str) -> Option<String> {
    let mut stream = TcpStream::connect(address).unwrap();
    write!(
      stream,
      "GET {path} HTTP/1.1\r\nHost: {address}\r\n{headers}Connection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    if !response.starts_with("HTTP/1.1 302 Found\r\n") {
      return None;
    }
    response
      .lines()
      .find_map(|line| line.strip_prefix("Location: "))
      .map(str::to_owned)
  }

  fn serve_dir(name: &str, files: &[(&str, &str)]) -> (PathBuf, SocketAddr) {
    serve_dir_at(name, files, "")
  }

  fn serve_dir_at(name: &str, files: &[(&str, &str)], public_url: &str) -> (PathBuf, SocketAddr) {
    let root = std::env::temp_dir().join(format!("parcel-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    for (path, contents) in files {
      let path = root.join(path);
      std::fs::create_dir_all(path.parent().unwrap()).unwrap();
      std::fs::write(path, contents).unwrap();
    }
    let (server, address, _events) = super::serve(
      &ServerOptions {
        host: "127.0.0.1".into(),
        port: 0,
        hmr: false,
        ..Default::default()
      },
      Some(Output::new(root.clone(), public_url)),
    )
    .unwrap();
    server.build_succeeded();
    (root, address)
  }

  const DOCUMENT: &str = "Sec-Fetch-Dest: document\r\nAccept: text/html,*/*;q=0.8\r\n";

  #[test]
  fn falls_back_to_the_nearest_index_for_pages() {
    let (root, address) = serve_dir(
      "spa-fallback",
      &[
        ("index.html", "app"),
        ("index.js", "code"),
        ("about.html", "about"),
        ("admin/index.html", "admin"),
      ],
    );
    let get = |path: &str, headers: &str| http_get_with(address, path, headers);
    let ok = |body: &str, fallback: Option<&str>| {
      (
        "HTTP/1.1 200 OK".to_owned(),
        fallback.map(str::to_owned),
        body.to_owned(),
      )
    };

    assert_eq!(get("/index.js", ""), ok("code", None));
    assert_eq!(get("/admin/", ""), ok("admin", None));
    assert_eq!(redirect(address, "/admin", "").as_deref(), Some("/admin/"));
    // Pages may omit .html, whatever requests them.
    assert_eq!(get("/about", ""), ok("about", None));
    assert_eq!(get("/about?q=1", DOCUMENT), ok("about", None));

    // Client-side routes, including those with dots, load the app.
    assert_eq!(get("/users/5", DOCUMENT), ok("app", Some("/index.html")));
    assert_eq!(
      get("/u/john.doe?x=1", DOCUMENT),
      ok("app", Some("/index.html"))
    );
    assert_eq!(
      get("/admin/users/5", DOCUMENT),
      ok("admin", Some("/admin/index.html"))
    );
    // Without Sec-Fetch-Dest, e.g. over plain HTTP on a LAN address, pages accept HTML.
    assert_eq!(
      get("/users/5", "Accept: text/html\r\n"),
      ok("app", Some("/index.html"))
    );
    assert_eq!(
      get("/users/5", "Sec-Fetch-Dest: iframe\r\n"),
      ok("app", Some("/index.html"))
    );

    // Anything else that's missing is, e.g. scripts, images, and fetch().
    for headers in [
      "",
      "Accept: */*\r\n",
      "Sec-Fetch-Dest: script\r\nAccept: */*\r\n",
      "Sec-Fetch-Dest: empty\r\nAccept: text/html\r\n",
    ] {
      assert_eq!(
        get("/missing.js", headers),
        (
          "HTTP/1.1 404 Not Found".into(),
          None,
          "404 not found".into()
        ),
        "{headers}"
      );
      assert_eq!(
        get("/users/5", headers).0,
        "HTTP/1.1 404 Not Found",
        "{headers}"
      );
    }

    std::fs::remove_dir_all(&root).unwrap();
  }

  #[test]
  fn serves_404_pages_instead_of_falling_back() {
    let (root, address) = serve_dir(
      "404-page",
      &[
        ("index.html", "home"),
        ("404.html", "not found"),
        ("docs/index.html", "docs"),
        ("app/index.html", "app"),
      ],
    );
    assert_eq!(
      http_get_with(address, "/docs/missing", DOCUMENT),
      (
        "HTTP/1.1 404 Not Found".into(),
        Some("/404.html".into()),
        "not found".into()
      )
    );
    std::fs::write(root.join("app/404.html"), "app not found").unwrap();
    assert_eq!(
      http_get_with(address, "/app/missing", DOCUMENT),
      (
        "HTTP/1.1 404 Not Found".into(),
        Some("/app/404.html".into()),
        "app not found".into()
      )
    );
    std::fs::remove_dir_all(&root).unwrap();
  }

  #[test]
  fn falls_back_to_the_only_page() {
    let (root, address) = serve_dir("only-page", &[("popup.html", "popup")]);
    for path in ["/", "/settings"] {
      assert_eq!(
        http_get_with(address, path, DOCUMENT),
        (
          "HTTP/1.1 200 OK".into(),
          Some("/popup.html".into()),
          "popup".into()
        )
      );
    }

    // With several pages it's ambiguous, so the 404 page lists them.
    std::fs::write(root.join("options.html"), "options").unwrap();
    std::fs::create_dir_all(root.join("a&b")).unwrap();
    std::fs::write(root.join("a&b/x y.html"), "").unwrap();
    let (status, fallback, body) = http_get_with(address, "/<missing>", DOCUMENT);
    assert_eq!(
      (status.as_str(), fallback),
      ("HTTP/1.1 404 Not Found", None)
    );
    assert!(body.contains("<code>/%3Cmissing%3E</code>"), "{body}");
    for link in [
      r#"<a href="/a&amp;b/x%20y.html">/a&amp;b/x y.html</a>"#,
      r#"<a href="/options.html">/options.html</a>"#,
      r#"<a href="/popup.html">/popup.html</a>"#,
    ] {
      assert!(body.contains(link), "{body}");
    }
    std::fs::remove_dir_all(&root).unwrap();
  }

  #[test]
  fn serves_under_the_public_url_path() {
    for (public_url, base_path) in [
      ("", "/"),
      ("/", "/"),
      ("/app", "/app/"),
      ("/app/", "/app/"),
      ("/a b/c/", "/a%20b/c/"),
      ("https://cdn.example.com/app/", "/app/"),
      ("https://cdn.example.com", "/"),
      ("./", "/"),
      ("app/", "/"),
    ] {
      assert_eq!(
        Output::new(PathBuf::new(), public_url).base_path,
        base_path,
        "{public_url}"
      );
    }

    let (root, address) = serve_dir_at(
      "public-url",
      &[("index.html", "app"), ("index.js", "code")],
      "https://cdn.example.com/app/",
    );
    let get = |path: &str, headers: &str| http_get_with(address, path, headers);
    let ok = |body: &str, fallback: Option<&str>| {
      (
        "HTTP/1.1 200 OK".to_owned(),
        fallback.map(str::to_owned),
        body.to_owned(),
      )
    };
    assert_eq!(get("/app/index.js", ""), ok("code", None));
    assert_eq!(get("/app/", ""), ok("app", None));
    assert_eq!(
      get("/app/users/5", DOCUMENT),
      ok("app", Some("/app/index.html"))
    );

    // Nothing is served outside the public URL.
    assert_eq!(get("/index.js", "").0, "HTTP/1.1 404 Not Found");
    assert_eq!(get("/application/x", "").0, "HTTP/1.1 404 Not Found");
    let (status, fallback, body) = get("/users/5", DOCUMENT);
    assert_eq!(
      (status.as_str(), fallback),
      ("HTTP/1.1 404 Not Found", None)
    );
    assert!(body.contains("<code>/app/</code>"), "{body}");
    assert!(
      body.contains(r#"<a href="/app/index.html">/app/index.html</a>"#),
      "{body}"
    );
    // Except that the root redirects to it.
    assert_eq!(redirect(address, "/", DOCUMENT).as_deref(), Some("/app/"));
    assert_eq!(
      redirect(address, "/app?q=1", "").as_deref(),
      Some("/app/?q=1")
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
    stream.set_read_timeout(Some(TIMEOUT)).unwrap();
    let mut response = String::new();
    for i in 1..=2 {
      write!(stream, "GET /other HTTP/1.1\r\nHost: {address}\r\n\r\n").unwrap();
      // Reads until this request's response, which ends with its body, is complete.
      while response.matches("404 not found").count() < i {
        let mut chunk = [0; 1024];
        let read = stream.read(&mut chunk).unwrap();
        assert!(read > 0, "{response}");
        response.push_str(std::str::from_utf8(&chunk[..read]).unwrap());
      }
    }
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
    std::fs::write(dir.join("cert.pem"), cert.pem()).unwrap();
    std::fs::write(dir.join("key.pem"), key.serialize_pem()).unwrap();
    let options = HttpsOptions::Files {
      cert: dir.join("cert.pem"),
      key: dir.join("key.pem"),
    };
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
      Some(Output::new(root.join("dist"), "")),
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
          https: Some(HttpsOptions::Files {
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
