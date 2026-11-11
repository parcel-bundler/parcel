//! Text built from pieces, so that large pieces (e.g. each module's code in a bundle) are written
//! out without first being copied into one buffer.

use std::{borrow::Cow, ops::Range, sync::Arc};

use xxhash_rust::xxh3::Xxh3;

use crate::{
  Content, ContentType, Diagnostic, FileSystem, PathId, content::source_mapping_url_comment,
  content_type,
};

/// Text made of pieces: small writes are appended to an arena, and larger text is referenced
/// (`Arc<str>`) or moved in rather than copied.
#[derive(Default, Debug, Clone)]
pub struct ChunkedText {
  pieces: Vec<Piece>,
  /// The text of `Piece::Arena`s.
  arena: String,
  len: usize,
}

#[derive(Debug, Clone)]
enum Piece {
  Arena(Range<usize>),
  Shared(Arc<str>, Range<usize>),
  Owned(Box<str>),
}

/// Text shorter than this is copied into the arena, where a piece would cost more than the copy.
const MIN_PIECE_LEN: usize = 256;

impl ChunkedText {
  pub fn new() -> Self {
    Self::default()
  }

  pub fn len(&self) -> usize {
    self.len
  }

  pub fn is_empty(&self) -> bool {
    self.len == 0
  }

  /// Appends a copy of `text`.
  pub fn push_str(&mut self, text: &str) {
    if text.is_empty() {
      return;
    }
    let start = self.arena.len();
    self.arena.push_str(text);
    self.len += text.len();
    match self.pieces.last_mut() {
      Some(Piece::Arena(range)) if range.end == start => range.end = self.arena.len(),
      _ => self.pieces.push(Piece::Arena(start..self.arena.len())),
    }
  }

  /// Appends `text[range]`, referencing `text` rather than copying it.
  pub fn push_shared(&mut self, text: &Arc<str>, range: Range<usize>) {
    if range.len() < MIN_PIECE_LEN {
      self.push_str(&text[range]);
      return;
    }
    self.len += range.len();
    self.pieces.push(Piece::Shared(text.clone(), range));
  }

  /// Appends `text`, moving it rather than copying it.
  pub fn push_owned(&mut self, text: String) {
    if text.len() < MIN_PIECE_LEN {
      self.push_str(&text);
      return;
    }
    self.len += text.len();
    self.pieces.push(Piece::Owned(text.into_boxed_str()));
  }

  /// The pieces, in order.
  pub fn chunks(&self) -> impl Iterator<Item = &str> {
    self.pieces.iter().map(|piece| match piece {
      Piece::Arena(range) => &self.arena[range.clone()],
      Piece::Shared(text, range) => &text[range.clone()],
      Piece::Owned(text) => &**text,
    })
  }

  pub fn to_string(&self) -> String {
    let mut out = String::with_capacity(self.len);
    for chunk in self.chunks() {
      out.push_str(chunk);
    }
    out
  }

  /// The last `len` bytes or fewer, possibly cut in the middle of a character.
  fn tail(&self, len: usize) -> Vec<u8> {
    let mut chunks: Vec<&[u8]> = Vec::new();
    let mut remaining = len;
    for chunk in self.pieces.iter().rev().map(|piece| match piece {
      Piece::Arena(range) => &self.arena.as_bytes()[range.clone()],
      Piece::Shared(text, range) => &text.as_bytes()[range.clone()],
      Piece::Owned(text) => text.as_bytes(),
    }) {
      if remaining == 0 {
        break;
      }
      let take = chunk.len().min(remaining);
      chunks.push(&chunk[chunk.len() - take..]);
      remaining -= take;
    }
    chunks.reverse();
    chunks.concat()
  }

  fn hash_into(&self, hasher: &mut Xxh3) {
    for chunk in self.chunks() {
      hasher.update(chunk.as_bytes());
    }
  }
}

/// Code and its source map, written without concatenating their pieces.
#[derive(Debug)]
pub struct ChunkedTextContent {
  code: ChunkedText,
  map: Option<ChunkedText>,
}

impl ChunkedTextContent {
  pub fn new(code: ChunkedText, map: Option<ChunkedText>) -> Self {
    ChunkedTextContent { code, map }
  }
}

