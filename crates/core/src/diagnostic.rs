use std::io::Write;

use anstyle::{Ansi256Color, AnsiColor, Color, Style};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{AssetType, Location, SourceLocation, SourceUrl};

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
  /// The message to log.
  pub message: String,
  /// Name of plugin or file that threw this error.
  pub origin: Option<String>,
  pub code_frames: Vec<CodeFrame>,
  pub hints: Vec<String>,
  pub severity: DiagnosticSeverity,
  #[serde(rename = "documentationURL")]
  pub documentation_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodeFrame {
  pub code: Option<String>,
  pub url: Option<SourceUrl>,
  pub language: Option<AssetType>,
  pub code_highlights: Vec<CodeHighlight>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct CodeHighlight {
  pub message: Option<String>,
  pub start: Location,
  pub end: Location,
}

#[derive(Serialize, Deserialize, Debug, Eq, PartialEq, Clone)]
pub enum DiagnosticSeverity {
  /// Fails the build with an error.
  Error,
  /// Logs a warning, but the build does not fail.
  Warning,
  /// An error if this is source code in the project, or a warning if in node_modules.
  SourceError,
  /// An informative message.
  Info,
}

impl CodeFrame {
  pub fn from_loc(loc: &SourceLocation, message: Option<String>) -> CodeFrame {
    CodeFrame {
      code: None,
      url: Some(loc.url.clone()),
      language: None,
      code_highlights: vec![CodeHighlight::from_loc(loc, message)],
    }
  }
}

impl CodeHighlight {
  pub fn from_loc(loc: &SourceLocation, message: Option<String>) -> CodeHighlight {
    CodeHighlight {
      message,
      start: loc.start.clone(),
      end: Location {
        line: loc.end.line,
        column: loc.end.column - 1,
      },
    }
  }

  pub fn from_json(
    start: json_sourcemap::Location,
    end: json_sourcemap::Location,
    message: Option<&str>,
  ) -> Self {
    CodeHighlight {
      message: message.map(|m| m.to_owned()),
      start: Location {
        line: start.line as u32 + 1,
        column: start.column as u32 + 1,
      },
      end: Location {
        line: end.line as u32 + 1,
        column: end.column as u32,
      },
    }
  }
}

impl std::fmt::Display for Diagnostic {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(&self.message)
  }
}

impl std::error::Error for Diagnostic {}

impl Diagnostic {
  pub fn from_message(message: String) -> Self {
    Diagnostic {
      origin: None,
      message: message,
      code_frames: Vec::new(),
      hints: Vec::new(),
      severity: DiagnosticSeverity::Error,
      documentation_url: None,
    }
  }
}

impl From<std::io::Error> for Diagnostic {
  fn from(value: std::io::Error) -> Self {
    Diagnostic {
      origin: Some("@parcel/core".into()),
      message: value.to_string(),
      code_frames: Vec::new(),
      hints: Vec::new(),
      severity: DiagnosticSeverity::Error,
      documentation_url: None,
    }
  }
}

impl From<std::fmt::Error> for Diagnostic {
  fn from(value: std::fmt::Error) -> Self {
    Diagnostic {
      origin: Some("@parcel/core".into()),
      message: value.to_string(),
      code_frames: Vec::new(),
      hints: Vec::new(),
      severity: DiagnosticSeverity::Error,
      documentation_url: None,
    }
  }
}

impl From<json_sourcemap::Error> for Diagnostic {
  fn from(value: json_sourcemap::Error) -> Self {
    Diagnostic {
      origin: Some("@parcel/core".into()),
      message: value.to_string(),
      code_frames: Vec::new(),
      hints: Vec::new(),
      severity: DiagnosticSeverity::Error,
      documentation_url: None,
    }
  }
}

