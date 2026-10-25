//! A [JSON5](https://spec.json5.org) parser producing `serde_json` values.
//!
//! JSON5 is a superset of JSON that adds comments, trailing commas, unquoted keys,
//! single-quoted strings and more of the ECMAScript number syntax. Parcel accepts it
//! wherever Parcel 2 did: `.parcelrc` files and JSON assets.
//!
//! Hand-written rather than a dependency because the JSON5 crates on crates.io are
//! built on pest, which costs far more binary size than this does.

use serde_json::{Map, Number, Value};

use crate::{AssetType, CodeFrame, CodeHighlight, Diagnostic, Location, SourceUrl};

/// Matches `serde_json`, so that strict JSON is limited the same way on either path.
const MAX_DEPTH: u32 = 128;

/// A syntax error, with the 1-based line and column (in characters) it was found at.
#[derive(Debug, Clone, PartialEq)]
pub struct Json5Error {
  pub message: String,
  pub line: u32,
  pub column: u32,
}

impl Json5Error {
  /// Converts the error to a diagnostic with a code frame pointing at the error.
  pub fn to_diagnostic(&self, source: &str, url: SourceUrl) -> Diagnostic {
    let location = Location {
      line: self.line,
      column: self.column,
    };
    let mut diagnostic = Diagnostic::from_message(self.message.clone());
    diagnostic.code_frames.push(CodeFrame {
      code: Some(source.to_owned()),
      url: Some(url),
      language: Some(AssetType::Json),
      code_highlights: vec![CodeHighlight {
        message: None,
        start: location.clone(),
        end: location,
      }],
    });
    diagnostic
  }
}

impl std::fmt::Display for Json5Error {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(
      f,
      "{} at line {} column {}",
      self.message, self.line, self.column
    )
  }
}

impl std::error::Error for Json5Error {}

/// Parses a JSON5 document.
///
/// `Infinity` and `NaN` have no JSON representation, so they become `null`, as they
/// do when JavaScript serializes them with `JSON.stringify`.
pub fn parse(source: &str) -> Result<Value, Json5Error> {
  // Most input is plain JSON, which serde_json parses much faster. Both parsers
  // produce the same value for it, so this is purely an optimization.
  if let Ok(value) = serde_json::from_str(source) {
    return Ok(value);
  }

  let mut parser = Parser {
    source,
    pos: 0,
    depth: 0,
  };
  let value = parser.value()?;
  parser.skip_whitespace()?;
  if parser.pos < source.len() {
    return Err(parser.unexpected());
  }
  Ok(value)
}

struct Parser<'a> {
  source: &'a str,
  pos: usize,
  depth: u32,
}

impl<'a> Parser<'a> {
  fn peek(&self) -> Option<char> {
    self.source[self.pos..].chars().next()
  }

  fn peek_second(&self) -> Option<char> {
    let mut chars = self.source[self.pos..].chars();
    chars.next();
    chars.next()
  }

  fn bump(&mut self) -> Option<char> {
    let c = self.peek()?;
    self.pos += c.len_utf8();
    Some(c)
  }

  fn eat(&mut self, c: char) -> bool {
    if self.peek() == Some(c) {
      self.pos += c.len_utf8();
      true
    } else {
      false
    }
  }

  fn error_at(&self, pos: usize, message: String) -> Json5Error {
    let before = &self.source[..pos];
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    Json5Error {
      message,
      line: before.matches('\n').count() as u32 + 1,
      column: before[line_start..].chars().count() as u32 + 1,
    }
  }

  fn unexpected(&self) -> Json5Error {
    let message = match self.peek() {
      Some(c) => format!("Unexpected character {:?}", c),
      None => "Unexpected end of input".into(),
    };
    self.error_at(self.pos, message)
  }

  fn skip_whitespace(&mut self) -> Result<(), Json5Error> {
    loop {
      match self.peek() {
        Some('/') if self.peek_second() == Some('/') => {
          while let Some(c) = self.peek() {
            if is_line_terminator(c) {
              break;
            }
            self.bump();
          }
        }
        Some('/') if self.peek_second() == Some('*') => {
          let start = self.pos;
          match self.source[self.pos + 2..].find("*/") {
            Some(end) => self.pos += 2 + end + 2,
            None => return Err(self.error_at(start, "Unterminated comment".into())),
          }
        }
        Some(c) if c.is_whitespace() || c == '\u{FEFF}' => {
          self.bump();
        }
        _ => return Ok(()),
      }
    }
  }

