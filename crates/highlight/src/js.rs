//! JS/TS/JSX/TSX highlighting built on swc's lexer, driven standalone through
//! the public `Tokens` trait (behind swc_ecma_parser's `unstable` feature).
//!
//! The lexer alone does not decide regex-vs-division, template continuation,
//! or JSX modes — the parser normally drives those via `set_next_regexp`,
//! `rescan_template_token`, and the `scan_jsx_*` family. All are `Tokens`
//! trait methods, so this driver replays the same calls:
//!
//! - regex: swc's own per-token `before_expr()` metadata (the classic "does a
//!   `/` here start a regex" bit),
//! - templates: a brace stack for `${}` substitutions,
//! - JSX: a mini state machine mirroring the parser's `parse_jsx_element`,
//!   with a graceful bail-out at every expectation since input may be broken.
//!
//! Comments never surface as tokens; they are recovered afterwards from the
//! gaps between token spans (between two JS tokens only whitespace and
//! comments can appear).

use swc_common::BytePos;
use swc_ecma_ast::EsVersion;
use swc_ecma_parser::input::Tokens;
use swc_ecma_parser::unstable::{Token, TokenAndSpan};
use swc_ecma_parser::{EsSyntax, Lexer, StringInput, Syntax, TsSyntax};

use crate::{Class, HighlightSpan};

struct RawTok {
  start: usize,
  end: usize,
  token: Token,
  /// Class decided during lexing (JSX tags/attrs); overrides `classify`.
  force: Option<Class>,
}

enum Ctx {
  Tpl,
  Brace,
}

const MAX_DEPTH: u32 = 200;

struct Driver<'a> {
  lexer: Lexer<'a>,
  src: &'a str,
  toks: Vec<RawTok>,
  last_pos: usize,
  src_len: usize,
  jsx: bool,
  depth: u32,
  bailed: bool,
}

pub fn highlight_js(src: &str, ts: bool, jsx: bool) -> Vec<HighlightSpan> {
  let syntax = if ts {
    Syntax::Typescript(TsSyntax {
      tsx: jsx,
      decorators: true,
      ..Default::default()
    })
  } else {
    Syntax::Es(EsSyntax {
      jsx,
      decorators: true,
      ..Default::default()
    })
  };

  let lexer = Lexer::new(
    syntax,
    EsVersion::latest(),
    StringInput::new(src, BytePos(0), BytePos(src.len() as u32)),
    None,
  );

  let mut driver = Driver {
    lexer,
    src,
    toks: Vec::new(),
    last_pos: 0,
    src_len: src.len(),
    jsx,
    depth: 0,
    bailed: false,
  };
  let first = driver.lexer.first_token();
  driver.run(first, false);

  let toks = driver.toks;
  let mut spans: Vec<HighlightSpan> = Vec::new();
  for i in 0..toks.len() {
    if let Some(class) = toks[i].force.or_else(|| classify(src, &toks, i)) {
      spans.push(HighlightSpan {
        start: toks[i].start,
        end: toks[i].end,
        class,
      });
    }
  }
  spans.extend(comment_spans(src, &toks));
  spans.sort_by_key(|s| s.start);
  spans
}

