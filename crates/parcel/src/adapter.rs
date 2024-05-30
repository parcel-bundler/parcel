mod bundler_adapter;
pub use bundler_adapter::*;

mod compressor_adapter;
pub use compressor_adapter::*;

mod namer_adapter;
pub use namer_adapter::*;

mod optimizer_adapter;
pub use optimizer_adapter::*;

mod packager_adapter;
pub use packager_adapter::*;

mod reporter_adapter;
pub use reporter_adapter::*;

mod resolver_adapter;
pub use resolver_adapter::*;

mod runtime_adapter;
pub use runtime_adapter::*;

mod transformer_adapter;
pub use transformer_adapter::*;

pub trait Adapter {}
