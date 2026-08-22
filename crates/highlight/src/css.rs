//! CSS highlighting on cssparser's tokenizer (via `Parser`, since the raw
//! `Tokenizer` isn't public API). CSS tokenization is total by spec — there is
//! no input that fails to tokenize — so error recovery is free.
//!
//! Block contents are visited with `parse_nested_block`, which also handles
//! unclosed blocks (it just runs to EOF). Spans are recovered from token slice
//! pointers because `SourcePosition`'s byte index isn't public.

use cssparser::{Parser, ParserInput, Token};

use crate::{Class, HighlightSpan};

struct RawCss {
  start: usize,
  end: usize,
  kind: Kind,
  depth: usize,
}

#[derive(Copy, Clone, PartialEq)]
enum Kind {
  Ident,
  AtKeyword,
  Hash,
  String,
  Number,
  Comment,
  Function,
  Colon,
  Semi,
  Comma,
  Delim,
  BlockOpen,
  Other,
}

/// With `declarations`, the input is bare declarations without a selector (an
/// HTML `style` attribute): start of input counts as declaration position and
/// nothing is a selector.
pub fn highlight_css(src: &str, declarations: bool) -> Vec<HighlightSpan> {
  let mut input = ParserInput::new(src);
  let mut parser = Parser::new(&mut input);
  let mut raw = Vec::new();
  walk(src, &mut parser, &mut raw, if declarations { 1 } else { 0 });

  let mut spans = Vec::new();
  for i in 0..raw.len() {
    let t = &raw[i];
    let class = match t.kind {
      Kind::AtKeyword => Some(Class::Keyword),
      Kind::String => Some(Class::String),
      Kind::Number => Some(Class::Number),
      Kind::Comment => Some(Class::Comment),
      Kind::Hash => Some(Class::Constant),
      Kind::Function => Some(Class::Function),
      Kind::Colon | Kind::Semi | Kind::Comma => Some(Class::Punctuation),
      Kind::Delim | Kind::BlockOpen | Kind::Other => None,
      Kind::Ident => {
        let next = raw[i + 1..].iter().find(|n| n.kind != Kind::Comment);
        let prev = raw[..i].iter().rev().find(|n| n.kind != Kind::Comment);
        if next.map_or(false, |n| n.kind == Kind::Colon)
          && prev.map_or(declarations, |p| {
            matches!(p.kind, Kind::BlockOpen | Kind::Semi)
          })
        {
          // Declaration position: after `{`, `(` or `;`, followed by `:`.
          // Catches property names and media-query features; leaves
          // pseudo-class selectors like `.card:hover` alone.
          Some(Class::Property)
        } else if t.depth == 0 {
          // Top level: type selectors, media query keywords, etc.
          Some(Class::Tag)
        } else {
          None
        }
      }
    };
    if let Some(class) = class {
      spans.push(HighlightSpan {
        start: t.start,
        end: t.end,
        class,
      });
    }
  }
  spans
}

fn walk<'i>(src: &str, parser: &mut Parser<'i, '_>, out: &mut Vec<RawCss>, depth: usize) {
  loop {
    let start = parser.position();
    let tok = match parser.next_including_whitespace_and_comments() {
      Ok(t) => t.clone(),
      Err(_) => break,
    };
    let text = parser.slice_from(start);
    let abs = text.as_ptr() as usize - src.as_ptr() as usize;
    let (s, e) = (abs, abs + text.len());

    let kind = match &tok {
      Token::WhiteSpace(_) => continue,
      Token::Comment(_) => Kind::Comment,
      Token::Ident(_) => Kind::Ident,
      Token::AtKeyword(_) => Kind::AtKeyword,
      Token::Hash(_) | Token::IDHash(_) => Kind::Hash,
      Token::QuotedString(_) | Token::UnquotedUrl(_) | Token::BadString(_) | Token::BadUrl(_) => {
        Kind::String
      }
      Token::Number { .. } | Token::Percentage { .. } | Token::Dimension { .. } => Kind::Number,
      Token::Colon => Kind::Colon,
      Token::Semicolon => Kind::Semi,
      Token::Comma => Kind::Comma,
      Token::Delim(_) => Kind::Delim,
      Token::Function(_) => Kind::Function,
      Token::CDO | Token::CDC => Kind::Comment,
      Token::CurlyBracketBlock | Token::ParenthesisBlock | Token::SquareBracketBlock => {
        Kind::BlockOpen
      }
      _ => Kind::Other,
    };
    out.push(RawCss {
      start: s,
      end: e,
      kind,
      depth,
    });

    match tok {
      Token::CurlyBracketBlock => {
        let _ = parser.parse_nested_block(|p| -> Result<(), cssparser::ParseError<'i, ()>> {
          walk(src, p, out, depth + 1);
          Ok(())
        });
      }
      Token::ParenthesisBlock | Token::SquareBracketBlock | Token::Function(_) => {
        let _ = parser.parse_nested_block(|p| -> Result<(), cssparser::ParseError<'i, ()>> {
          walk(src, p, out, depth);
          Ok(())
        });
      }
      _ => {}
    }
  }
}
