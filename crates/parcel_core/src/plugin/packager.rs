/// Combines all the assets in a bundle together into an output file
///
/// Packagers are also responsible for resolving URL references, bundle inlining, and generating
/// source maps.
///
pub trait PackagerPlugin: Send + Sync {}
