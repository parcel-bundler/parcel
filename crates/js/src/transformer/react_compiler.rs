use std::{cell::RefCell, rc::Rc};

use swc_core::{
  common::{
    BytePos, SourceMap, Span,
    comments::{SingleThreadedComments, SingleThreadedCommentsMapInner},
  },
  ecma::{
    ast::Program,
    react_compiler::{PluginOptions, SourceType, diagnostics::Severity, fast_check, transform},
  },
};
use swc_node_comments::SwcComments;

use super::utils::{Diagnostic, DiagnosticSeverity, diagnostic, highlight};

pub struct ReactCompilerResult {
  /// The compiled program, or None if the compiler made no changes.
  pub program: Option<Program>,
  /// Errors that failed compilation, e.g. once `panicThreshold` is reached.
  pub diagnostics: Vec<Diagnostic>,
  /// Why functions were not compiled.
  pub bailouts: Vec<Diagnostic>,
}

/// Runs React Compiler, which memoizes components and hooks. `program` must be unresolved, and
/// the first file in `source_map`, whose code is `code`.
pub fn react_compiler(
  program: &Program,
  code: &str,
  comments: &SwcComments,
  source_map: &SourceMap,
  is_type_script: bool,
  react_refresh: bool,
  mut options: PluginOptions,
) -> ReactCompilerResult {
  // Infer and annotation modes only compile functions containing JSX, hook calls, or opt-in
  // directives. Check for them before copying the comments.
  if matches!(options.compilation_mode.as_str(), "infer" | "annotation")
    && !fast_check::is_required(program)
  {
    return ReactCompilerResult {
      program: None,
      diagnostics: Vec::new(),
      bailouts: Vec::new(),
    };
  }

  // Like the Babel plugin in development, reset memoized values when a module is hot reloaded.
  if react_refresh
    && options
      .environment
      .enable_reset_cache_on_source_file_changes
      != Some(false)
  {
    options
      .environment
      .enable_reset_cache_on_source_file_changes = Some(true);
    options.source_code = Some(code.to_owned());
  }

  // The compiler reads lint suppressions from comments.
  let leading: SingleThreadedCommentsMapInner = comments
    .leading
    .iter()
    .map(|entry| (*entry.key(), entry.value().clone()))
    .collect();
  let trailing: SingleThreadedCommentsMapInner = comments
    .trailing
    .iter()
    .map(|entry| (*entry.key(), entry.value().clone()))
    .collect();
  let comments = SingleThreadedComments::from_leading_and_trailing(
    Rc::new(RefCell::new(leading)),
    Rc::new(RefCell::new(trailing)),
  );

  let source_type = SourceType::from_program(program).with_typescript(is_type_script);
  let result = transform(program, source_type, code, Some(&comments), options);

  let mut diagnostics = Vec::new();
  let mut bailouts = Vec::new();
  for message in result.diagnostics {
    // Spans are 0-based byte offsets into the code, whose file starts at BytePos(1).
    let highlights = message
      .span
      .map(|(start, end)| {
        vec![highlight(
          source_map,
          Span::new(BytePos(start + 1), BytePos(end + 1)),
        )]
      })
      .unwrap_or_default();
    match message.severity {
      Severity::Error => diagnostics.push(diagnostic(
        message.message,
        highlights,
        DiagnosticSeverity::SourceError,
      )),
      Severity::Warning => bailouts.push(diagnostic(
        message.message,
        highlights,
        DiagnosticSeverity::Warning,
      )),
    }
  }

  // A failed compilation is reported once overall, and again for each error with its location.
  if diagnostics
    .iter()
    .any(|d| !d.code_frames[0].code_highlights.is_empty())
  {
    diagnostics.retain(|d| !d.code_frames[0].code_highlights.is_empty());
  }

  ReactCompilerResult {
    program: result.program,
    diagnostics,
    bailouts,
  }
}
