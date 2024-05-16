use std::thread;

use napi::Env;
use napi::JsObject;
use napi_derive::napi;
use parcel_config::ParcelConfig;
use parcel_core_next::build;
use parcel_core_next::RequestTracker;

use super::request_tracker::RequestTrackerNapi;

#[napi]
pub fn parcel(env: Env, parcel_config: JsObject) -> napi::Result<RequestTrackerNapi> {
  let parcel_config = env.from_js_value::<ParcelConfig, JsObject>(parcel_config)?;

  dbg!(&parcel_config);
  let request_tracker = RequestTracker::new();
  let request_tracker_napi = RequestTrackerNapi::new(request_tracker.clone());

  thread::spawn(move || {
    build(request_tracker).unwrap();
  });

  Ok(request_tracker_napi)
}
