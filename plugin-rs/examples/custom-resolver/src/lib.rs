use parcel_plugin::{Dependency, Diagnostic, Options, Plugin, ResolveResult, register_plugin};
use std::path::Path;

struct CustomResolver;

impl Plugin for CustomResolver {
  fn new(_config: &[u8]) -> Result<Self, Diagnostic> {
    Ok(CustomResolver)
  }

  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    _pipeline: Option<&str>,
    _options: &Options,
    result: &mut ResolveResult,
  ) -> Result<(), Diagnostic> {
    let Some(name) = specifier.strip_prefix("custom:") else {
      return Ok(());
    };
    let resolve_from = dep.resolve_from();
    let dir = Path::new(&resolve_from).parent().unwrap_or(Path::new("."));
    result.set_file_path(dir.join(format!("{}.js", name)).to_str().unwrap());
    Ok(())
  }
}

register_plugin!(CustomResolver);
