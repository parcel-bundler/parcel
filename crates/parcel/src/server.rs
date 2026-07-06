use parcel_core::{Asset, AssetType, BundleGraph, DiagnosticList, ParcelConfig, ParcelOptions};
use parcel_js::hmr::{HmrUpdate, get_hmr_update};
use std::{
  borrow::Cow,
  fs::File,
  path::Path,
  sync::{Arc, Mutex},
  thread,
};
use tiny_http::{Header, ReadWrite, Response, Server};
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

pub struct DevServer {
  sockets: Arc<Mutex<Vec<WebSocket<Box<dyn ReadWrite + Send>>>>>,
}

pub fn serve_dir(path: &Path, options: ServerOptions) -> DevServer {
  let path = path.to_owned();
  let sockets = Arc::new(Mutex::new(Vec::new()));
  let sockets_clone = Arc::clone(&sockets);
  std::thread::spawn(move || {
    let server = Server::http((&*options.host, options.port)).unwrap();
    println!("Server listening on http://localhost:1234");

    for request in server.incoming_requests() {
      if is_websocket_upgrade(&request) {
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
          response.add_header(
            Header::from_bytes(b"Sec-WebSocket-Accept", accept_key.as_bytes()).unwrap(),
          );
        }

        let stream = request.upgrade("websocket", response);
        let clients_clone = Arc::clone(&sockets_clone);
        thread::spawn(move || {
          let websocket = tungstenite::WebSocket::from_raw_socket(
            stream,
            tungstenite::protocol::Role::Server,
            None,
          );
          clients_clone.lock().unwrap().push(websocket);
        });
        continue;
      }

      let base_url = Url::parse("http://localhost").unwrap();
      let url = base_url.join(request.url()).unwrap();
      let mut full_path = path.clone();
      for segment in url.path_segments().unwrap() {
        full_path.push(
          percent_encoding::percent_decode(segment.as_bytes())
            .decode_utf8()
            .unwrap()
            .as_ref(),
        );
      }

      if full_path.is_dir() {
        full_path.push("index.html");
      }

      if full_path.is_file() && full_path.starts_with(&path) {
        let file = File::open(&full_path).unwrap();
        let ty = full_path
          .extension()
          .map(|e| AssetType::from_extension(e.to_str().unwrap()).mime())
          .unwrap_or("application/octet-stream");
        let response = Response::from_file(file)
          .with_header(Header::from_bytes(b"Content-Type", ty.as_bytes()).unwrap());

        request.respond(response).unwrap();
      } else {
        let response = Response::from_string("404 not found").with_status_code(404);
        request.respond(response).unwrap();
      }
    }
  });

  DevServer { sockets }
}

fn is_websocket_upgrade(request: &tiny_http::Request) -> bool {
  request
    .headers()
    .iter()
    .any(|h| h.field.equiv("Upgrade") && h.value.as_str().eq_ignore_ascii_case("websocket"))
}

impl DevServer {
  pub fn emit_hmr_update(
    &self,
    changed_assets: Vec<(u32, &Asset)>,
    bundle_graph: &BundleGraph,
    config: &ParcelConfig,
    options: &ParcelOptions,
  ) {
    let update = get_hmr_update(changed_assets, bundle_graph, config, options);
    let serialized = serde_json::to_string(&update).unwrap();
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
