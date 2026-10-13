//! The bundle size report printed after production builds, ported from Parcel 2's `bundleReport`
//! and `generateBuildMetrics`.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::Path;

use anstyle::{AnsiColor, Color, Effects, Style};
use parcel_core::{Bundle, BundleBehavior, BundleGraph, ParcelOptions, PathId};
use parcel_sourcemap::SourceMap;
use rayon::prelude::*;
use unicode_width::UnicodeWidthStr;

const LARGE_BUNDLE_SIZE: u64 = 1024 * 1024;

pub struct BundleStats {
  pub path: PathId,
  pub size: u64,
  /// The gzipped size, if requested.
  pub gzip_size: Option<u64>,
  /// Largest first.
  pub assets: Vec<AssetStats>,
}

pub struct AssetStats {
  /// `None` for code the source map doesn't attribute to a source file.
  pub path: Option<PathId>,
  pub size: u64,
}

/// Sizes of the written bundles, largest first, and of the assets in each. Asset sizes are
/// measured in the written bundle through its source map when it has one, and are the sizes of the
/// transformed assets otherwise. With `gzip`, bundles' gzipped sizes are measured too.
pub fn generate_build_metrics(
  bundle_graph: &BundleGraph,
  options: &ParcelOptions,
  gzip: bool,
) -> Vec<BundleStats> {
  let mut bundles: Vec<BundleStats> = written_bundles(bundle_graph)
    .collect::<Vec<_>>()
    .into_par_iter()
    .filter_map(|bundle| {
      let path = bundle.dist_path();
      let contents = options.output_fs.read(path).ok()?;
      let assets = match source_map_sizes(path, &contents, options) {
        Some(sizes) => sizes
          .into_iter()
          .map(|(path, size)| AssetStats { path, size })
          .collect(),
        None => {
          let mut sizes: HashMap<PathId, u64> = HashMap::new();
          for &asset_index in &bundle.assets {
            let asset = bundle_graph.asset_graph.asset(asset_index);
            let Ok(path) = asset.loc.url.to_file_path() else {
              continue;
            };
            // The packager may generate a single asset's output (e.g. docs from source), so its
            // size before packaging can be unrelated to the bundle's.
            let size = if bundle.assets.len() == 1 {
              contents.len() as u64
            } else {
              asset.content.estimate_size().unwrap_or(0) as u64
            };
            *sizes.entry(path).or_default() += size;
          }
          sizes
            .into_iter()
            .map(|(path, size)| AssetStats {
              path: Some(path),
              size,
            })
            .collect()
        }
      };
      Some(BundleStats {
        path,
        size: contents.len() as u64,
        gzip_size: gzip.then(|| gzip_size(&contents)),
        assets,
      })
    })
    .collect();

  for bundle in &mut bundles {
    bundle.assets.sort_by(|a, b| b.size.cmp(&a.size));
  }
  bundles.sort_by(|a, b| b.size.cmp(&a.size));
  bundles
}

/// The size of `contents` gzipped at the default level.
fn gzip_size(contents: &[u8]) -> u64 {
  let mut compressor = libdeflater::Compressor::new(libdeflater::CompressionLvl::default());
  let mut out = vec![0; compressor.gzip_compress_bound(contents.len())];
  compressor
    .gzip_compress(contents, &mut out)
    .map_or(contents.len(), |size| size) as u64
}

/// The bundles written to files. Inline bundles aren't written, and bundles with identical content
/// may share a file.
fn written_bundles<'a>(bundle_graph: &'a BundleGraph) -> impl Iterator<Item = &'a Bundle> {
  let mut seen = HashSet::new();
  bundle_graph
    .bundles
    .iter()
    .filter(|bundle| bundle.bundle_behavior != BundleBehavior::Inline)
    .filter(move |bundle| seen.insert(bundle.dist_path()))
}

/// The sizes of the written bundles, largest first, without their assets.
pub fn bundle_sizes(bundle_graph: &BundleGraph, options: &ParcelOptions) -> Vec<BundleStats> {
  let mut bundles: Vec<BundleStats> = written_bundles(bundle_graph)
    .filter_map(|bundle| {
      let path = bundle.dist_path();
      Some(BundleStats {
        path,
        size: options.output_fs.stat(path)?.size,
        gzip_size: None,
        assets: Vec::new(),
      })
    })
    .collect();
  bundles.sort_by(|a, b| b.size.cmp(&a.size));
  bundles
}

