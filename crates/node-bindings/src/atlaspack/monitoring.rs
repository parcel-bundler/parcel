use napi_derive::napi;

#[napi]
pub fn initialize_monitoring() -> napi::Result<()> {
  atlaspack_monitoring::initialize_from_env()
    .map_err(|err| napi::Error::from_reason(err.to_string()))
}

#[napi]
pub fn close_monitoring() {
  atlaspack_monitoring::close_monitoring();
}