impl From<std::str::Utf8Error> for Diagnostic {
  fn from(value: std::str::Utf8Error) -> Self {
    Diagnostic {
      origin: Some("@parcel/core".into()),
      message: value.to_string(),
      code_frames: Vec::new(),
      hints: Vec::new(),
      severity: DiagnosticSeverity::Error,
      documentation_url: None,
    }
  }
}

impl From<serde_json::Error> for Diagnostic {
  fn from(value: serde_json::Error) -> Self {
    Diagnostic {
      origin: Some("@parcel/core".into()),
      message: value.to_string(),
      code_frames: Vec::new(),
      hints: Vec::new(),
      severity: DiagnosticSeverity::Error,
      documentation_url: None,
    }
  }
}

impl From<Diagnostic> for Vec<Diagnostic> {
  fn from(value: Diagnostic) -> Self {
    vec![value]
  }
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(transparent)]
pub struct DiagnosticList(pub Vec<Diagnostic>);

impl<T: Into<Diagnostic>> From<T> for DiagnosticList {
  fn from(value: T) -> Self {
    DiagnosticList(vec![value.into()])
  }
}

// pub(crate) struct EscapeMarkdown<'a, T>(pub &'a T);

// fn escape_markdown(s: &str) -> Cow<'_, str> {
//   let mut result = Cow::Borrowed("");
//   let mut start = 0;
//   for (index, matched) in s.match_indices(&['*', '_', '~', '\\']) {
//     result += &s[start..index];
//     result += "\\";
//     result += matched;
//     start = index + 1;
//   }

//   result += &s[start..];
//   result
// }

// impl<'a, T: std::fmt::Debug> std::fmt::Debug for EscapeMarkdown<'a, T> {
//   fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
//     let res = format!("{:?}", self.0);
//     escape_markdown(&res).fmt(f)
//   }
// }

// impl<'a, T: std::fmt::Display> std::fmt::Display for EscapeMarkdown<'a, T> {
//   fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
//     let res = format!("{}", self.0);
//     escape_markdown(&res).fmt(f)
//   }
// }

// macro_rules! format_markdown {
//   ($s: literal, $($arg: expr),+) => {
//     format!($s, $(crate::diagnostic::EscapeMarkdown(&$arg)),+)
//   };
// }

// pub(crate) use format_markdown;

// pub(crate) struct EscapeJSONKeyComponent<'a, T>(pub &'a T);

// fn escape_json_key_component(s: &str) -> Cow<'_, str> {
//   let mut result = Cow::Borrowed("");
//   let mut start = 0;
//   for (index, matched) in s.match_indices(&['~', '/']) {
//     result += &s[start..index];
//     result += match matched {
//       "~" => "~0",
//       "/" => "~1",
//       _ => unreachable!(),
//     };
//     start = index + 1;
//   }

//   result += &s[start..];
//   result
// }

// impl<'a, T: std::fmt::Debug> std::fmt::Debug for EscapeJSONKeyComponent<'a, T> {
//   fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
//     let res = format!("{:?}", self.0);
//     escape_json_key_component(&res).fmt(f)
//   }
// }

// impl<'a, T: std::fmt::Display> std::fmt::Display for EscapeJSONKeyComponent<'a, T> {
//   fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
//     let res = format!("{}", self.0);
//     escape_json_key_component(&res).fmt(f)
//   }
// }

// macro_rules! json_key {
//   ($s: literal, $($arg: expr),+) => {
//     format!($s, $(crate::diagnostic::EscapeJSONKeyComponent(&$arg)),+)
//   };
// }

// pub(crate) use json_key;
//
impl DiagnosticList {
  pub fn report<W: Write>(&self, dest: &mut W) -> std::io::Result<()> {
    for diagnostic in &self.0 {
      writeln!(dest)?;
      diagnostic.report(dest)?;
    }
    Ok(())
  }
}

