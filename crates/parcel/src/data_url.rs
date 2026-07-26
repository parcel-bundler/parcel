use std::sync::Arc;

use parcel_core::{BufferContent, Bundle, BundleGraph, DiagnosticList, Optimizer};

pub struct DataUrlOptimizer {}

impl Optimizer for DataUrlOptimizer {
  fn optimize(
    &self,
    _bundle_graph: &BundleGraph,
    bundle: &Bundle,
    contents: Arc<dyn parcel_core::Content>,
    _options: &parcel_core::ParcelOptions,
  ) -> Result<Arc<dyn parcel_core::Content>, DiagnosticList> {
    let base64 = data_encoding::BASE64.encode(&contents.read()?);
    let url = format!("data:{};base64,{}", bundle.ty.mime(), base64);
    Ok(Arc::new(BufferContent::new_string(url)))
  }
}

#[cfg(test)]
mod tests {
  #[test]
  fn encodes_with_standard_alphabet_not_url_safe() {
    // These bytes land on sextets that differ between the standard and
    // URL-safe base64 alphabets: standard base64 emits `+`/`/`, while
    // URL-safe base64 emits `-`/`_` instead.
    let encoded = data_encoding::BASE64.encode(&[0xff, 0xff, 0xff]);
    assert_eq!(encoded, "////");
    assert!(!encoded.contains('-'));
    assert!(!encoded.contains('_'));

    let encoded = data_encoding::BASE64.encode(&[0xff, 0xef, 0xfe]);
    assert!(encoded.contains('+') || encoded.contains('/'));
    assert!(!encoded.contains('-'));
    assert!(!encoded.contains('_'));
  }
}
