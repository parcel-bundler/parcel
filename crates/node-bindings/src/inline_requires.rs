use napi::Result;
use napi_derive::napi;

#[napi]
pub fn inline_requires(
  bundle_source: String,
  asset_public_ids_with_side_effects: Vec<String>,
) -> Result<String> {
  match parcel_inline_requires_core::inline_requires(
    &bundle_source,
    &asset_public_ids_with_side_effects,
  ) {
    Some(new_bundle_source) => Ok(new_bundle_source),
    _ => Ok(bundle_source),
  }
}
