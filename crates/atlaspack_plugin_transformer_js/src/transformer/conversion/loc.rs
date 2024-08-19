use std::path::PathBuf;

use atlaspack_core::types::{Location, SourceLocation};

pub(crate) fn convert_loc(
  file_path: PathBuf,
  loc: &atlaspack_js_swc_core::SourceLocation,
) -> SourceLocation {
  SourceLocation {
    file_path,
    start: Location {
      line: loc.start_line,
      column: loc.start_col,
    },
    end: Location {
      line: loc.end_line,
      column: loc.end_col,
    },
  }
}