  fn value(&mut self) -> Result<Value, Json5Error> {
    self.skip_whitespace()?;
    match self.peek() {
      Some('{') => self.nested(Self::object),
      Some('[') => self.nested(Self::array),
      Some(quote @ ('"' | '\'')) => Ok(Value::String(self.string(quote)?)),
      Some('-' | '+' | '.' | '0'..='9') => self.number(),
      Some(c) if is_identifier_start(c) => {
        let start = self.pos;
        let word = self.identifier()?;
        match word.as_str() {
          "null" => Ok(Value::Null),
          "true" => Ok(Value::Bool(true)),
          "false" => Ok(Value::Bool(false)),
          "Infinity" | "NaN" => Ok(Value::Null),
          _ => Err(self.error_at(start, format!("Unexpected identifier {:?}", word))),
        }
      }
      _ => Err(self.unexpected()),
    }
  }

  fn nested(
    &mut self,
    parse: fn(&mut Self) -> Result<Value, Json5Error>,
  ) -> Result<Value, Json5Error> {
    if self.depth == MAX_DEPTH {
      return Err(self.error_at(self.pos, "Exceeded the maximum nesting depth".into()));
    }
    self.depth += 1;
    let value = parse(self);
    self.depth -= 1;
    value
  }

  fn object(&mut self) -> Result<Value, Json5Error> {
    self.bump();
    let mut map = Map::new();
    loop {
      self.skip_whitespace()?;
      if self.eat('}') {
        break;
      }

      let key = match self.peek() {
        Some(quote @ ('"' | '\'')) => self.string(quote)?,
        Some(c) if c == '\\' || is_identifier_start(c) => self.identifier()?,
        _ => return Err(self.unexpected()),
      };

      self.skip_whitespace()?;
      if !self.eat(':') {
        return Err(self.unexpected());
      }

      let value = self.value()?;
      map.insert(key, value);

      self.skip_whitespace()?;
      if !self.eat(',') {
        if self.eat('}') {
          break;
        }
        return Err(self.unexpected());
      }
    }
    Ok(Value::Object(map))
  }

  fn array(&mut self) -> Result<Value, Json5Error> {
    self.bump();
    let mut values = Vec::new();
    loop {
      self.skip_whitespace()?;
      if self.eat(']') {
        break;
      }

      values.push(self.value()?);

      self.skip_whitespace()?;
      if !self.eat(',') {
        if self.eat(']') {
          break;
        }
        return Err(self.unexpected());
      }
    }
    Ok(Value::Array(values))
  }

  fn string(&mut self, quote: char) -> Result<String, Json5Error> {
    let start = self.pos;
    self.bump();
    let mut result = String::new();
    loop {
      // Copy runs of ordinary characters in one go.
      let rest = &self.source[self.pos..];
      let run = rest
        .find(|c| c == quote || c == '\\' || c == '\n' || c == '\r')
        .unwrap_or(rest.len());
      result.push_str(&rest[..run]);
      self.pos += run;

      match self.bump() {
        Some(c) if c == quote => return Ok(result),
        Some('\\') => self.escape(&mut result)?,
        _ => return Err(self.error_at(start, "Unterminated string".into())),
      }
    }
  }

  fn escape(&mut self, result: &mut String) -> Result<(), Json5Error> {
    let start = self.pos;
    let Some(c) = self.bump() else {
      return Err(self.unexpected());
    };
    match c {
      'b' => result.push('\u{8}'),
      'f' => result.push('\u{C}'),
      'n' => result.push('\n'),
      'r' => result.push('\r'),
      't' => result.push('\t'),
      'v' => result.push('\u{B}'),
      '0' if !matches!(self.peek(), Some('0'..='9')) => result.push('\0'),
      '0'..='9' => return Err(self.error_at(start, format!("Unexpected character {:?}", c))),
      'x' => {
        let code = self.hex_digits(2)?;
        result.push(char::from_u32(code).unwrap());
      }
      'u' => result.push(self.unicode_escape()?),
      // A line continuation.
      '\r' => {
        self.eat('\n');
      }
      '\n' | '\u{2028}' | '\u{2029}' => {}
      // Any other character escapes itself, including quotes and backslashes.
      c => result.push(c),
    }
    Ok(())
  }

  /// Parses the hex digits of a `\u` escape, with the `\u` already consumed.
  fn unicode_escape(&mut self) -> Result<char, Json5Error> {
    let code = self.hex_digits(4)?;
    if (0xD800..0xDC00).contains(&code) && self.source[self.pos..].starts_with("\\u") {
      let pos = self.pos;
      self.pos += 2;
      let low = self.hex_digits(4)?;
      if (0xDC00..0xE000).contains(&low) {
        let code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
        return Ok(char::from_u32(code).unwrap());
      }
      self.pos = pos;
    }
    // A lone surrogate cannot be represented in a Rust string.
    Ok(char::from_u32(code).unwrap_or(char::REPLACEMENT_CHARACTER))
  }