/// The number of bytes of the bundle written to `path` that come from each source file, according
/// to its source map, plus the bytes from unknown sources (keyed by `None`) if there are any.
fn source_map_sizes(
  path: PathId,
  contents: &[u8],
  options: &ParcelOptions,
) -> Option<Vec<(Option<PathId>, u64)>> {
  let code = std::str::from_utf8(contents).ok()?;
  let url = source_mapping_url(code)?;
  let (json, map_dir) = match url.strip_prefix("data:") {
    Some(data) => {
      let (_, base64) = data.split_once(";base64,")?;
      let json = data_encoding::BASE64.decode(base64.as_bytes()).ok()?;
      (json, path.parent()?)
    }
    None => {
      let url = url.strip_prefix("file://").unwrap_or(url);
      let url = percent_encoding::percent_decode_str(url)
        .decode_utf8()
        .ok()?;
      let map_path = path.parent()?.join(Path::new(&*url));
      (options.output_fs.read(map_path).ok()?, map_path.parent()?)
    }
  };

  let (sources, mappings) = parse_source_map(&json, map_dir, options.project_root)?;
  let (source_sizes, unknown) = attribute_bytes(code, &mappings, sources.len())?;
  let mut sizes: HashMap<PathId, u64> = HashMap::new();
  for (source, size) in sources.into_iter().zip(source_sizes) {
    *sizes.entry(source).or_default() += size;
  }
  let mut sizes: Vec<_> = sizes
    .into_iter()
    .map(|(path, size)| (Some(path), size))
    .collect();
  if unknown > 0 {
    sizes.push((None, unknown));
  }
  Some(sizes)
}

/// The URL in a `sourceMappingURL` comment at the end of `code`.
fn source_mapping_url(code: &str) -> Option<&str> {
  let code = code.trim_end();
  let code = code.strip_suffix("*/").unwrap_or(code).trim_end();
  let line = code[code.rfind('\n').map_or(0, |i| i + 1)..].trim_start();
  let comment = line
    .strip_prefix("//")
    .or_else(|| line.strip_prefix("/*"))?
    .trim_start();
  let comment = comment
    .strip_prefix('#')
    .or_else(|| comment.strip_prefix('@'))?
    .trim_start()
    .strip_prefix("sourceMappingURL")?
    .trim_start()
    .strip_prefix('=')?
    .trim_start();
  let url = &comment[..comment
    .find(|c: char| c.is_whitespace() || c == '*')
    .unwrap_or(comment.len())];
  (!url.is_empty()).then_some(url)
}

/// A generated position: line, UTF-16 column, and the index of its source, if any.
type Mapping = (u32, u32, Option<u32>);

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSourceMap {
  #[serde(default)]
  mappings: String,
  #[serde(default)]
  sources: Vec<String>,
  source_root: Option<String>,
  /// The sections of an index map, which Parcel writes for bundles.
  sections: Option<Vec<RawSection>>,
}

#[derive(serde::Deserialize)]
struct RawSection {
  offset: RawOffset,
  map: RawSourceMap,
}

#[derive(serde::Deserialize)]
struct RawOffset {
  line: u32,
  column: u32,
}

/// The sources of a source map, resolved against `map_dir`, and its mappings.
fn parse_source_map(
  json: &[u8],
  map_dir: PathId,
  project_root: PathId,
) -> Option<(Vec<PathId>, Vec<Mapping>)> {
  let raw: RawSourceMap = serde_json::from_slice(json).ok()?;
  let mut sources = Vec::new();
  let mut mappings = Vec::new();
  add_source_map(
    raw,
    0,
    0,
    map_dir,
    project_root,
    &mut sources,
    &mut mappings,
  )?;
  Some((sources, mappings))
}

