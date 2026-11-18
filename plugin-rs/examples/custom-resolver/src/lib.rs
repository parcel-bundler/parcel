use parcel_plugin::{
  CodeFrame, CodeHighlight, Config, Dependency, Diagnostic, FileKind, Options, Plugin,
  ResolveResult, register_plugin,
};
use std::path::Path;

/// Resolves `custom:name` to `name.js` next to the importing file.
///
/// `custom-deprecated:name` resolves the same way, with a warning. Both show
/// diagnostics with more than one code frame: the warning points at the import
/// and at what it resolved to, and a missing module's error at the import and at
/// what to create.
struct CustomResolver;

impl Plugin for CustomResolver {
  fn new(_config: &Config, _options: &Options) -> Result<Self, Diagnostic> {
    Ok(CustomResolver)
  }

  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    _pipeline: Option<&str>,
    options: &Options,
  ) -> Result<ResolveResult, Diagnostic> {
    let (name, deprecated) = if let Some(name) = specifier.strip_prefix("custom:") {
      (name, false)
    } else if let Some(name) = specifier.strip_prefix("custom-deprecated:") {
      (name, true)
    } else {
      return Ok(ResolveResult::None);
    };
    let importer = dep.resolve_from().unwrap_or_default();
    let dir = importer.parent().unwrap_or(Path::new("."));
    let path = dir.join(format!("{name}.js"));

    // Where the import is, assuming it is on the first line, as in the fixtures.
    let import = CodeFrame::file(&importer).with_highlight(
      CodeHighlight::at(1, 1)
        .to(1, 1)
        .with_message(format!("`{specifier}` imported here")),
    );

    if !options.file_kind(&path).contains(FileKind::FILE) {
      return Err(
        Diagnostic::new(format!("Could not find custom module `{name}`"))
          .with_code_frame(import)
          .with_code_frame(
            CodeFrame::code(
              format!("custom:{name}"),
              format!("export default \"{name}\";\n"),
              Some("js"),
            )
            .with_highlight(
              CodeHighlight::at(1, 1)
                .to(1, 6)
                .with_message("create it like this"),
            ),
          )
          .with_hint(format!("Create {}", path.display()))
          .with_hint("Or import a module that exists"),
      );
    }

    if deprecated {
      options.log_diagnostic(
        &Diagnostic::warning("`custom-deprecated:` is deprecated")
          .with_code_frame(import)
          .with_code_frame(
            CodeFrame::file(&path)
              .with_highlight(CodeHighlight::at(1, 1).with_message("resolved to this")),
          )
          .with_hint(format!("Import `custom:{name}` instead")),
      );
    }

    Ok(ResolveResult::file(path))
  }
}

register_plugin!(CustomResolver);
