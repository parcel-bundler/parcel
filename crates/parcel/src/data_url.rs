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
    let base64 = base64_url::encode(&contents.read()?);
    let url = format!("data:{};base64,{}", bundle.ty.mime(), base64);
    Ok(Arc::new(BufferContent::new(url.into_bytes())))
  }
}
