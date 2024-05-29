use std::sync::mpsc::Receiver;
use std::sync::mpsc::Sender;
use std::thread;

use super::napi_to_rust;
use super::rust_to_napi;

pub fn init_parcel(
  _rtn: Sender<rust_to_napi::CtrlMessageResponse>,
  ntr: Receiver<napi_to_rust::CtrlMessageResponse>,
) {
  thread::spawn(move || {
    while let Ok(message) = ntr.recv() {
      println!("{:?}", message)
    }
  });
}