  fn hex_digits(&mut self, count: usize) -> Result<u32, Json5Error> {
    let mut code = 0;
    for _ in 0..count {
      match self.peek().and_then(|c| c.to_digit(16)) {
        Some(digit) => {
          code = code * 16 + digit;
          self.pos += 1;
        }
        None => return Err(self.unexpected()),
      }
    }
    Ok(code)
  }

  fn identifier(&mut self) -> Result<String, Json5Error> {
    let mut result = String::new();
    loop {
      let start = self.pos;
      let c = match self.peek() {
        Some('\\') => {
          self.bump();
          if !self.eat('u') {
            return Err(self.unexpected());
          }
          self.unicode_escape()?
        }
        Some(c) => {
          self.bump();
          c
        }
        None => break,
      };

      let valid = if result.is_empty() {
        is_identifier_start(c)
      } else {
        is_identifier_part(c)
      };
      if !valid {
        if result.is_empty() || self.source[start..].starts_with('\\') {
          return Err(self.error_at(start, format!("Unexpected character {:?}", c)));
        }
        self.pos = start;
        break;
      }
      result.push(c);
    }
    Ok(result)
  }

  fn number(&mut self) -> Result<Value, Json5Error> {
    let negative = self.peek() == Some('-');
    if matches!(self.peek(), Some('-' | '+')) {
      self.bump();
    }

    let rest = &self.source[self.pos..];
    if rest.starts_with("Infinity") || rest.starts_with("NaN") {
      self.pos += if rest.starts_with('I') { 8 } else { 3 };
      return Ok(Value::Null);
    }

    if rest.starts_with("0x") || rest.starts_with("0X") {
      self.pos += 2;
      let digits = self.digits(|c| c.is_ascii_hexdigit());
      if digits.is_empty() {
        return Err(self.unexpected());
      }
      let sign = if negative { "-" } else { "" };
      let number = match u128::from_str_radix(digits, 16) {
        Ok(n) => format!("{sign}{n}"),
        Err(_) => {
          let n = digits
            .chars()
            .fold(0f64, |n, c| n * 16.0 + c.to_digit(16).unwrap() as f64);
          format!("{sign}{n:e}")
        }
      };
      return Ok(parse_number(&number));
    }

    // Normalize to a JSON number, which JSON5 extends with a leading or trailing
    // decimal point, and let serde_json parse that.
    let mut number = String::new();
    if negative {
      number.push('-');
    }

    let integer_start = self.pos;
    let integer = self.digits(|c| c.is_ascii_digit());
    if integer.len() > 1 && integer.starts_with('0') {
      return Err(self.error_at(
        integer_start + 1,
        format!("Unexpected character {:?}", integer.chars().nth(1).unwrap()),
      ));
    }
    number.push_str(if integer.is_empty() { "0" } else { integer });

    if self.eat('.') {
      let fraction = self.digits(|c| c.is_ascii_digit());
      if integer.is_empty() && fraction.is_empty() {
        return Err(self.unexpected());
      }
      number.push('.');
      number.push_str(if fraction.is_empty() { "0" } else { fraction });
    } else if integer.is_empty() {
      return Err(self.unexpected());
    }

    if matches!(self.peek(), Some('e' | 'E')) {
      self.bump();
      number.push('e');
      if let Some(sign @ ('-' | '+')) = self.peek() {
        self.bump();
        number.push(sign);
      }
      let exponent = self.digits(|c| c.is_ascii_digit());
      if exponent.is_empty() {
        return Err(self.unexpected());
      }
      number.push_str(exponent);
    }

    Ok(parse_number(&number))
  }

  fn digits(&mut self, matches: impl Fn(char) -> bool) -> &'a str {
    let rest = &self.source[self.pos..];
    let len = rest.find(|c| !matches(c)).unwrap_or(rest.len());
    self.pos += len;
    &rest[..len]
  }
}

/// Parses a valid JSON number. One too large for an `f64` is infinite in
/// JavaScript, which JSON represents as `null`.
fn parse_number(number: &str) -> Value {
  serde_json::from_str::<Number>(number).map_or(Value::Null, Value::Number)
}

