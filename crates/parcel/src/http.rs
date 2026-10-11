//! A minimal HTTP/1.1 server for the dev server. With a TLS config, it serves both HTTPS and plain
//! HTTP on the same port, telling them apart by the first byte a client sends. Browsers use HTTPS,
//! while the process started by `parcel run` keeps connecting over plain WebSockets locally, so it
//! needn't trust the certificate.

use std::{
  fs::File,
  io::{self, Read, Write},
  net::{SocketAddr, TcpListener, TcpStream, ToSocketAddrs},
  path::Path,
  sync::Arc,
  thread,
};

use rustls::{
  ConfigBuilder, ServerConfig, ServerConnection, StreamOwned,
  crypto::CryptoProvider,
  pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject},
  server::{ResolvesServerCert, WantsServerCert},
};

/// A connection to a client, over TLS or not.
pub trait Stream: Read + Write + Send {}
impl<T: Read + Write + Send> Stream for T {}

/// The first byte of a TLS record containing a handshake message, i.e. a ClientHello.
const TLS_HANDSHAKE: u8 = 0x16;

/// The most bytes of request line and headers read before giving up on a request.
const MAX_HEAD_SIZE: usize = 64 * 1024;

pub struct Request {
  pub method: String,
  /// The request target, e.g. `/index.html?query`.
  pub url: String,
  headers: Vec<(String, String)>,
}

impl Request {
  pub fn header(&self, name: &str) -> Option<&str> {
    self
      .headers
      .iter()
      .find(|(key, _)| key.eq_ignore_ascii_case(name))
      .map(|(_, value)| value.as_str())
  }

  /// Whether a header holds `token` in its comma-separated list, e.g. `Connection: keep-alive, Upgrade`.
  fn header_has_token(&self, name: &str, token: &str) -> bool {
    self.header(name).is_some_and(|value| {
      value
        .split(',')
        .any(|part| part.trim().eq_ignore_ascii_case(token))
    })
  }
}

pub enum Body {
  Bytes(Vec<u8>),
  File(File),
}

pub struct Response {
  status: u16,
  headers: Vec<(&'static str, String)>,
  body: Body,
}

impl Response {
  pub fn new(status: u16, body: impl Into<Vec<u8>>) -> Self {
    Response {
      status,
      headers: Vec::new(),
      body: Body::Bytes(body.into()),
    }
  }

  pub fn file(file: File) -> Self {
    Response {
      status: 200,
      headers: Vec::new(),
      body: Body::File(file),
    }
  }

  pub fn with_header(mut self, name: &'static str, value: impl Into<String>) -> Self {
    self.headers.push((name, value.into()));
    self
  }
}

/// What to do with a request.
pub enum Reply {
  Respond(Response),
  /// Responds, then hands the connection over, e.g. to a WebSocket, along with the bytes the client
  /// sent after the request.
  Upgrade(Response, Box<dyn FnOnce(Box<dyn Stream>, Vec<u8>) + Send>),
}

pub struct Server {
  listener: TcpListener,
  tls: Option<Arc<ServerConfig>>,
}

impl Server {
  pub fn bind(address: impl ToSocketAddrs, tls: Option<Arc<ServerConfig>>) -> io::Result<Self> {
    Ok(Server {
      listener: TcpListener::bind(address)?,
      tls,
    })
  }

  pub fn local_addr(&self) -> io::Result<SocketAddr> {
    self.listener.local_addr()
  }

