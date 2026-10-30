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
  ) -> Result<ResolveResult, Diagnostic> {
    let Some(name) = specifier.strip_prefix("custom:") else {
      return Ok(ResolveResult::None);
    };
    let resolve_from = dep.resolve_from().unwrap_or_default();
    let dir = resolve_from.parent().unwrap_or(Path::new("."));
    Ok(ResolveResult::file(dir.join(format!("{name}.js"))))
  }
}

register_plugin!(CustomResolver);
