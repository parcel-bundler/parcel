use napi_derive::napi;

#[napi]
pub fn initialize_monitoring() -> napi::Result<()> {
  // parcel_monitoring::initialize_from_env().map_err(|err| napi::Error::from_reason(err.to_string()))
  Ok(())
}

#[napi]
pub fn close_monitoring() {
  // parcel_monitoring::close_monitoring();
}
