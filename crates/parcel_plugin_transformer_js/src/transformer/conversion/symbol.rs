use std::path::Path;

use parcel_core::types::Symbol;

use crate::transformer::conversion::loc::convert_loc;

/// Convert `CollectImportedSymbol`, `ImportedSymbol` and into `Symbol`
macro_rules! convert_symbol {
  ($asset_file_path: ident, $symbol: ident) => {
    Symbol {
      exported: $symbol.imported.as_ref().into(),
      local: $symbol.local.as_ref().into(),
      loc: Some(convert_loc($asset_file_path.to_owned(), &$symbol.loc)),
      ..Default::default()
    }
  };
}

/// Convert from `[CollectImportedSymbol]` to `[Symbol]`
pub(crate) fn transformer_collect_imported_symbol_to_symbol(
  asset_file_path: &Path,
  symbol: &parcel_js_swc_core::CollectImportedSymbol,
) -> Symbol {
  convert_symbol!(asset_file_path, symbol)
}

/// Convert from `[ImportedSymbol]` to `[Symbol]`
///
/// `ImportedSymbol` corresponds to `x`, `y` in `import { x, y } from 'other';`
pub(crate) fn transformer_imported_symbol_to_symbol(
  asset_file_path: &Path,
  symbol: &parcel_js_swc_core::ImportedSymbol,
) -> Symbol {
  convert_symbol!(asset_file_path, symbol)
}

/// Convert from `[ExportedSymbol]` to `[Symbol]`
pub(crate) fn transformer_exported_symbol_into_symbol(
  asset_file_path: &Path,
  symbol: &parcel_js_swc_core::ExportedSymbol,
) -> Symbol {
  Symbol {
    exported: symbol.exported.as_ref().into(),
    local: symbol.local.as_ref().into(),
    loc: Some(convert_loc(asset_file_path.to_owned(), &symbol.loc)),
    is_esm_export: symbol.is_esm,
    ..Default::default()
  }
}

#[cfg(test)]
mod test {
  use std::path::PathBuf;

  use parcel_core::types::{Location, SourceLocation};

  use crate::transformer::test_helpers::{make_test_swc_config, run_swc_core_transform};

  use super::*;

  #[test]
  fn test_convert_collect_imported_symbol_to_symbol() {
    use parcel_core::types::Symbol;

    let result = parcel_js_swc_core::transform(
      parcel_js_swc_core::Config {
        scope_hoist: false,
        ..make_test_swc_config(
          r#"
         import { x } from 'other';
         export function hello() { return x; }
      "#,
        )
      },
      None,
    )
    .unwrap();
    let collect_result = result.symbol_result.unwrap();
    let import: parcel_js_swc_core::CollectImportedSymbol = collect_result.imports[0].clone();

    let result = transformer_collect_imported_symbol_to_symbol(&Path::new("test.js"), &import);
    assert_eq!(
      result,
      Symbol {
        local: "x".to_string(),
        exported: "x".to_string(),
        loc: Some(SourceLocation {
          file_path: "test.js".into(),
          start: Location {
            line: 2,
            column: 19
          },
          end: Location {
            line: 2,
            column: 20
          }
        }),
        is_weak: false,
        is_esm_export: false,
        self_referenced: false,
      }
    )
  }

  #[test]
  fn test_convert_transformer_imported_symbol_to_symbol() {
    let source = r#"
import {x} from 'other';
export function test() {
  return x;
}
    "#;
    let swc_output = run_swc_core_transform(source);
    let import = &swc_output.hoist_result.unwrap().imported_symbols[0];
    let output = transformer_imported_symbol_to_symbol(Path::new("path"), import);

    assert_eq!(
      output,
      Symbol {
        local: "$$import$70a00e0a8474f72a$d141bba7fdc215a3".into(),
        exported: "x".to_string(),
        loc: Some(SourceLocation {
          file_path: PathBuf::from("path"),
          start: Location { line: 2, column: 9 },
          end: Location {
            line: 2,
            column: 10
          }
        }),
        is_weak: false,
        is_esm_export: false,
        self_referenced: false,
      }
    );
  }

  #[test]
  fn test_convert_transformer_exported_symbol_to_symbol() {
    let source = r#"
export function test() {
  return Math.random();
}
    "#;
    let swc_output = run_swc_core_transform(source);
    let import = &swc_output.hoist_result.unwrap().exported_symbols[0];
    let output = transformer_exported_symbol_into_symbol(Path::new("path"), import);

    assert_eq!(
      output,
      Symbol {
        local: "$$export$e0969da9b8fb378d".into(),
        exported: "test".to_string(),
        loc: Some(SourceLocation {
          file_path: PathBuf::from("path"),
          start: Location {
            line: 2,
            column: 17
          },
          end: Location {
            line: 2,
            column: 21
          }
        }),
        is_weak: false,
        is_esm_export: true,
        self_referenced: false,
      }
    );
  }
}
