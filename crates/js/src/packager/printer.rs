use std::{
  fmt::{self, Write},
  sync::Arc,
};

use parcel_core::*;
use serde::Serialize;
use serde_json::value::RawValue;

/// Accumulates the bundle output, tracking the current line/column so that each
/// module's source map can be recorded as a section of an index map.
pub(super) struct Printer {
  output: String,
  line: u32,
  column: u32,
  source_map_sections: Option<Vec<SourceMapSection>>,
  should_optimize: bool,
}

impl Printer {
  pub(super) fn new(source_maps: bool, should_optimize: bool) -> Self {
    Printer {
      output: String::new(),
      line: 0,
      column: 0,
      source_map_sections: source_maps.then(Vec::new),
      should_optimize,
    }
  }

  pub(super) fn add_source_map(&mut self, map: Option<String>) -> Result<(), DiagnosticList> {
    if let Some(source_map_sections) = &mut self.source_map_sections
      && let Some(map) = map
    {
      source_map_sections.push(SourceMapSection::new(self.line, self.column, map)?);
    }

    Ok(())
  }

  #[inline]
  pub(super) fn write_module_header(&mut self, id: String) -> std::fmt::Result {
    if self.should_optimize {
      write!(self, "'{}':", id)
    } else {
      writeln!(self, "'{}':[function(module,exports,require) {{", id)
    }
  }

  #[inline]
  pub(super) fn write_module_trailer(&mut self, deps: String) -> std::fmt::Result {
    write!(self, "\n}}, {}]", deps)
  }

  #[inline]
  pub(super) fn write_expression_code(&mut self, code: &[u8]) -> std::io::Result<()> {
    let mut end = code.len();
    while end > 0 && code[end - 1].is_ascii_whitespace() {
      end -= 1;
    }

    if end > 0 && code[end - 1] == b';' {
      std::io::Write::write_all(self, &code[..end - 1])?;
      std::io::Write::write_all(self, &code[end..])
    } else {
      std::io::Write::write_all(self, code)
    }
  }

  #[inline]
  pub(super) fn newline(&mut self) -> std::fmt::Result {
    if !self.should_optimize {
      writeln!(self)
    } else {
      Ok(())
    }
  }

  #[inline]
  pub(super) fn write_var(&mut self, name: &str, value: &str, semi: bool) -> std::fmt::Result {
    if self.should_optimize {
      write!(self, "var {name}={value}")?;
    } else {
      write!(self, "var {name} = {value}")?;
    }
    if semi {
      self.write_char(';')?;
    }
    self.newline()
  }

  pub(super) fn into_content(self) -> Result<Arc<dyn Content>, DiagnosticList> {
    if let Some(sections) = self.source_map_sections
      && !sections.is_empty()
    {
      let map = serde_json::to_vec(&SourceMapIndex {
        version: 3,
        sections,
      })?;
      Ok(Arc::new(ContentWithSourceMap::new(
        self.output.into_bytes(),
        map,
      )))
    } else {
      Ok(Arc::new(BufferContent::new(self.output.into_bytes())))
    }
  }
}

impl std::fmt::Write for Printer {
  fn write_str(&mut self, s: &str) -> fmt::Result {
    if self.source_map_sections.is_some() {
      update_position(s, &mut self.line, &mut self.column);
    }
    self.output.push_str(s);
    Ok(())
  }
}

impl std::io::Write for Printer {
  fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
    let s = std::str::from_utf8(buf).map_err(std::io::Error::other)?;
    if self.source_map_sections.is_some() {
      update_position(s, &mut self.line, &mut self.column);
    }
    self.output.push_str(s);
    Ok(buf.len())
  }

  fn flush(&mut self) -> std::io::Result<()> {
    Ok(())
  }
}

fn update_position(s: &str, line: &mut u32, column: &mut u32) {
  for segment in s.split_inclusive('\n') {
    if segment.ends_with('\n') {
      *line += 1;
      *column = 0;
    } else {
      *column += segment.len() as u32;
    }
  }
}

#[derive(Serialize)]
struct SourceMapIndex {
  version: u8,
  sections: Vec<SourceMapSection>,
}

#[derive(Serialize)]
struct SourceMapSection {
  offset: SourceMapSectionOffset,
  map: Box<RawValue>,
}

impl SourceMapSection {
  fn new(line: u32, column: u32, map: String) -> Result<Self, DiagnosticList> {
    Ok(SourceMapSection {
      offset: SourceMapSectionOffset { line, column },
      map: RawValue::from_string(map)?,
    })
  }
}

#[derive(Serialize)]
struct SourceMapSectionOffset {
  line: u32,
  column: u32,
}
