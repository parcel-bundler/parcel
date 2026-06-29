use indexmap::{IndexMap, IndexSet};
use parcel_core::{
  Asset, AssetType, BundleGraph, OutputFormat, ParcelConfig, ParcelOptions, get_bundle_content,
};
use parcel_js::packager::{Resolution, SyntheticAsset, asset_dependencies};
use std::{
  collections::HashMap,
  fmt::Write,
  fs::File,
  path::Path,
  sync::{Arc, Mutex},
  thread,
};
use tiny_http::{Header, ReadWrite, Response, Server};
use tungstenite::{Message, WebSocket};
use url::Url;

#[derive(serde::Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum HmrUpdate<'a> {
  Update { assets: Vec<HmrAsset<'a>> },
}

#[derive(Debug, serde::Serialize)]
#[serde(untagged)]
enum Id {
  Asset(String),
  Bundle(String),
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HmrAsset<'a> {
  id: Id,
  #[serde(rename = "type")]
  ty: AssetType,
  output: String,
  env_hash: String,
  output_format: OutputFormat,
  deps_by_bundle: HashMap<String, IndexMap<String, Resolution<'a>>>,
}

pub struct DevServer {
  sockets: Arc<Mutex<Vec<WebSocket<Box<dyn ReadWrite + Send>>>>>,
}

pub fn serve_dir(path: &Path) -> DevServer {
  let path = path.to_owned();
  let sockets = Arc::new(Mutex::new(Vec::new()));
  let sockets_clone = Arc::clone(&sockets);
  std::thread::spawn(move || {
    let server = Server::http("127.0.0.1:1234").unwrap();
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
    let mut synthetic_assets = IndexSet::new();
    let mut assets = Vec::with_capacity(changed_assets.len());
    for (id, asset) in changed_assets {
      let dependencies = asset_dependencies(
        id as usize,
        asset,
        bundle_graph,
        None,
        &mut synthetic_assets,
        &|bundle_index| {
          get_bundle_content(
            config,
            bundle_graph,
            &bundle_graph.bundles[bundle_index],
            options,
          )
        },
        &bundle_graph.project_root,
      )
      .unwrap();

      // TODO: I think we don't need this anymore. Was added in https://github.com/parcel-bundler/parcel/pull/4311
      // due to runtimes producing different dependencies per bundle.
      let mut deps_by_bundle = HashMap::new();
      deps_by_bundle.insert("TODO".into(), dependencies);

      let mut output = String::new();
      if asset.ty == AssetType::Js {
        output = format!(
          "parcelHotUpdate['{}'] = function (require, module, exports) {{{}}}",
          asset.id(&bundle_graph.project_root),
          String::from_utf8(asset.content.read().unwrap()).unwrap()
        );
      }

      assets.push(HmrAsset {
        id: Id::Asset(asset.id(&bundle_graph.project_root)),
        ty: asset.ty.clone(),
        output,
        // TODO: needed to filter out assets that come from a different target, preventing page reload.
        env_hash: "TODO".into(),
        output_format: asset.target.output_format.clone(),
        deps_by_bundle,
      });
    }

    // TODO: only changed ones??
    for synthetic_asset in synthetic_assets {
      let id = if let SyntheticAsset::Asset(id, _) = &synthetic_asset {
        Id::Asset(id.clone())
      } else {
        Id::Bundle(synthetic_asset.id())
      };

      let mut output = String::new();
      write!(&mut output, "parcelHotUpdate[",);
      synthetic_asset.write_id(&mut output);
      write!(&mut output, "] = function (require, module, exports) {{");
      synthetic_asset.write_content(
        &mut output,
        bundle_graph,
        &bundle_graph.bundles[0], // TODO
        &|bundle_index| {
          get_bundle_content(
            config,
            bundle_graph,
            &bundle_graph.bundles[bundle_index],
            options,
          )
        },
        &bundle_graph.project_root,
      );
      write!(&mut output, "}}");

      assets.push(HmrAsset {
        id,
        ty: AssetType::Js,
        output,
        env_hash: "TODO".into(),
        output_format: OutputFormat::Esmodule,
        deps_by_bundle: HashMap::new(),
      });
    }

    let update = HmrUpdate::Update { assets };
    let serialized = serde_json::to_string(&update).unwrap();

    let mut sockets = self.sockets.lock().unwrap();
    sockets.retain_mut(|ws| {
      match ws.send(Message::Text(serialized.clone().into())) {
        Ok(_) => true,   // Keep the client
        Err(_) => false, // Drop the client (they disconnected)
      }
    });
  }
}
