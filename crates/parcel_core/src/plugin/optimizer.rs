/// Optimises a bundle
///
/// Optimizers are commonly used to implement minification, tree shaking, dead code elimination,
/// and other size reduction techniques that need a full bundle to be effective. However,
/// optimizers can also be used for any type of bundle transformation, such as prepending license
/// headers, converting inline bundles to base 64, etc.
///
/// Multiple optimizer plugins may run in series, and the result of each optimizer is passed to
/// the next.
///
pub trait OptimizerPlugin: Send + Sync {}
