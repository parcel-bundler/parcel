use std::{borrow::Cow, io::Write, string::FromUtf8Error};

use anstyle::{Ansi256Color, AnsiColor, Color, Style};
use serde::{Deserialize, Serialize};

use crate::{AssetType, Location, PathId, SourceLocation, SourceUrl};

#[derive(Serialize, Deserialize, Debug, PartialEq, Hash, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
  /// The message to log.
  pub message: String,
  /// Name of plugin or file that threw this error.
  pub origin: Option<String>,
  #[serde(default)]
  pub code_frames: Vec<CodeFrame>,
  #[serde(default)]
  pub hints: Vec<String>,
  #[serde(default)]
  pub severity: DiagnosticSeverity,
  #[serde(rename = "documentationURL")]
  pub documentation_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Hash, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeFrame {
  pub code: Option<String>,
  pub url: Option<SourceUrl>,
  pub language: Option<AssetType>,
  pub code_highlights: Vec<CodeHighlight>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Hash, Clone, Default)]
pub struct CodeHighlight {
  pub message: Option<String>,
  #[serde(default)]
  pub start: Location,
  #[serde(default)]
  pub end: Location,
}

#[derive(Serialize, Deserialize, Debug, Eq, PartialEq, Hash, Clone, Default)]
pub enum DiagnosticSeverity {
  /// Fails the build with an error.
  #[default]
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
        column: loc.end.column.saturating_sub(1),
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

impl From<FromUtf8Error> for Diagnostic {
  fn from(value: FromUtf8Error) -> Self {
    Diagnostic::from_message(format!("UTF8 error: {}", value.to_string()))
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

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct RenderedDiagnostics {
  pub ansi: Vec<RenderedAnsiDiagnostic>,
  pub html: Vec<RenderedHtmlDiagnostic>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct RenderedAnsiDiagnostic {
  pub message: String,
  pub codeframe: Option<String>,
  pub stack: Option<String>,
  pub hints: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct RenderedHtmlDiagnostic {
  pub message: String,
  pub stack: Option<String>,
  pub frames: Vec<RenderedHtmlFrame>,
  pub hints: Vec<String>,
  pub documentation: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct RenderedHtmlFrame {
  pub location: String,
  pub code: String,
}

impl<T: Into<Diagnostic>> From<T> for DiagnosticList {
  fn from(value: T) -> Self {
    DiagnosticList(vec![value.into()])
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JsonSourceLocationType {
  Key,
  Value,
  KeyAndValue,
}

/// Returns the source range for a JSON pointer.
///
/// Locations returned by `json_sourcemap` are zero-based with an exclusive end. They can be
/// converted to a diagnostic highlight with [`CodeHighlight::from_json`].
pub fn json_source_location(
  code: &str,
  pointer: &str,
  location_type: JsonSourceLocationType,
) -> Result<Option<(json_sourcemap::Location, json_sourcemap::Location)>, json_sourcemap::Error> {
  use json_sourcemap::Prop;

  let source_map = json_sourcemap::parse(code, json_sourcemap::Options::default())?;
  let Some(location) = source_map.get_location(pointer) else {
    return Ok(None);
  };

  let range = match location_type {
    JsonSourceLocationType::Key => location.get(Prop::Key).zip(location.get(Prop::KeyEnd)),
    JsonSourceLocationType::Value => location.get(Prop::Value).zip(location.get(Prop::ValueEnd)),
    JsonSourceLocationType::KeyAndValue => location
      .get(Prop::Key)
      .or_else(|| location.get(Prop::Value))
      .zip(location.get(Prop::ValueEnd)),
  };

  Ok(range)
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

  pub fn render_for_browser(&self) -> RenderedDiagnostics {
    RenderedDiagnostics {
      ansi: self.0.iter().map(Diagnostic::render_ansi).collect(),
      html: self.0.iter().map(Diagnostic::render_html).collect(),
    }
  }
}

impl Diagnostic {
  fn render_ansi(&self) -> RenderedAnsiDiagnostic {
    let mut codeframe = Vec::new();
    for (index, frame) in self.code_frames.iter().enumerate() {
      if index > 0 {
        write!(&mut codeframe, "\n\n").unwrap();
      }
      frame.report(&mut codeframe).unwrap();
    }

    RenderedAnsiDiagnostic {
      message: self.message.clone(),
      codeframe: if codeframe.is_empty() {
        None
      } else {
        Some(String::from_utf8(codeframe).unwrap())
      },
      stack: None,
      hints: self.hints.clone(),
    }
  }

  fn render_html(&self) -> RenderedHtmlDiagnostic {
    RenderedHtmlDiagnostic {
      message: escape_html(&self.message).into_owned(),
      stack: None,
      frames: self
        .code_frames
        .iter()
        .map(CodeFrame::render_html)
        .collect(),
      hints: self
        .hints
        .iter()
        .map(|hint| escape_html(hint).into_owned())
        .collect(),
      documentation: self
        .documentation_url
        .as_ref()
        .map(|url| escape_html(url).into_owned()),
    }
  }

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
  fn render_html(&self) -> RenderedHtmlFrame {
    RenderedHtmlFrame {
      location: escape_html(&self.location()).into_owned(),
      code: self.render_code(&HtmlRenderer),
    }
  }

  fn location(&self) -> String {
    let mut location = String::new();
    if let Some(url) = &self.url {
      let cwd = PathId::new(&std::env::current_dir().unwrap_or_default());
      let relative = url.to_file_path().unwrap().relative(&cwd);
      location.push_str(&relative.to_string_lossy());
      if let Some(highlight) = self.code_highlights.first() {
        use std::fmt::Write;
        write!(
          &mut location,
          ":{}:{}",
          highlight.start.line, highlight.start.column
        )
        .unwrap();
      }
    }

    location
  }

  fn line_window(&self) -> Option<(u32, u32)> {
    if self.code_highlights.is_empty() {
      return None;
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

    Some((start_line, end_line))
  }

  fn code(&self) -> Option<String> {
    if let Some(code) = &self.code {
      return Some(code.clone());
    }

    Some(std::fs::read_to_string(self.url.as_ref()?.to_file_path().ok()?.to_path_buf()).ok()?)
  }

  fn render_code<R: CodeFrameRenderer>(&self, renderer: &R) -> String {
    let Some((start_line, end_line)) = self.line_window() else {
      return String::new();
    };

    let line_number_length = (end_line + 1).to_string().len();
    let Some(code) = self.code() else {
      return String::new();
    };

    let lines = code
      .lines()
      .skip(start_line as usize - 1)
      .take(end_line as usize - start_line as usize + 1);

    let mut res = String::new();
    for (line_offset, line) in lines.enumerate() {
      let line_number = start_line + line_offset as u32;
      let line_highlights = self
        .code_highlights
        .iter()
        .filter(|h| h.start.line <= line_number && h.end.line >= line_number)
        .collect::<Vec<_>>();

      let is_whole_line = !line_highlights.is_empty()
        && line_highlights
          .iter()
          .any(|h| h.start.line < line_number && h.end.line > line_number);

      use std::fmt::Write;
      write!(
        &mut res,
        "{} {:width$} | {}\n",
        renderer.error(if !line_highlights.is_empty() {
          ">"
        } else {
          " "
        }),
        line_number + 1,
        render_highlighted(
          line,
          self.language.clone().unwrap_or(AssetType::Js),
          renderer
        ),
        width = line_number_length
      )
      .unwrap();

      if is_whole_line {
        writeln!(
          &mut res,
          "{} {} | {}",
          renderer.error(">"),
          " ".repeat(line_number_length),
          renderer.error(&"^".repeat(line.chars().count()))
        )
        .unwrap();
      } else if !line_highlights.is_empty() {
        let mut last_col = 0;
        let mut highlight_has_ended = false;

        write!(
          &mut res,
          "{} {} | ",
          renderer.error(">"),
          " ".repeat(line_number_length)
        )
        .unwrap();

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
              write!(&mut res, "{}", " ".repeat(start_col - last_col)).unwrap();
            } else if last_col > start_col {
              // If last column is larger than the start, there's overlap in highlights
              // This line adjusts the characters count to ensure we don't add too many characters
              characters += start_col - last_col;
            }

            characters = characters.max(1);
            write!(&mut res, "{}", renderer.error(&"^".repeat(characters))).unwrap();

            last_col = end_col + 1;
          }
        }

        if highlight_has_ended
          && let Some(highlight) = line_highlights.last()
          && let Some(message) = &highlight.message
        {
          write!(&mut res, " {}", renderer.plain(message)).unwrap();
        }

        res.push('\n');
      }
    }

    res
  }

  pub fn report<W: Write>(&self, dest: &mut W) -> std::io::Result<()> {
    if let Some(url) = &self.url {
      let style = Style::new()
        .fg_color(Some(Color::Ansi(AnsiColor::BrightBlack)))
        .underline();

      let cwd = PathId::new(&std::env::current_dir().unwrap_or_default());
      let relative = url.to_file_path().unwrap().relative(&cwd);

      write!(dest, "{style}{}", relative.to_string_lossy())?;
      if let Some(highlight) = self.code_highlights.first() {
        write!(dest, ":{}:{}", highlight.start.line, highlight.start.column)?;
      }
      write!(dest, "{style:#}\n")?;
    }

    write!(dest, "{}", self.render_code(&AnsiRenderer))?;

    Ok(())
  }
}

#[derive(Clone, Copy)]
struct SyntaxStyle {
  ansi_color: u8,
  html_color: &'static str,
  bold: bool,
  italic: bool,
  underline: bool,
}

impl SyntaxStyle {
  fn ansi(self) -> Style {
    let mut style = Style::new().fg_color(Some(Color::Ansi256(Ansi256Color(self.ansi_color))));
    if self.bold {
      style = style.bold();
    }
    if self.italic {
      style = style.italic();
    }
    if self.underline {
      style = style.underline();
    }
    style
  }

  fn ansi_open(self) -> String {
    self.ansi().to_string()
  }

  fn ansi_close(self) -> String {
    format!("{:#}", self.ansi())
  }

  fn html_style(self) -> String {
    let mut style = format!("color:{}", self.html_color);
    if self.bold {
      style.push_str(";font-weight:700");
    }
    if self.italic {
      style.push_str(";font-style:italic");
    }
    if self.underline {
      style.push_str(";text-decoration:underline");
    }
    style
  }

  fn html_open(self) -> String {
    format!("<span style=\"{}\">", self.html_style())
  }

  fn html_close(self) -> &'static str {
    "</span>"
  }
}

struct HighlightToken<'a> {
  style: Option<usize>,
  text: &'a str,
}


macro_rules! syntax_style {
  ($ansi: literal, $html: literal) => {
    SyntaxStyle {
      ansi_color: $ansi,
      html_color: $html,
      bold: false,
      italic: false,
      underline: false,
    }
  };
  ($ansi: literal, $html: literal, italic) => {
    SyntaxStyle {
      ansi_color: $ansi,
      html_color: $html,
      bold: false,
      italic: true,
      underline: false,
    }
  };
  ($ansi: literal, $html: literal, bold) => {
    SyntaxStyle {
      ansi_color: $ansi,
      html_color: $html,
      bold: true,
      italic: false,
      underline: false,
    }
  };
  ($ansi: literal, $html: literal, underline) => {
    SyntaxStyle {
      ansi_color: $ansi,
      html_color: $html,
      bold: false,
      italic: false,
      underline: true,
    }
  };
}

const HIGHLIGHT_STYLES: &[SyntaxStyle] = &[
  syntax_style!(124, "#dc2626", italic),    // attribute
  syntax_style!(245, "#a1a1aa", italic),    // comment
  syntax_style!(94, "#a16207"),             // constant
  syntax_style!(94, "#a16207", bold),       // constant.builtin
  syntax_style!(136, "#ca8a04"),            // constructor
  syntax_style!(26, "#2563eb"),             // function
  syntax_style!(26, "#2563eb", bold),       // function.builtin
  syntax_style!(202, "#ea580c"),            // keyword
  syntax_style!(136, "#ca8a04"),            // module
  syntax_style!(94, "#a16207", bold),       // number
  syntax_style!(94, "#a16207", bold),       // boolean
  syntax_style!(239, "#71717a", bold),      // operator
  syntax_style!(124, "#dc2626"),            // title
  syntax_style!(124, "#dc2626"),            // label
  syntax_style!(124, "#dc2626"),            // name
  syntax_style!(124, "#dc2626"),            // property
  syntax_style!(124, "#dc2626", bold),      // property.builtin
  syntax_style!(239, "#71717a"),            // punctuation
  syntax_style!(28, "#16a34a"),             // string
  syntax_style!(30, "#0d9488"),             // string.special
  syntax_style!(18, "#1e40af"),             // tag
  syntax_style!(23, "#0f766e"),             // type
  syntax_style!(23, "#0f766e", bold),       // type.builtin
  syntax_style!(252, "#e4e4e7"),            // variable
  syntax_style!(252, "#e4e4e7", bold),      // variable.builtin
  syntax_style!(252, "#e4e4e7", underline), // variable.parameter
];

trait CodeFrameRenderer {
  fn plain(&self, text: &str) -> String;
  fn error(&self, text: &str) -> String;
  fn syntax(&self, style: SyntaxStyle, text: &str) -> String;
}

struct AnsiRenderer;
struct HtmlRenderer;

impl CodeFrameRenderer for AnsiRenderer {
  fn plain(&self, text: &str) -> String {
    text.to_string()
  }

  fn error(&self, text: &str) -> String {
    let style = Style::new()
      .fg_color(Some(Color::Ansi(AnsiColor::Red)))
      .bold();
    format!("{style}{text}{style:#}")
  }

  fn syntax(&self, style: SyntaxStyle, text: &str) -> String {
    format!("{}{}{}", style.ansi_open(), text, style.ansi_close())
  }
}

impl CodeFrameRenderer for HtmlRenderer {
  fn plain(&self, text: &str) -> String {
    escape_html(text).into_owned()
  }

  fn error(&self, text: &str) -> String {
    format!(
      "<span style=\"color:#f87171;font-weight:700\">{}</span>",
      escape_html(text)
    )
  }

  fn syntax(&self, style: SyntaxStyle, text: &str) -> String {
    format!(
      "{}{}{}",
      style.html_open(),
      escape_html(text),
      style.html_close()
    )
  }
}

fn render_highlighted<R: CodeFrameRenderer>(code: &str, lang: AssetType, renderer: &R) -> String {
  let tokens = highlight_tokens(code, lang);
  let mut res = String::new();
  for token in tokens {
    if let Some(style) = token.style {
      res.push_str(&renderer.syntax(HIGHLIGHT_STYLES[style], token.text));
    } else {
      res.push_str(&renderer.plain(token.text));
    }
  }
  res
}

fn highlight_tokens(code: &str, lang: AssetType) -> Vec<HighlightToken<'_>> {
  use parcel_highlight::Language;

  let language = match lang {
    AssetType::Js => Language::Js,
    AssetType::Jsx => Language::Jsx,
    AssetType::Ts => Language::Ts,
    AssetType::Tsx => Language::Tsx,
    AssetType::Css => Language::Css,
    AssetType::StyleAttribute => Language::CssDeclarations,
    AssetType::Json | AssetType::Jsonld => Language::Json,
    AssetType::Html | AssetType::Xhtml | AssetType::Svg => Language::Html,
    _ => {
      return vec![HighlightToken {
        style: None,
        text: code,
      }];
    }
  };

  let mut tokens = Vec::new();
  let mut pos = 0;
  for span in parcel_highlight::highlight(code, language) {
    if span.start > pos {
      tokens.push(HighlightToken {
        style: None,
        text: &code[pos..span.start],
      });
    }
    tokens.push(HighlightToken {
      style: Some(class_style(span.class)),
      text: &code[span.start..span.end],
    });
    pos = span.end;
  }
  if pos < code.len() {
    tokens.push(HighlightToken {
      style: None,
      text: &code[pos..],
    });
  }
  tokens
}

/// Index into [`HIGHLIGHT_STYLES`] for each highlight class.
fn class_style(class: parcel_highlight::Class) -> usize {
  use parcel_highlight::Class;
  match class {
    Class::Attribute => 0,
    Class::Comment => 1,
    Class::CapsConst => 2,
    Class::Constructor => 4,
    Class::Function => 5,
    Class::Keyword => 7,
    Class::Number => 9,
    Class::Constant => 10,
    Class::Operator => 11,
    Class::Property => 15,
    Class::Punctuation => 17,
    Class::String => 18,
    Class::Regex => 19,
    Class::Tag => 20,
  }
}

fn escape_html(value: &str) -> Cow<'_, str> {
  if !value
    .as_bytes()
    .iter()
    .any(|b| matches!(b, b'&' | b'<' | b'>' | b'"' | b'\''))
  {
    return Cow::Borrowed(value);
  }

  let mut result = String::with_capacity(value.len());
  for ch in value.chars() {
    match ch {
      '&' => result.push_str("&amp;"),
      '<' => result.push_str("&lt;"),
      '>' => result.push_str("&gt;"),
      '"' => result.push_str("&quot;"),
      '\'' => result.push_str("&#39;"),
      _ => result.push(ch),
    }
  }

  Cow::Owned(result)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn highlights_code_frames() {
    let html = render_highlighted("const x = 1;", AssetType::Js, &HtmlRenderer);
    assert!(html.contains(">const</span>"), "{html}");
    assert!(html.contains("#ea580c"), "{html}");

    // Broken code (the usual code frame subject) keeps highlighting: the
    // unterminated string stops at end of line and the next line still styles.
    let html = render_highlighted("const s = 'oops\nreturn 1;", AssetType::Js, &HtmlRenderer);
    assert!(html.contains(">&#39;oops</span>"), "{html}");
    assert!(html.contains(">return</span>"), "{html}");

    // Unhighlighted languages pass through unstyled.
    let plain = render_highlighted("a = 1", AssetType::Toml, &HtmlRenderer);
    assert_eq!(plain, "a = 1");
  }

  #[test]
  fn gets_json_source_locations() {
    let code = r#"{
  "a": 1
}"#;

    let key = json_source_location(code, "/a", JsonSourceLocationType::Key)
      .unwrap()
      .unwrap();
    let value = json_source_location(code, "/a", JsonSourceLocationType::Value)
      .unwrap()
      .unwrap();
    let key_and_value = json_source_location(code, "/a", JsonSourceLocationType::KeyAndValue)
      .unwrap()
      .unwrap();

    assert_eq!(
      CodeHighlight::from_json(key.0, key.1, Some("key")),
      CodeHighlight {
        message: Some("key".into()),
        start: Location { line: 2, column: 3 },
        end: Location { line: 2, column: 5 },
      }
    );
    assert_eq!(
      CodeHighlight::from_json(value.0, value.1, Some("value")),
      CodeHighlight {
        message: Some("value".into()),
        start: Location { line: 2, column: 8 },
        end: Location { line: 2, column: 8 },
      }
    );
    assert_eq!(
      CodeHighlight::from_json(key_and_value.0, key_and_value.1, None),
      CodeHighlight {
        message: None,
        start: Location { line: 2, column: 3 },
        end: Location { line: 2, column: 8 },
      }
    );
  }

