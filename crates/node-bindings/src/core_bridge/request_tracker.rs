use std::rc::Rc;

use napi_derive::napi;
use parcel_core_next::RequestTracker;

#[napi]
#[derive(Clone)]
pub struct RequestTrackerNapi {
  request_tracker: RequestTracker
}

#[napi]
impl RequestTrackerNapi {
  pub fn new(
    request_tracker: RequestTracker,
  ) -> Self {
    Self {
      request_tracker
    }
  }

  #[napi]
  pub fn start_request(&self, request: String) {
    // self.request_tracker.start_request(&request);
  }
}