fn is_line_terminator(c: char) -> bool {
  matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

fn is_identifier_start(c: char) -> bool {
  c == '$' || c == '_' || c.is_alphabetic()
}

fn is_identifier_part(c: char) -> bool {
  is_identifier_start(c) || c.is_alphanumeric() || c == '\u{200C}' || c == '\u{200D}'
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn error(source: &str) -> (String, u32, u32) {
    let err = parse(source).unwrap_err();
    (err.message, err.line, err.column)
  }

  #[test]
  fn parses_json() {
    assert_eq!(
      parse(r#"{"a": [1, -2.5, true, false, null, "x\né"]}"#).unwrap(),
      json!({"a": [1, -2.5, true, false, null, "x\né"]})
    );
  }

  #[test]
  fn parses_json5() {
    let source = r#"
      // A line comment.
      {
        /* A block
           comment. */
        unquoted: 'single',
        $dollar_key1: "double",
        'quoted': [1, 2,],
        "nested": {a: {b: [],},},
        trailing: 'comma',
      }
    "#;
    assert_eq!(
      parse(source).unwrap(),
      json!({
        "unquoted": "single",
        "$dollar_key1": "double",
        "quoted": [1, 2],
        "nested": {"a": {"b": []}},
        "trailing": "comma",
      })
    );
    assert_eq!(
      parse(r#"{hello: ["world",]}"#).unwrap(),
      json!({"hello": ["world"]})
    );
  }

  #[test]
  fn preserves_key_order_and_overrides_duplicates() {
    let value = parse("{b: 1, a: 2, b: 3,}").unwrap();
    assert_eq!(serde_json::to_string(&value).unwrap(), r#"{"b":3,"a":2}"#);
  }

  #[test]
  fn parses_numbers() {
    // Compared as values, since serde_json's `arbitrary_precision` feature (enabled
    // by another dependency) otherwise makes equality depend on the source text.
    let value = parse("[0x1F, -0XaB, +1, .5, 5., -.5e1, 1E+2, 0, 0.0]").unwrap();
    let numbers: Vec<f64> = value
      .as_array()
      .unwrap()
      .iter()
      .map(|n| n.as_f64().unwrap())
      .collect();
    assert_eq!(
      numbers,
      [31.0, -171.0, 1.0, 0.5, 5.0, -5.0, 100.0, 0.0, 0.0]
    );
    assert_eq!(value[0].as_i64(), Some(31));
    assert_eq!(value[1].as_i64(), Some(-171));
    assert_eq!(
      parse("[Infinity, -Infinity, +Infinity, NaN, -NaN]").unwrap(),
      json!([null, null, null, null, null])
    );
    assert_eq!(
      parse("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")
        .unwrap()
        .as_f64(),
      Some(16f64.powi(34))
    );
  }

  #[test]
  fn parses_strings() {
    assert_eq!(
      parse(r#"['a"b', "a'b", 'it\'s', "\x41B😀", "\b\f\n\r\t\v\0\/\q"]"#).unwrap(),
      json!(["a\"b", "a'b", "it's", "AB😀", "\u{8}\u{C}\n\r\t\u{B}\0/q"])
    );
    assert_eq!(
      parse("'line \\\ncontinued \\\r\nagain'").unwrap(),
      json!("line continued again")
    );
    assert_eq!(parse("'\u{2028}'").unwrap(), json!("\u{2028}"));
  }

  #[test]
  fn parses_identifier_keys() {
    assert_eq!(
      parse(r"{café: 1, _a1: 2, ab: 3, null: 4, true: 5}").unwrap(),
      json!({"café": 1, "_a1": 2, "ab": 3, "null": 4, "true": 5})
    );
  }

  #[test]
  fn reports_syntax_errors_with_locations() {
    assert_eq!(error(""), ("Unexpected end of input".into(), 1, 1));
    assert_eq!(
      error("{\n  a: 1\n  b: 2\n}"),
      ("Unexpected character 'b'".into(), 3, 3)
    );
    assert_eq!(error("[1,,]"), ("Unexpected character ','".into(), 1, 4));
    assert_eq!(error("{,}"), ("Unexpected character ','".into(), 1, 2));
    assert_eq!(error("{a 1}"), ("Unexpected character '1'".into(), 1, 4));
    assert_eq!(error("[1] 2"), ("Unexpected character '2'".into(), 1, 5));
    assert_eq!(error("[1"), ("Unexpected end of input".into(), 1, 3));
    assert_eq!(
      error("{a: undefined}"),
      ("Unexpected identifier \"undefined\"".into(), 1, 5)
    );
    assert_eq!(error("{'a\nb': 1}"), ("Unterminated string".into(), 1, 2));
    assert_eq!(error("[/* x"), ("Unterminated comment".into(), 1, 2));
    assert_eq!(error("[01]"), ("Unexpected character '1'".into(), 1, 3));
    assert_eq!(error("[.]"), ("Unexpected character ']'".into(), 1, 3));
    assert_eq!(error("[1e]"), ("Unexpected character ']'".into(), 1, 4));
    assert_eq!(error("[0x]"), ("Unexpected character ']'".into(), 1, 4));
    assert_eq!(error("'\\1'"), ("Unexpected character '1'".into(), 1, 3));
    assert_eq!(
      error("'\\u12'"),
      ("Unexpected character '\\''".into(), 1, 6)
    );
    assert_eq!(error("{a-b: 1}"), ("Unexpected character '-'".into(), 1, 3));
    assert_eq!(
      error(&"[".repeat(200)),
      ("Exceeded the maximum nesting depth".into(), 1, 129)
    );
  }
}
