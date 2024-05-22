/// Receives events from Parcel as they occur throughout the build process
///
/// For example, reporters may write status information to stdout, run a dev server, or generate a
/// bundle analysis report at the end of a build.
///
pub trait ReporterPlugin {}