impl Driver<'_> {
  /// Record a token. Returns false (and bails the whole run) if the lexer has
  /// stopped advancing — e.g. repeated zero-width error tokens.
  fn push(&mut self, t: &TokenAndSpan, force: Option<Class>) -> bool {
    let (lo, hi) = (t.span.lo.0 as usize, t.span.hi.0 as usize);
    if hi <= self.last_pos || hi > self.src_len {
      self.bailed = true;
      return false;
    }
    self.last_pos = hi;
    self.toks.push(RawTok {
      start: lo,
      end: hi,
      token: t.token,
      force,
    });
    true
  }

  fn next(&mut self) -> TokenAndSpan {
    self.lexer.next_token()
  }

  /// Splits `>=`, `>>`, `>>=`, `>>>`, `>>>=` back into `>` where JSX expects a
  /// bare `>`, exactly like the parser's `rescan_jsx_open_el_terminal_token`.
  fn split_gt(&mut self, t: TokenAndSpan) -> TokenAndSpan {
    if t.token.should_rescan_into_gt_in_jsx() {
      self.lexer.rescan_jsx_open_el_terminal_token(t.span.lo)
    } else {
      t
    }
  }

  /// Process expression/statement tokens. With `stop_at_unmatched_rbrace`,
  /// returns (without consuming) at a `}` that closes no `{` seen here — the
  /// end of a JSX `{...}` container.
  fn run(&mut self, mut t: TokenAndSpan, stop_at_unmatched_rbrace: bool) -> TokenAndSpan {
    let mut stack: Vec<Ctx> = Vec::new();
    let mut prev: Option<Token> = None;
    loop {
      if self.bailed || t.token == Token::Eof {
        return t;
      }
      match t.token {
        // The lexer lexed `/` (or `/=`) as an operator. If the previous token
        // says an expression may start here, re-lex it as a regex, exactly as
        // the parser would.
        Token::Slash | Token::DivEq
          if prev.map_or(true, |p| p.before_expr()) && prev != Some(Token::Lt) =>
        {
          self.lexer.set_next_regexp(Some(t.span.lo));
          t = self.next();
          self.lexer.set_next_regexp(None);
          // Reprocess: `t` is now Token::Regex (or Token::Error on a broken
          // regex); neither matches this arm again.
          continue;
        }
        // The lexer reads `` `...${ `` / `` `...` `` heads on its own; only
        // the continuation after a substitution's `}` needs driving.
        Token::TemplateHead => stack.push(Ctx::Tpl),
        Token::LBrace => stack.push(Ctx::Brace),
        Token::RBrace => match stack.pop() {
          Some(Ctx::Tpl) => {
            // This `}` ends a `${}` substitution: re-lex it as the next chunk
            // of the template literal. The rescanned span starts after the
            // `}`; pull it back one byte so the `}` is styled with it.
            t = self.lexer.rescan_template_token(t.span.lo, false);
            t.span.lo = t.span.lo - BytePos(1);
            if t.token == Token::TemplateMiddle {
              stack.push(Ctx::Tpl);
            }
          }
          Some(Ctx::Brace) => {}
          None if stop_at_unmatched_rbrace => return t,
          None => {}
        },
        // `<` in expression position starts a JSX element (jsx syntax only).
        Token::Lt if self.jsx && prev.map_or(true, |p| p.before_expr()) => {
          t = self.jsx_element(t, true);
          // A JSX element is an expression; anything standing in for "the
          // previous token was an expression end" works here.
          prev = Some(Token::RParen);
          continue;
        }
        _ => {}
      }
      prev = Some(t.token);
      if !self.push(&t, None) {
        return t;
      }
      t = self.next();
    }
  }

  /// Mirrors `Parser::parse_jsx_element`. `lt` is the already-lexed `<`.
  /// Returns the token to continue with: normally-lexed when `in_expr`,
  /// child-mode (from `scan_jsx_token`) otherwise. Unexpected tokens bail
  /// back to the caller so broken JSX degrades instead of derailing.
  fn jsx_element(&mut self, lt: TokenAndSpan, in_expr: bool) -> TokenAndSpan {
    if self.depth >= MAX_DEPTH {
      self.push(&lt, None);
      return self.next();
    }
    self.depth += 1;
    let t = self.jsx_element_inner(lt, in_expr);
    self.depth -= 1;
    t
  }

  fn jsx_element_inner(&mut self, lt: TokenAndSpan, in_expr: bool) -> TokenAndSpan {
    self.push(&lt, Some(Class::Tag));
    let mut t = self.next();
    t = self.split_gt(t);

    // `<>` fragment
    if t.token == Token::Gt {
      self.push(&t, Some(Class::Tag));
      let t = self.lexer.scan_jsx_token();
      return self.jsx_children(t, in_expr);
    }

    // Tag name (possibly `ns:name` / `Foo.Bar`)
    t = self.jsx_name(t, Class::Tag);

    // Attributes, until `>` or `/>`
    loop {
      if self.bailed {
        return t;
      }
      t = self.split_gt(t);
      match t.token {
        Token::Gt => {
          self.push(&t, Some(Class::Tag));
          let t = self.lexer.scan_jsx_token();
          return self.jsx_children(t, in_expr);
        }
        Token::Slash => {
          // `/>` self-closing
          self.push(&t, Some(Class::Tag));
          t = self.next();
          t = self.split_gt(t);
          if t.token != Token::Gt {
            return t;
          }
          self.push(&t, Some(Class::Tag));
          return if in_expr {
            self.next()
          } else {
            self.lexer.scan_jsx_token()
          };
        }
        // `{...spread}`
        Token::LBrace => {
          self.push(&t, None);
          let n = self.next();
          t = self.run(n, true);
          if t.token != Token::RBrace {
            return t;
          }
          self.push(&t, None);
          t = self.next();
        }
        _ if t.token.is_word() => {
          t = self.jsx_name(t, Class::Attribute);
          if t.token == Token::Eq {
            self.push(&t, None);
            // Scans a quoted value from the current input position (the
            // parser calls this without bumping past `=` first).
            t = self.lexer.scan_jsx_attribute_value();
            match t.token {
              Token::Str => {
                // JSX attribute strings are legally multiline, which means an
                // *unterminated* one swallows everything to the next quote in
                // the file. Code frames are usually rendered for broken code,
                // so contain the damage: cap a newline-spanning value at end
                // of line and resume scanning there.
                let (lo, hi) = (t.span.lo.0 as usize, t.span.hi.0 as usize);
                if let Some(nl) = self.src[lo..hi].find('\n') {
                  t.span.hi = BytePos((lo + nl) as u32);
                  self.push(&t, Some(Class::String));
                  t = self
                    .lexer
                    .rescan_jsx_open_el_terminal_token(BytePos((lo + nl) as u32));
                } else {
                  self.push(&t, Some(Class::String));
                  t = self.next();
                }
              }
              Token::LBrace => {
                self.push(&t, None);
                let n = self.next();
                t = self.run(n, true);
                if t.token != Token::RBrace {
                  return t;
                }
                self.push(&t, None);
                t = self.next();
              }
              Token::Lt => t = self.jsx_element(t, true),
              _ => return t,
            }
          }
        }
        _ => return t,
      }
    }
  }

  /// A JSX identifier (`foo-bar`), plus any `:` / `.` chain. The token must
  /// currently be word-like for the rescan; anything else passes through.
  fn jsx_name(&mut self, mut t: TokenAndSpan, class: Class) -> TokenAndSpan {
    if !t.token.is_word() {
      return t;
    }
    t = self.lexer.scan_jsx_identifier(t.span.lo);
    self.push(&t, Some(class));
    t = self.next();
    while matches!(t.token, Token::Dot | Token::Colon) {
      self.push(&t, None);
      t = self.next();
      if !t.token.is_word() {
        break;
      }
      t = self.lexer.scan_jsx_identifier(t.span.lo);
      self.push(&t, Some(class));
      t = self.next();
    }
    t
  }

  /// Children of an open element/fragment: text, `{expr}` containers, nested
  /// elements, and the closing tag. `t` is in child mode (`scan_jsx_token`).
  fn jsx_children(&mut self, mut t: TokenAndSpan, in_expr: bool) -> TokenAndSpan {
    loop {
      if self.bailed {
        return t;
      }
      match t.token {
        Token::JSXText => {
          if !self.push(&t, None) {
            return t;
          }
          t = self.lexer.scan_jsx_token();
        }
        Token::LBrace => {
          self.push(&t, None);
          let n = self.next();
          t = self.run(n, true);
          if t.token != Token::RBrace {
            return t;
          }
          self.push(&t, None);
          t = self.lexer.scan_jsx_token();
        }
        Token::Lt => t = self.jsx_element(t, false),
        Token::LessSlash => {
          // `</name>`
          self.push(&t, Some(Class::Tag));
          t = self.next();
          t = self.jsx_name(t, Class::Tag);
          t = self.split_gt(t);
          if t.token != Token::Gt {
            return t;
          }
          self.push(&t, Some(Class::Tag));
          return if in_expr {
            self.next()
          } else {
            self.lexer.scan_jsx_token()
          };
        }
        _ => return t,
      }
    }
  }
}