impl Diagnostic {
  pub fn report<W: Write>(&self, dest: &mut W) -> std::io::Result<()> {
    let style = Style::new()
      .fg_color(Some(Color::Ansi(AnsiColor::Red)))
      .bold();

    writeln!(
      dest,
      "{style}{}: {}{style:#}",
      self
        .origin
        .as_ref()
        .map(|o| o.as_str())
        .unwrap_or("unknown"),
      self.message
    )?;

    if !self.code_frames.is_empty() {
      writeln!(dest)?;
    }

    let mut first = true;
    for frame in &self.code_frames {
      if !first {
        write!(dest, "\n\n")?;
        first = true;
      }
      frame.report(dest)?;
    }

    if !self.hints.is_empty() || self.documentation_url.is_some() {
      write!(dest, "\n\n")?;
    }

    for hint in &self.hints {
      writeln!(dest, "💡 {}", hint)?;
    }

    if let Some(docs) = &self.documentation_url {
      writeln!(dest, "📝 {}", docs.as_str())?;
    }

    Ok(())
  }
}

const PADDING_BEFORE: u32 = 1;
const PADDING_AFTER: u32 = 2;
// const TERMINAL_WIDTH: usize = 80;
const MAX_LINES: u32 = 12;

impl CodeFrame {
  pub fn report<W: Write>(&self, dest: &mut W) -> std::io::Result<()> {
    if let Some(url) = &self.url {
      let style = Style::new()
        .fg_color(Some(Color::Ansi(AnsiColor::BrightBlack)))
        .underline();

      let cwd = Url::from_directory_path(std::env::current_dir().unwrap_or_default()).unwrap();
      let relative = cwd
        .make_relative(url.url())
        .unwrap_or_else(|| url.as_str().to_owned());

      write!(dest, "{style}{}", relative)?;
      if let Some(highlight) = self.code_highlights.first() {
        write!(dest, ":{}:{}", highlight.start.line, highlight.start.column)?;
      }
      write!(dest, "{style:#}\n")?;
    }

    if self.code_highlights.is_empty() {
      return Ok(());
    }

    let first_highlight = self
      .code_highlights
      .iter()
      .min_by_key(|v| v.start.line)
      .unwrap();
    let last_highlight = self
      .code_highlights
      .iter()
      .max_by_key(|v| v.end.line)
      .unwrap();

    let start_line = first_highlight
      .start
      .line
      .saturating_sub(PADDING_BEFORE)
      .max(1);
    let end_line = last_highlight.end.line + PADDING_AFTER;

    if end_line - start_line > MAX_LINES {
      // let max_line = start_line + MAX_LINES - 1;
      // TODO
    }

    let line_number_length = (end_line + 1).to_string().len();
    let code = self.code.clone().unwrap_or_else(|| {
      std::fs::read_to_string(self.url.as_ref().unwrap().to_file_path().unwrap()).unwrap()
    });

    let lines = code
      .lines()
      .skip(start_line as usize - 1)
      .take(end_line as usize - start_line as usize + 1);

    let mut joined = String::new();
    for line in lines {
      joined.push_str(line);
      joined.push('\n');
    }

    let highlighted = highlight(&joined, self.language.clone().unwrap_or(AssetType::Js));
    let mut lines = highlighted.lines();

    let highlight_style = Style::new()
      .fg_color(Some(Color::Ansi(AnsiColor::Red)))
      .bold();

    let mut line_number = start_line;
    while let Some(line) = lines.next() {
      let line_highlights = self
        .code_highlights
        .iter()
        .filter(|h| h.start.line <= line_number && h.end.line >= line_number)
        .collect::<Vec<_>>();

      let is_whole_line = !line_highlights.is_empty()
        && line_highlights
          .iter()
          .any(|h| h.start.line < line_number && h.end.line > line_number);

      // TODO: Split the line into line parts that will fit the provided terminal width

      write!(
        dest,
        "{highlight_style}{}{highlight_style:#} {:width$} | ",
        if !line_highlights.is_empty() {
          ">"
        } else {
          " "
        },
        line_number + 1,
        width = line_number_length
      )?;
      writeln!(dest, "{}", line)?;

      if is_whole_line {
        writeln!(
          dest,
          "{highlight_style}>{highlight_style:#} {} | {highlight_style}{}{highlight_style:#}",
          " ".repeat(line_number_length),
          "^".repeat(line.len())
        )?;
      } else if !line_highlights.is_empty() {
        let mut last_col = 0;
        let mut highlight_has_ended = false;

        write!(
          dest,
          "{highlight_style}>{highlight_style:#} {} | ",
          " ".repeat(line_number_length)
        )?;

        for highlight in &line_highlights {
          let start_col = highlight.start.column.saturating_sub(1) as usize;
          let end_col = highlight.end.column.saturating_sub(1) as usize;

          // TODO: Replace tab with spaces?

          if highlight.end.line == line_number {
            highlight_has_ended = true;
          }

          // If end_col is smaller than last_col it overlaps with another highlight and is no longer visible, we can skip those
          if end_col >= last_col {
            let mut characters = end_col - start_col + 1;
            if start_col > last_col {
              // start_col is before last_col, so add spaces as padding before the highlight indicators
              write!(dest, "{}", " ".repeat(start_col - last_col))?;
            } else if last_col > start_col {
              // If last column is larger than the start, there's overlap in highlights
              // This line adjusts the characters count to ensure we don't add too many characters
              characters += start_col - last_col;
            }

            characters = characters.max(1);
            write!(
              dest,
              "{highlight_style}{}{highlight_style:#}",
              "^".repeat(characters)
            )?;

            last_col = end_col + 1;
          }
        }

        if highlight_has_ended
          && let Some(highlight) = line_highlights.last()
          && let Some(message) = &highlight.message
        {
          write!(dest, " {}", message)?;
        }

        write!(dest, "\n")?;
      }

      line_number += 1;
    }

    Ok(())
  }
}