  #[test]
  fn returns_none_for_missing_json_pointer() {
    assert_eq!(
      json_source_location("{}", "/missing", JsonSourceLocationType::Value).unwrap(),
      None
    );
  }

  #[test]
  fn renders_browser_diagnostics_with_escaped_html_codeframes() {
    let diagnostics = DiagnosticList(vec![Diagnostic {
      message: "Unexpected <token>".into(),
      origin: Some("test".into()),
      code_frames: vec![CodeFrame {
        code: Some("let value = foo < bar;\n".into()),
        url: None,
        language: Some(AssetType::Js),
        code_highlights: vec![CodeHighlight {
          message: Some("escape <this>".into()),
          start: Location {
            line: 1,
            column: 13,
          },
          end: Location {
            line: 1,
            column: 15,
          },
        }],
      }],
      hints: vec!["Use > instead".into()],
      severity: DiagnosticSeverity::Error,
      documentation_url: Some("https://example.com?a=<b>".into()),
    }]);

    let rendered = diagnostics.render_for_browser();
    assert_eq!(rendered.html[0].message, "Unexpected &lt;token&gt;");
    assert_eq!(rendered.html[0].hints, vec!["Use &gt; instead"]);
    assert_eq!(
      rendered.html[0].documentation,
      Some("https://example.com?a=&lt;b&gt;".into())
    );
    assert!(rendered.html[0].frames[0].code.contains("foo"));
    assert!(rendered.html[0].frames[0].code.contains("&lt;"));
    assert!(rendered.html[0].frames[0].code.contains("bar"));
    assert!(
      rendered.html[0].frames[0]
        .code
        .contains("escape &lt;this&gt;")
    );
    assert!(rendered.ansi[0].codeframe.is_some());
  }
}
