use std::path::{Component, Path, PathBuf};

use parcel_sourcemap::{OriginalLocation, SourceMap};

use crate::{Content, ContentWithSourceMap, Diagnostic};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSourceMap {
  mappings: String,
  sources: Vec<String>,
  #[serde(default)]
  sources_content: Vec<Option<String>>,
  #[serde(default)]
  names: Vec<String>,
  source_root: Option<String>,
}

/// The source map an earlier transformer attached to an asset's content, with
/// sources resolved against the asset's directory (and `sourceRoot`) and made
/// relative to the project root, like the maps Parcel generates itself.
pub fn input_source_map(
  content: &dyn Content,
  asset_path: &Path,
  project_root: &Path,
) -> Option<SourceMap> {
  let map = content.downcast_ref::<ContentWithSourceMap>()?;
  let raw: RawSourceMap = serde_json::from_slice(map.source_map()).ok()?;

  let mut base = asset_path.parent()?.to_path_buf();
  if let Some(root) = raw.source_root.as_deref().filter(|r| !r.is_empty()) {
    base = join(
      &base,
      Path::new(root.strip_prefix("file://").unwrap_or(root)),
    );
  }

  let sources: Vec<String> = raw
    .sources
    .iter()
    .map(|source| {
      let path = source.strip_prefix("file://").unwrap_or(source);
      // Leave other URL schemes (e.g. webpack://) alone.
      if path.contains("://") {
        return source.clone();
      }
      join(&base, Path::new(path)).to_string_lossy().into_owned()
    })
    .collect();

  let sources_content: Vec<String> = (0..sources.len())
    .map(|i| {
      raw
        .sources_content
        .get(i)
        .cloned()
        .flatten()
        .unwrap_or_default()
    })
    .collect();

  let mut map = SourceMap::new(&project_root.to_string_lossy());
  map
    .add_vlq_map(
      raw.mappings.as_bytes(),
      sources,
      sources_content,
      raw.names,
      0,
      0,
    )
    .ok()?;
  Some(map)
}

/// Joins `path` onto the directory `base` (unless it is absolute) and normalizes `.` and `..`.
fn join(base: &Path, path: &Path) -> PathBuf {
  let mut result = PathBuf::new();
  for component in base.join(path).components() {
    match component {
      Component::CurDir => {}
      Component::ParentDir => {
        result.pop();
      }
      component => result.push(component),
    }
  }
  result
}

/// Remaps the mappings in `map_json` that point into `source` through `input`,
/// leaving mappings into other sources untouched. Mappings with no counterpart
/// in the input map are dropped.
pub fn compose_source_map(
  map_json: &str,
  source: &str,
  input: &SourceMap,
) -> Result<String, Diagnostic> {
  // Lookups need mutable access to the input map.
  let input = &mut input.clone();
  let to_diagnostic = |e: parcel_sourcemap::SourceMapError| Diagnostic::from_message(e.to_string());
  let map = SourceMap::from_json("/", map_json).map_err(to_diagnostic)?;
  let Some(source_index) = map.get_source_index(source).map_err(to_diagnostic)? else {
    return Ok(map_json.to_owned());
  };

  let mut out = SourceMap::new("/");
  for mapping in map.get_mappings() {
    let original = match mapping.original {
      Some(original) if original.source == source_index => {
        let Some(found) = input
          .find_closest_mapping(original.original_line, original.original_column)
          .and_then(|m| m.original)
        else {
          continue;
        };
        copy_location(&mut out, input, found)?
      }
      Some(original) => copy_location(&mut out, &map, original)?,
      None => {
        out.add_mapping(mapping.generated_line, mapping.generated_column, None);
        continue;
      }
    };
    out.add_mapping(
      mapping.generated_line,
      mapping.generated_column,
      Some(original),
    );
  }

  out.to_json(None).map_err(to_diagnostic)
}

/// Translates a location in `from` into `to`, adding its source, contents, and name.
fn copy_location(
  to: &mut SourceMap,
  from: &SourceMap,
  location: OriginalLocation,
) -> Result<OriginalLocation, Diagnostic> {
  let to_diagnostic = |e: parcel_sourcemap::SourceMapError| Diagnostic::from_message(e.to_string());
  let sources_len = to.get_sources().len();
  let source = to.add_source(from.get_source(location.source).map_err(to_diagnostic)?);
  if to.get_sources().len() > sources_len {
    let content = from.get_source_content(location.source).unwrap_or_default();
    if !content.is_empty() {
      to.set_source_content(source as usize, content)
        .map_err(to_diagnostic)?;
    }
  }
  let name = match location.name {
    Some(name) => Some(to.add_name(from.get_name(name).map_err(to_diagnostic)?)),
    None => None,
  };
  Ok(OriginalLocation::new(
    location.original_line,
    location.original_column,
    source,
    name,
  ))
}