/// Adds the sources and mappings of `raw`, offset by `line_offset` lines and, on its first line,
/// by `column_offset` columns.
fn add_source_map(
  raw: RawSourceMap,
  line_offset: u32,
  column_offset: u32,
  map_dir: PathId,
  project_root: PathId,
  sources: &mut Vec<PathId>,
  mappings: &mut Vec<Mapping>,
) -> Option<()> {
  if let Some(sections) = raw.sections {
    for section in sections {
      let RawOffset { line, column } = section.offset;
      let column = if line == 0 {
        column_offset + column
      } else {
        column
      };
      // The previous section's last mapping ends where this one starts. Code before the
      // section's first mapping (e.g. a module's generated prologue) belongs to its first source,
      // and an empty section's code (e.g. the runtime) to none.
      let start = mappings.len();
      mappings.push((line_offset + line, column, None));
      add_source_map(
        section.map,
        line_offset + line,
        column,
        map_dir,
        project_root,
        sources,
        mappings,
      )?;
      mappings[start].2 = mappings[start + 1..].iter().find_map(|mapping| mapping.2);
    }
    return Some(());
  }

  let source_dir = match raw.source_root.as_deref() {
    Some(root) if !root.is_empty() && !root.starts_with('/') => map_dir.join(Path::new(root)),
    _ => map_dir,
  };
  let resolved: Vec<String> = raw
    .sources
    .iter()
    .map(|source| {
      let source = source.strip_prefix("file://").unwrap_or(source);
      source_dir
        .join(Path::new(source))
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
    })
    .collect();
  // The map stores sources relative to the project root.
  let mut map = SourceMap::new(&project_root.to_path_buf().to_string_lossy());
  map
    .add_vlq_map(raw.mappings.as_bytes(), resolved, vec![], vec![], 0, 0)
    .ok()?;

  let first_source = sources.len() as u32;
  sources.extend(
    map
      .get_sources()
      .iter()
      .map(|source| project_root.join(Path::new(source))),
  );
  mappings.extend(map.get_mappings().into_iter().map(|mapping| {
    let line = mapping.generated_line;
    let column = mapping.generated_column + if line == 0 { column_offset } else { 0 };
    let source = mapping
      .original
      .map(|original| first_source + original.source);
    (line_offset + line, column, source)
  }));
  Some(())
}

/// The number of bytes of `code` mapped to each of `source_count` sources, and the number of bytes
/// that aren't mapped to a source. Each character belongs to the closest mapping before it.
/// `None` if nothing is mapped to a source.
fn attribute_bytes(
  code: &str,
  mappings: &[Mapping],
  source_count: usize,
) -> Option<(Vec<u64>, u64)> {
  if mappings.iter().all(|mapping| mapping.2.is_none()) {
    return None;
  }
  let mut lines: Vec<Vec<(u32, Option<u32>)>> = Vec::new();
  for &(line, column, source) in mappings {
    let line = line as usize;
    if lines.len() <= line {
      lines.resize_with(line + 1, Vec::new);
    }
    lines[line].push((column, source));
  }

  let mut sizes = vec![0u64; source_count];
  let mut unknown = 0u64;
  let mut add = |source: Option<u32>, size: usize| match source
    .and_then(|source| sizes.get_mut(source as usize))
  {
    Some(total) => *total += size as u64,
    None => unknown += size as u64,
  };
  // Mappings usually start at a line's first token, so its indentation, and lines without
  // mappings (e.g. a lone `]`), belong to the source in effect at the end of the previous line.
  // Sections and unmapped segments end it.
  let mut current = None;
  let mut offsets = Vec::new();
  for (line, text) in code.split_inclusive('\n').enumerate() {
    let Some(segments) = lines.get_mut(line).filter(|segments| !segments.is_empty()) else {
      add(current, text.len());
      continue;
    };
    // Stable, so of mappings at the same column the last one wins.
    segments.sort_by_key(|&(column, _)| column);

    // Columns count UTF-16 code units.
    offsets.clear();
    if text.is_ascii() {
      offsets.extend(
        segments
          .iter()
          .map(|&(column, _)| (column as usize).min(text.len())),
      );
    } else {
      let mut chars = text.char_indices().peekable();
      let mut column = 0;
      for &(target, _) in segments.iter() {
        while let Some(&(_, c)) = chars.peek() {
          if column >= target as usize {
            break;
          }
          column += c.len_utf16();
          chars.next();
        }
        offsets.push(chars.peek().map_or(text.len(), |&(offset, _)| offset));
      }
    }

    add(current, offsets[0]);
    for (i, &(_, source)) in segments.iter().enumerate() {
      let end = offsets.get(i + 1).copied().unwrap_or(text.len());
      add(source, end - offsets[i]);
      current = source;
    }
  }
  Some((sizes, unknown))
}

