/// Converts an asset graph into a BundleGraph
///
/// Bundlers accept the entire asset graph and modify it to add bundle nodes that group the assets
/// into output bundles.
///
/// Bundle and optimize run in series and are functionally identitical.
///
pub trait BundlerPlugin {}