impl Content for ChunkedTextContent {
  fn estimate_size(&self) -> Result<usize, Diagnostic> {
    Ok(self.code.len())
  }

  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(self.code.to_string().into_bytes())
  }

  fn read_string(&self) -> Result<Cow<'_, str>, Diagnostic> {
    Ok(Cow::Owned(self.code.to_string()))
  }

  fn content_hash(&self) -> Result<u128, Diagnostic> {
    // The same as `ContentWithSourceMap` with the same code and map.
    let mut hasher = Xxh3::new();
    match &self.map {
      Some(map) => {
        hasher.update(&(self.code.len() as u64).to_le_bytes());
        self.code.hash_into(&mut hasher);
        map.hash_into(&mut hasher);
      }
      None => self.code.hash_into(&mut hasher),
    }
    Ok(hasher.digest128())
  }

  fn write(&self, fs: &dyn FileSystem, path: PathId) -> Result<(), Diagnostic> {
    let mut chunks: Vec<&[u8]> = self.code.chunks().map(str::as_bytes).collect();
    let Some(map) = &self.map else {
      return Ok(fs.write_vectored(path, &chunks)?);
    };
    let map_path = path.add_extension("map");
    let comment = source_mapping_url_comment(path, map_path, &self.code.tail(4096));
    if let Some(comment) = &comment {
      chunks.push(comment.as_bytes());
    }
    fs.write_vectored(path, &chunks)?;
    let map_chunks: Vec<&[u8]> = map.chunks().map(str::as_bytes).collect();
    fs.write_vectored(map_path, &map_chunks)?;
    Ok(())
  }

  fn ty(&self) -> ContentType {
    content_type!("ChunkedTextContent")
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::{BufferContent, ContentWithSourceMap, MemoryFileSystem};

  fn text(parts: &[&str]) -> ChunkedText {
    let mut text = ChunkedText::new();
    for (index, part) in parts.iter().enumerate() {
      match index % 3 {
        0 => text.push_str(part),
        1 => text.push_shared(&Arc::from(format!("--{part}--")), 2..2 + part.len()),
        _ => text.push_owned(part.to_string()),
      }
    }
    text
  }

  #[test]
  fn pieces_concatenate_in_order() {
    let long = "x".repeat(1000);
    let text = text(&["a", &long, "b", "c", "d", &long, "e"]);
    let expected = format!("a{long}bcd{long}e");
    assert_eq!(text.to_string(), expected);
    assert_eq!(text.len(), expected.len());
    // Spans the last two pieces.
    assert_eq!(text.tail(3), b"xxe");
    assert_eq!(text.tail(1 << 20), expected.as_bytes());
  }

  #[test]
  fn content_matches_contiguous_content() {
    let long = "y".repeat(5000);
    let code = text(&["var a = 1;\n", &long, "\n", "b();\n"]);
    let map = text(&["{\"version\":3", &long, "}"]);
    let contiguous =
      ContentWithSourceMap::new_string(code.to_string(), map.to_string().into_bytes());
    let content = ChunkedTextContent::new(code.clone(), Some(map.clone()));
    assert_eq!(
      content.content_hash().unwrap(),
      contiguous.content_hash().unwrap()
    );
    assert_eq!(
      ChunkedTextContent::new(code.clone(), None)
        .content_hash()
        .unwrap(),
      BufferContent::new_string(code.to_string())
        .content_hash()
        .unwrap()
    );

    let fs = MemoryFileSystem::new();
    fs.mkdir(std::path::Path::new("/dist")).unwrap();
    let a = PathId::new(std::path::Path::new("/dist/a.js"));
    let b = PathId::new(std::path::Path::new("/dist/b.js"));
    content.write(&fs, a).unwrap();
    contiguous.write(&fs, b).unwrap();
    let written = fs.read(a).unwrap();
    assert_eq!(
      String::from_utf8(written).unwrap(),
      String::from_utf8(fs.read(b).unwrap())
        .unwrap()
        .replace("b.js.map", "a.js.map")
    );
    assert_eq!(
      fs.read(a.add_extension("map")).unwrap(),
      map.to_string().into_bytes()
    );
  }
}