/// Prints the size of each bundle and, if `asset_count` isn't 0, of the `asset_count` largest
/// assets in each, with paths relative to `cwd`.
pub fn bundle_report(
  bundles: &[BundleStats],
  asset_count: usize,
  cwd: PathId,
  out: &mut impl Write,
) -> std::io::Result<()> {
  let dim = Style::new().effects(Effects::DIMMED);
  let mut rows: Vec<Vec<String>> = Vec::new();

  for (index, bundle) in bundles.iter().enumerate() {
    rows.push(vec![
      format_filename(bundle.path, cwd, fg(AnsiColor::Cyan).bold()),
      prettify_size(bundle.size, bundle.size > LARGE_BUNDLE_SIZE, Effects::BOLD),
    ]);

    if asset_count > 0 {
      let largest = &bundle.assets[..asset_count.min(bundle.assets.len())];
      for (i, asset) in largest.iter().enumerate() {
        let mut name = String::from(if i == largest.len() - 1 {
          "└── "
        } else {
          "├── "
        });
        match asset.path {
          Some(path) => name += &format_filename(path, cwd, Style::new()),
          None => name += "Code from unknown sourcefiles",
        }
        rows.push(vec![
          name,
          prettify_size(asset.size, false, Effects::DIMMED),
        ]);
      }

      if bundle.assets.len() > largest.len() {
        rows.push(vec![format!(
          "└── {}",
          paint(
            dim,
            &format!("+ {} more assets", bundle.assets.len() - largest.len())
          )
        )]);
      }

      // Separate bundles with an empty row.
      if index != bundles.len() - 1 {
        rows.push(Vec::new());
      }
    }
  }

  writeln!(out)?;
  table(&[Align::Left, Align::Right], &rows, out)
}

#[derive(Clone, Copy, PartialEq)]
enum Align {
  Left,
  Right,
}

fn table(columns: &[Align], rows: &[Vec<String>], out: &mut impl Write) -> std::io::Result<()> {
  let mut widths = vec![0; columns.len()];
  for row in rows {
    for (width, item) in widths.iter_mut().zip(row) {
      *width = (*width).max(display_width(item));
    }
  }

  for row in rows {
    let mut line = String::new();
    for (i, item) in row.iter().enumerate() {
      // Pad between columns unless the next column is aligned the other way.
      let padding = match columns.get(i + 1) {
        Some(&next) if next != columns[i] => 0,
        _ => 4,
      };
      let pad = " ".repeat(widths[i] + padding - display_width(item));
      match columns[i] {
        Align::Left => {
          line += item;
          line += &pad;
        }
        Align::Right => {
          line += &pad;
          line += item;
        }
      }
    }
    writeln!(out, "{line}")?;
  }
  Ok(())
}

/// The width of `text` in a terminal, ignoring escape sequences.
fn display_width(text: &str) -> usize {
  let mut plain = String::with_capacity(text.len());
  let mut chars = text.chars();
  while let Some(c) = chars.next() {
    if c == '\x1b' {
      // Skip a CSI sequence up to its final byte.
      if chars.next() == Some('[') {
        for c in chars.by_ref() {
          if ('@'..='~').contains(&c) {
            break;
          }
        }
      }
    } else {
      plain.push(c);
    }
  }
  plain.width()
}

fn fg(color: AnsiColor) -> Style {
  Style::new().fg_color(Some(Color::Ansi(color)))
}

fn paint(style: Style, text: &str) -> String {
  format!("{style}{text}{style:#}")
}

/// The path relative to the current working directory, with the directory dimmed and the file
/// name in `style`.
fn format_filename(path: PathId, cwd: PathId, style: Style) -> String {
  let dir = path
    .parent()
    .map(|dir| dir.relative(&cwd))
    .unwrap_or_default();
  let mut dir = dir.to_string_lossy().into_owned();
  if !dir.is_empty() {
    dir.push(std::path::MAIN_SEPARATOR);
  }
  format!(
    "{}{}",
    paint(Style::new().effects(Effects::DIMMED), &dir),
    paint(style, path.file_name())
  )
}

fn prettify_size(size: u64, is_large: bool, effects: Effects) -> String {
  let size = filesize(size);
  if is_large {
    paint(
      fg(AnsiColor::Yellow).effects(effects),
      &format!("⚠️  {size}"),
    )
  } else {
    paint(fg(AnsiColor::Magenta).effects(effects), &size)
  }
}

