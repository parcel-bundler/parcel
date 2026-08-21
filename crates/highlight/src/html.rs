//! Hand-rolled HTML tokenizer (~100 lines). html5ever's tokenizer would also
//! work but doesn't expose byte offsets, which highlighting needs.
//!
//! `<script>` and `<style>` contents are delegated to the JS and CSS
//! highlighters with offset spans.

use crate::{Class, HighlightSpan};
use crate::{css, js};

pub fn highlight_html(src: &str) -> Vec<HighlightSpan> {
  let b = src.as_bytes();
  let mut out = Vec::new();
  let mut i = 0;

  while i < b.len() {
    if b[i] != b'<' {
      i += 1;
      continue;
    }
    if src[i..].starts_with("<!--") {
      let end = src[i..].find("-->").map(|p| i + p + 3).unwrap_or(b.len());
      out.push(HighlightSpan {
        start: i,
        end,
        class: Class::Comment,
      });
      i = end;
    } else if src[i..].starts_with("<!") || src[i..].starts_with("<?") {
      let end = src[i..].find('>').map(|p| i + p + 1).unwrap_or(b.len());
      out.push(HighlightSpan {
        start: i,
        end,
        class: Class::Keyword,
      });
      i = end;
    } else {
      let mut j = i + 1;
      let closing = j < b.len() && b[j] == b'/';
      if closing {
        j += 1;
      }
      let name_start = j;
      while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'-' || b[j] == b':') {
        j += 1;
      }
      if j == name_start {
        // `<` not opening a tag: plain text.
        i += 1;
        continue;
      }
      let name = src[name_start..j].to_ascii_lowercase();
      out.push(HighlightSpan {
        start: i,
        end: j,
        class: Class::Tag,
      });
      i = j;
      let self_closing = tag_attrs(src, &mut i, &mut out);

      if !closing && !self_closing && (name == "script" || name == "style") {
        let close = format!("</{name}");
        let content_end = src[i..]
          .to_ascii_lowercase()
          .find(&close)
          .map(|p| i + p)
          .unwrap_or(b.len());
        let inner = if name == "script" {
          js::highlight_js(&src[i..content_end], false, false)
        } else {
          css::highlight_css(&src[i..content_end], false)
        };
        out.extend(inner.into_iter().map(|s| HighlightSpan {
          start: s.start + i,
          end: s.end + i,
          class: s.class,
        }));
        i = content_end;
      }
    }
  }

  out.sort_by_key(|s| s.start);
  out
}

/// Lex attributes up to (and including) `>` or `/>`. Returns true for `/>`.
/// Recovers from broken tags by bailing at a stray `<`.
fn tag_attrs(src: &str, i: &mut usize, out: &mut Vec<HighlightSpan>) -> bool {
  let b = src.as_bytes();
  loop {
    while *i < b.len() && b[*i].is_ascii_whitespace() {
      *i += 1;
    }
    if *i >= b.len() || b[*i] == b'<' {
      return false; // Unterminated tag: recover at the next `<` or EOF.
    }
    match b[*i] {
      b'>' => {
        out.push(HighlightSpan {
          start: *i,
          end: *i + 1,
          class: Class::Tag,
        });
        *i += 1;
        return false;
      }
      b'/' if src[*i..].starts_with("/>") => {
        out.push(HighlightSpan {
          start: *i,
          end: *i + 2,
          class: Class::Tag,
        });
        *i += 2;
        return true;
      }
      b'=' => {
        *i += 1;
        while *i < b.len() && b[*i].is_ascii_whitespace() {
          *i += 1;
        }
        if *i < b.len() && (b[*i] == b'"' || b[*i] == b'\'') {
          let quote = b[*i];
          let start = *i;
          let end = src[*i + 1..]
            .find(quote as char)
            .map(|p| *i + 1 + p + 1)
            // Unterminated attribute value: stop at end of line so at most one
            // line miscolors.
            .or_else(|| src[*i..].find('\n').map(|p| *i + p))
            .unwrap_or(b.len());
          out.push(HighlightSpan {
            start,
            end,
            class: Class::String,
          });
          *i = end;
        } else {
          let start = *i;
          while *i < b.len() && !b[*i].is_ascii_whitespace() && b[*i] != b'>' && b[*i] != b'<' {
            *i += 1;
          }
          if *i > start {
            out.push(HighlightSpan {
              start,
              end: *i,
              class: Class::String,
            });
          }
        }
      }
      _ => {
        let start = *i;
        while *i < b.len()
          && !b[*i].is_ascii_whitespace()
          && !matches!(b[*i], b'=' | b'>' | b'<' | b'/' | b'"' | b'\'')
        {
          *i += 1;
        }
        if *i == start {
          // Stray `/`, quote, etc. inside a tag.
          *i += 1;
        } else {
          out.push(HighlightSpan {
            start,
            end: *i,
            class: Class::Attribute,
          });
        }
      }
    }
  }
}
