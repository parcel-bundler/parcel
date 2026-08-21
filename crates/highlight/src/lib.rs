//! Token-level syntax highlighting for diagnostic code frames.
//!
//! Highlights JS/TS/JSX/TSX/JSON with swc's lexer, CSS with cssparser's
//! tokenizer, and HTML with a small hand-rolled tokenizer — all of which are
//! already linked into the parcel binary, replacing ~1.5MB of tree-sitter
//! parse tables. Because everything works at the token level, broken code
//! (the usual subject of a code frame) keeps full highlighting right through
//! the error: an unterminated string colors at most one line, and an
//! unlexable character is skipped without derailing the rest of the file.

mod css;
mod html;
mod js;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Language {
  Js,
  Jsx,
  Ts,
  Tsx,
  Css,
  /// Bare declarations without a selector, as in an HTML `style` attribute.
  CssDeclarations,
  Json,
  Html,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Class {
  Keyword,
  String,
  Number,
  Regex,
  Comment,
  Punctuation,
  Operator,
  /// `true` / `false` / `null`.
  Constant,
  /// ALL_CAPS identifiers, mirroring tree-sitter's `#match?` heuristic.
  CapsConst,
  /// Capitalized identifiers, mirroring tree-sitter's `#match?` heuristic.
  Constructor,
  Function,
  Property,
  Tag,
  Attribute,
}

/// A classified byte range of the source. Ranges are sorted, never overlap,
/// and always fall on char boundaries; bytes not covered by any span render
/// unstyled.
#[derive(Clone, Debug)]
pub struct HighlightSpan {
  pub start: usize,
  pub end: usize,
  pub class: Class,
}

pub fn highlight(src: &str, language: Language) -> Vec<HighlightSpan> {
  match language {
    Language::Js | Language::Json => js::highlight_js(src, false, false),
    Language::Jsx => js::highlight_js(src, false, true),
    Language::Ts => js::highlight_js(src, true, false),
    Language::Tsx => js::highlight_js(src, true, true),
    Language::Css => css::highlight_css(src, false),
    Language::CssDeclarations => css::highlight_css(src, true),
    Language::Html => html::highlight_html(src),
  }
}