/// Formats a size like the `filesize` npm package: in powers of 1000, rounded to two decimals.
fn filesize(size: u64) -> String {
  const UNITS: [&str; 9] = ["B", "kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  if size == 0 {
    return "0 B".into();
  }
  let mut exponent = ((size as f64).log10() / 3.0).floor() as usize;
  exponent = exponent.min(UNITS.len() - 1);
  let mut value = size as f64 / 1000f64.powi(exponent as i32);
  if (value * 100.0).round() / 100.0 >= 1000.0 && exponent < UNITS.len() - 1 {
    value /= 1000.0;
    exponent += 1;
  }
  let value = format!("{value:.2}");
  let value = value.trim_end_matches('0').trim_end_matches('.');
  format!("{value} {}", UNITS[exponent])
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn formats_sizes_like_filesize() {
    for (size, expected) in [
      (0, "0 B"),
      (1, "1 B"),
      (999, "999 B"),
      (1000, "1 kB"),
      (1023, "1.02 kB"),
      (1234, "1.23 kB"),
      (15360, "15.36 kB"),
      (999_999, "1 MB"),
      (1_048_576, "1.05 MB"),
      (1_500_000, "1.5 MB"),
      (123_456_789, "123.46 MB"),
    ] {
      assert_eq!(filesize(size), expected);
    }
  }

  #[test]
  fn finds_source_mapping_url() {
    assert_eq!(
      source_mapping_url("a();\n//# sourceMappingURL=a.js.map\n"),
      Some("a.js.map")
    );
    assert_eq!(
      source_mapping_url(".a{}\n/*# sourceMappingURL=a.css.map */"),
      Some("a.css.map")
    );
    assert_eq!(
      source_mapping_url("//@ sourceMappingURL = data:application/json;base64,e30="),
      Some("data:application/json;base64,e30=")
    );
    assert_eq!(
      source_mapping_url("//# sourceMappingURL=a.js.map\na();"),
      None
    );
  }

  fn parse(json: &str) -> (Vec<PathId>, Vec<Mapping>) {
    parse_source_map(
      json.as_bytes(),
      PathId::new(Path::new("/project/dist")),
      PathId::new(Path::new("/project")),
    )
    .unwrap()
  }

  #[test]
  fn attributes_bytes_to_sources() {
    // Line 0: "ab" from a.js at column 0, "cd" from b.js at column 2. Line 1 has no mappings, so
    // it continues b.js, as does line 2 up to column 1. Then "é" (2 bytes, 1 UTF-16 unit) and "f"
    // from b.js, and an unmapped segment at column 3, which continues through line 3.
    let code = "abcd\n,\nxéfg\nzz";
    let (sources, mappings) = parse(
      r#"{"version":3,"sourceRoot":"../","sources":["src/a.js","src/b.js"],"mappings":"AAAA,ECAA;;CAAA,E"}"#,
    );
    assert_eq!(
      sources,
      [
        PathId::new(Path::new("/project/src/a.js")),
        PathId::new(Path::new("/project/src/b.js"))
      ]
    );
    let (sizes, unknown) = attribute_bytes(code, &mappings, sources.len()).unwrap();
    // a.js: "ab"; b.js: "cd\n" + ",\n" + "x" + "éf"
    assert_eq!(sizes, vec![2, 9]);
    // "g\n", "zz"
    assert_eq!(unknown, 4);
    assert_eq!(sizes.iter().sum::<u64>() + unknown, code.len() as u64);
  }

  #[test]
  fn offsets_index_map_sections() {
    let (sources, mappings) = parse(
      r#"{"version":3,"sections":[
        {"offset":{"line":0,"column":2},"map":{"version":3,"sources":["a.js"],"mappings":"AAAA;AAAA"}},
        {"offset":{"line":1,"column":3},"map":{"version":3,"sourceRoot":"../","sources":["b.js"],"mappings":"AAAA,CAAA"}},
        {"offset":{"line":2,"column":0},"map":{"version":3,"sources":[],"mappings":""}}
      ]}"#,
    );
    assert_eq!(
      sources,
      [
        PathId::new(Path::new("/project/dist/a.js")),
        PathId::new(Path::new("/project/b.js"))
      ]
    );
    // Each section starts with a boundary, and its column offset only applies to its first line.
    assert_eq!(
      mappings,
      [
        (0, 2, Some(0)),
        (0, 2, Some(0)),
        (1, 0, Some(0)),
        (1, 3, Some(1)),
        (1, 3, Some(1)),
        (1, 4, Some(1)),
        (2, 0, None)
      ]
    );
  }

  #[test]
  fn ignores_maps_without_sources() {
    let (_, mappings) = parse(r#"{"version":3,"sources":["a.js"],"mappings":"A,C"}"#);
    assert!(attribute_bytes("ab", &mappings, 1).is_none());
  }

  #[test]
  fn measures_width_without_escapes() {
    assert_eq!(display_width(&paint(fg(AnsiColor::Cyan).bold(), "abc")), 3);
    assert_eq!(display_width("⚠️  1 MB"), 8);
  }
}
