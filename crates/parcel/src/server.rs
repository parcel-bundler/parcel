use parcel_core::AssetType;
use std::{fs::File, path::Path, str::FromStr, thread};
use tiny_http::{Header, HeaderField, Response, Server};
use url::Url;
// use tungstenite::accept;

pub fn serve_dir(path: &Path) {
  let path = path.to_owned();
  std::thread::spawn(move || {
    let server = Server::http("127.0.0.1:1234").unwrap();
    println!("Server listening on http://localhost:1234");

    for request in server.incoming_requests() {
      let base_url = Url::parse("http://localhost").unwrap();
      let url = base_url.join(request.url()).unwrap();
      let mut full_path = path.clone();
      for segment in url.path_segments().unwrap() {
        full_path.push(segment);
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
}