  /// Serves each connection on its own thread, since requests for the build's output wait for it.
  pub fn run(self, handler: impl Fn(Request) -> Reply + Send + Sync + 'static) {
    let handler = Arc::new(handler);
    thread::spawn(move || {
      for stream in self.listener.incoming() {
        let Ok(stream) = stream else {
          continue;
        };
        let tls = self.tls.clone();
        let handler = handler.clone();
        thread::spawn(move || {
          let _ = stream.set_nodelay(true);
          if let Some(stream) = accept(stream, tls) {
            serve_connection(stream, &*handler);
          }
        });
      }
    });
  }
}

/// Wraps `stream` in TLS if the client starts a handshake.
fn accept(stream: TcpStream, tls: Option<Arc<ServerConfig>>) -> Option<Box<dyn Stream>> {
  let Some(tls) = tls else {
    return Some(Box::new(stream));
  };
  let mut first = [0; 1];
  if stream.peek(&mut first).ok()? == 0 {
    return None;
  }
  if first[0] != TLS_HANDSHAKE {
    return Some(Box::new(stream));
  }
  let connection = ServerConnection::new(tls).ok()?;
  Some(Box::new(StreamOwned::new(connection, stream)))
}

/// Serves requests on `stream` until the client or a response closes it.
fn serve_connection(mut stream: Box<dyn Stream>, handler: &dyn Fn(Request) -> Reply) {
  let mut buffer = Vec::new();
  loop {
    let (request, version) = match read_request(&mut *stream, &mut buffer) {
      Ok(Some(request)) => request,
      Ok(None) => return,
      Err(status) => {
        let _ = write_response(&mut *stream, Response::new(status, ""), false, true);
        return;
      }
    };

    // HTTP/1.1 connections stay open unless the client says otherwise. Bodies are never used, but
    // must be skipped to reach the next request, which isn't possible for chunked ones.
    let mut close = version == 0 || request.header_has_token("Connection", "close");
    let content_length = match request.header("Content-Length") {
      Some(length) => match length.trim().parse::<usize>() {
        Ok(length) => length,
        Err(_) => {
          let _ = write_response(&mut *stream, Response::new(400, ""), false, true);
          return;
        }
      },
      None => 0,
    };
    if request.header("Transfer-Encoding").is_some() {
      close = true;
    } else if !skip_body(&mut *stream, &mut buffer, content_length) {
      return;
    }

    let head = request.method == "HEAD";
    match handler(request) {
      Reply::Respond(response) => {
        if write_response(&mut *stream, response, head, close).is_err() || close {
          return;
        }
      }
      Reply::Upgrade(response, upgrade) => {
        if write_response(&mut *stream, response, false, false).is_ok() {
          upgrade(stream, buffer);
        }
        return;
      }
    }
  }
}

/// Reads the next request's line and headers, leaving the bytes after them in `buffer`. Returns its
/// minor HTTP version with it, `None` if the connection closed, or the status to respond with if
/// the request is invalid.
fn read_request(
  stream: &mut dyn Stream,
  buffer: &mut Vec<u8>,
) -> Result<Option<(Request, u8)>, u16> {
  let mut chunk = [0; 8192];
  loop {
    if !buffer.is_empty() {
      let mut headers = [httparse::EMPTY_HEADER; 64];
      let mut parsed = httparse::Request::new(&mut headers);
      match parsed.parse(buffer) {
        Ok(httparse::Status::Complete(length)) => {
          let request = Request {
            method: parsed.method.unwrap_or_default().to_owned(),
            url: parsed.path.unwrap_or_default().to_owned(),
            headers: parsed
              .headers
              .iter()
              .map(|header| {
                (
                  header.name.to_owned(),
                  String::from_utf8_lossy(header.value).into_owned(),
                )
              })
              .collect(),
          };
          let version = parsed.version.unwrap_or(1);
          buffer.drain(..length);
          return Ok(Some((request, version)));
        }
        Ok(httparse::Status::Partial) if buffer.len() < MAX_HEAD_SIZE => {}
        Ok(httparse::Status::Partial) | Err(httparse::Error::TooManyHeaders) => return Err(431),
        Err(httparse::Error::Version) => return Err(505),
        Err(_) => return Err(400),
      }
    }
    match stream.read(&mut chunk) {
      Ok(0) | Err(_) => return Ok(None),
      Ok(read) => buffer.extend_from_slice(&chunk[..read]),
    }
  }
}

/// Discards a request body of `length` bytes. Returns whether the connection is still usable.
fn skip_body(stream: &mut dyn Stream, buffer: &mut Vec<u8>, length: usize) -> bool {
  let buffered = length.min(buffer.len());
  buffer.drain(..buffered);
  let remaining = (length - buffered) as u64;
  remaining == 0
    || io::copy(&mut (&mut *stream).take(remaining), &mut io::sink()).is_ok_and(|n| n == remaining)
}

fn write_response(
  stream: &mut dyn Stream,
  response: Response,
  head: bool,
  close: bool,
) -> io::Result<()> {
  let mut out = format!(
    "HTTP/1.1 {} {}\r\n",
    response.status,
    reason(response.status)
  );
  for (name, value) in &response.headers {
    out.push_str(&format!("{name}: {value}\r\n"));
  }
  if response.status != 101 {
    let length = match &response.body {
      Body::Bytes(bytes) => bytes.len() as u64,
      Body::File(file) => file.metadata()?.len(),
    };
    out.push_str(&format!("Content-Length: {length}\r\n"));
  }
  if close {
    out.push_str("Connection: close\r\n");
  }
  out.push_str("\r\n");
  stream.write_all(out.as_bytes())?;

  if !head {
    match response.body {
      Body::Bytes(bytes) => stream.write_all(&bytes)?,
      Body::File(mut file) => {
        io::copy(&mut file, stream)?;
      }
    }
  }
  stream.flush()
}

fn reason(status: u16) -> &'static str {
  match status {
    101 => "Switching Protocols",
    200 => "OK",
    400 => "Bad Request",
    404 => "Not Found",
    431 => "Request Header Fields Too Large",
    500 => "Internal Server Error",
    505 => "HTTP Version Not Supported",
    _ => "",
  }
}

pub fn crypto_provider() -> Arc<CryptoProvider> {
  Arc::new(rustls::crypto::ring::default_provider())
}

/// A TLS config serving the certificate chain and private key in the PEM files `cert` and `key`.
pub fn tls_config(cert: &Path, key: &Path) -> Result<Arc<ServerConfig>, String> {
  let certs = CertificateDer::pem_file_iter(cert)
    .and_then(|certs| certs.collect::<Result<Vec<_>, _>>())
    .map_err(|err| format!("Could not read certificate {}: {err}", cert.display()))?;
  if certs.is_empty() {
    return Err(format!("No certificates found in {}", cert.display()));
  }
  let key = PrivateKeyDer::from_pem_file(key)
    .map_err(|err| format!("Could not read private key {}: {err}", key.display()))?;
  let config = config_builder(crypto_provider())?
    .with_single_cert(certs, key)
    .map_err(|err| format!("Invalid certificate or private key: {err}"))?;
  Ok(finish(config))
}

/// A TLS config serving the certificates `resolver` picks for each client.
pub fn resolver_tls_config(
  provider: Arc<CryptoProvider>,
  resolver: Arc<dyn ResolvesServerCert>,
) -> Result<Arc<ServerConfig>, String> {
  Ok(finish(
    config_builder(provider)?.with_cert_resolver(resolver),
  ))
}

fn config_builder(
  provider: Arc<CryptoProvider>,
) -> Result<ConfigBuilder<ServerConfig, WantsServerCert>, String> {
  Ok(
    ServerConfig::builder_with_provider(provider)
      .with_safe_default_protocol_versions()
      .map_err(|err| err.to_string())?
      .with_no_client_auth(),
  )
}

fn finish(mut config: ServerConfig) -> Arc<ServerConfig> {
  config.alpn_protocols = vec![b"http/1.1".to_vec()];
  Arc::new(config)
}