fn classify(src: &str, toks: &[RawTok], i: usize) -> Option<Class> {
  use Token as T;
  let t = toks[i].token;
  Some(match t {
    T::Str => Class::String,
    T::Num | T::BigInt => Class::Number,
    T::Regex => Class::Regex,
    T::Template
    | T::NoSubstitutionTemplateLiteral
    | T::TemplateHead
    | T::TemplateMiddle
    | T::TemplateTail => Class::String,
    T::True | T::False | T::Null => Class::Constant,
    T::Shebang => Class::Comment,
    // Broken input: leave the error region unstyled and keep going.
    T::Error | T::JSXText | T::JSXName => return None,
    _ if t.is_keyword() => Class::Keyword,
    // Contextual keywords (`async`, `type`, `get`, ...) are their own token
    // variants but are only keywords in positions a lexer can't see; treat
    // them like plain identifiers.
    _ if t == T::Ident || t.is_known_ident() => {
      let after_dot = i > 0 && toks[i - 1].token == T::Dot;
      let next = toks.get(i + 1).map(|n| n.token);
      let text = &src[toks[i].start..toks[i].end];
      // `async` is a keyword when a function/arrow/method follows, and the
      // TS declaration keywords are keywords when a name follows.
      if !after_dot
        && ((t == T::Async && next.map_or(false, |n| n == T::LParen || n.is_word()))
          || (matches!(
            t,
            T::Interface | T::Type | T::Namespace | T::Declare | T::Enum | T::Satisfies | T::As
          ) && next.map_or(false, |n| n.is_word())))
      {
        Class::Keyword
      }
      // Mirror tree-sitter's text heuristics: ALL_CAPS → constant,
      // Capitalized → constructor.
      else if text.len() > 1
        && text.bytes().all(|b| matches!(b, b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'$'))
      {
        Class::CapsConst
      } else if text.as_bytes()[0].is_ascii_uppercase() {
        Class::Constructor
      }
      // Call position beats member position: `a.b()` styles `b` as a
      // function (matching tree-sitter's function.method capture), while
      // `a.b` styles it as a property.
      else if next == Some(T::LParen) {
        Class::Function
      } else if after_dot {
        Class::Property
      } else {
        return None;
      }
    }
    T::LParen
    | T::RParen
    | T::LBrace
    | T::RBrace
    | T::LBracket
    | T::RBracket
    | T::Semi
    | T::Comma
    | T::Dot
    | T::DotDotDot
    | T::Colon
    | T::QuestionMark
    | T::At
    | T::Hash
    | T::Arrow
    | T::BackQuote
    | T::DollarLBrace => Class::Punctuation,
    _ if t.is_word() => return None,
    _ => Class::Operator,
  })
}

/// Between two JS tokens only whitespace and comments can appear, so any
/// non-whitespace in a gap is a comment (or the interior of one that failed to
/// terminate). No comment plumbing needed.
fn comment_spans(src: &str, toks: &[RawTok]) -> Vec<HighlightSpan> {
  let mut out = Vec::new();
  let push_gap = |start: usize, end: usize, out: &mut Vec<HighlightSpan>| {
    let gap = &src[start..end];
    if gap.trim().is_empty() {
      return;
    }
    let s = start + (gap.len() - gap.trim_start().len());
    let e = end - (gap.len() - gap.trim_end().len());
    out.push(HighlightSpan {
      start: s,
      end: e,
      class: Class::Comment,
    });
  };

  let mut pos = 0;
  for t in toks {
    push_gap(pos, t.start, &mut out);
    pos = t.end;
  }
  push_gap(pos, src.len(), &mut out);
  out
}
