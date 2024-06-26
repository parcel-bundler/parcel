use anyhow;

/// Convert anyhow error to napi error
pub fn anyhow_napi(value: anyhow::Error) -> napi::Error {
  napi::Error::from_reason(format!("[napi] {}", value.to_string()))
}