fn highlight(code: &str, lang: AssetType) -> String {
  use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

  let mut config = match lang {
    AssetType::Js => HighlightConfiguration::new(
      tree_sitter_javascript::LANGUAGE.into(),
      "javascript",
      tree_sitter_javascript::HIGHLIGHT_QUERY,
      tree_sitter_javascript::INJECTIONS_QUERY,
      tree_sitter_javascript::LOCALS_QUERY,
    )
    .unwrap(),
    AssetType::Jsx => {
      let mut highlights = tree_sitter_javascript::JSX_HIGHLIGHT_QUERY.to_owned();
      highlights.push_str(tree_sitter_javascript::HIGHLIGHT_QUERY);
      HighlightConfiguration::new(
        tree_sitter_javascript::LANGUAGE.into(),
        "jsx",
        &highlights,
        tree_sitter_javascript::INJECTIONS_QUERY,
        tree_sitter_javascript::LOCALS_QUERY,
      )
      .unwrap()
    }
    AssetType::Ts => {
      let mut highlights = tree_sitter_typescript::HIGHLIGHTS_QUERY.to_owned();
      highlights.push_str(tree_sitter_javascript::HIGHLIGHT_QUERY);

      let mut locals = tree_sitter_typescript::LOCALS_QUERY.to_owned();
      locals.push_str(tree_sitter_javascript::LOCALS_QUERY);

      HighlightConfiguration::new(
        tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        "typescript",
        &highlights,
        tree_sitter_javascript::INJECTIONS_QUERY,
        &locals,
      )
      .unwrap()
    }
    AssetType::Tsx => {
      let mut highlights = tree_sitter_javascript::JSX_HIGHLIGHT_QUERY.to_owned();
      highlights.push_str(tree_sitter_typescript::HIGHLIGHTS_QUERY);
      highlights.push_str(tree_sitter_javascript::HIGHLIGHT_QUERY);

      let mut locals = tree_sitter_typescript::LOCALS_QUERY.to_owned();
      locals.push_str(tree_sitter_javascript::LOCALS_QUERY);

      HighlightConfiguration::new(
        tree_sitter_typescript::LANGUAGE_TSX.into(),
        "tsx",
        &highlights,
        tree_sitter_javascript::INJECTIONS_QUERY,
        &locals,
      )
      .unwrap()
    }
    AssetType::Css | AssetType::StyleAttribute => HighlightConfiguration::new(
      tree_sitter_css::LANGUAGE.into(),
      "css",
      tree_sitter_css::HIGHLIGHTS_QUERY,
      "",
      "",
    )
    .unwrap(),
    AssetType::Json | AssetType::Jsonld => HighlightConfiguration::new(
      tree_sitter_json::LANGUAGE.into(),
      "json",
      tree_sitter_json::HIGHLIGHTS_QUERY,
      "",
      "",
    )
    .unwrap(),
    AssetType::Html | AssetType::Xhtml | AssetType::Svg => HighlightConfiguration::new(
      tree_sitter_html::LANGUAGE.into(),
      "html",
      tree_sitter_html::HIGHLIGHTS_QUERY,
      "",
      "",
    )
    .unwrap(),
    _ => return code.to_string(),
  };

  config.configure(&[
    "attribute",
    "comment",
    "constant",
    "constant.builtin",
    "constructor",
    "function",
    "function.builtin",
    "keyword",
    "module",
    "number",
    "boolean",
    "operator",
    "title",
    "label",
    "name",
    "property",
    "property.builtin",
    "punctuation",
    "string",
    "string.special",
    "tag",
    "type",
    "type.builtin",
    "variable",
    "variable.builtin",
    "variable.parameter",
  ]);

  macro_rules! style {
    ($color: literal) => {
      Style::new().fg_color(Some(Color::Ansi256(Ansi256Color($color))))
    };
    ($color: literal, italic) => {
      Style::new()
        .fg_color(Some(Color::Ansi256(Ansi256Color($color))))
        .italic()
    };
    ($color: literal, bold) => {
      Style::new()
        .fg_color(Some(Color::Ansi256(Ansi256Color($color))))
        .bold()
    };
    ($color: literal, underline) => {
      Style::new()
        .fg_color(Some(Color::Ansi256(Ansi256Color($color))))
        .underline()
    };
  }

  let styles = &[
    style!(124, italic),    // attribute
    style!(245, italic),    // comment
    style!(94),             // constant
    style!(94, bold),       // constant.builtin
    style!(136),            // constructor
    style!(26),             // function
    style!(26, bold),       // function.builtin
    style!(202),            // keyword
    style!(136),            // module
    style!(94, bold),       // number
    style!(94, bold),       // boolean
    style!(239, bold),      // operator
    style!(124),            // title
    style!(124),            // label
    style!(124),            // name
    style!(124),            // property
    style!(124, bold),      // property.builtin
    style!(239),            // punctuation
    style!(28),             // string
    style!(30),             // string.special
    style!(18),             // tag
    style!(23),             // type
    style!(23, bold),       // type.builtin
    style!(252),            // variable
    style!(252, bold),      // variable.builtin
    style!(252, underline), // variable.parameter
  ];

  let mut highlighter = Highlighter::new();
  let highlights = highlighter
    .highlight(&config, code.as_bytes(), None, |_lang| None)
    .unwrap();

  let mut res = String::new();
  let mut style_stack = vec![Style::default()];
  for event in highlights {
    match event {
      Ok(HighlightEvent::HighlightStart(highlight)) => style_stack.push(styles[highlight.0]),
      Ok(HighlightEvent::HighlightEnd) => {
        style_stack.pop();
      }
      Ok(HighlightEvent::Source { start, end }) => {
        use std::fmt::Write;
        let style = style_stack.last().unwrap();
        write!(&mut res, "{style}{}{style:#}", &code[start..end]).unwrap();
      }
      Err(_) => {}
    }
  }

  res
}
