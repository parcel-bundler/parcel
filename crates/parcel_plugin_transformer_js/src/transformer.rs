use anyhow::{anyhow, Error};

use parcel_core::plugin::TransformerPlugin;
use parcel_core::plugin::{RunTransformContext, TransformResult, TransformationInput};
use parcel_core::types::Asset;

mod conversion;
#[cfg(test)]
mod test_helpers;

/// This is a rust only `TransformerPlugin` implementation for JS assets that goes through the
/// default SWC transformer.
///
/// The transformer is part of the `AssetRequest` and is responsible for:
///
/// * Parsing a JS/TS file
/// * Transforming the file using SWC
/// * Analyzing all its `require`/`import`/`export` statements and returning lists of found
///  `Dependency` as well as exported, imported and re-exported symbols (as `Symbol`, usually
///   mapping to a mangled name that the SWC transformer replaced in the source file + the source
///   module and the source name that has been imported)
#[derive(Debug)]
pub struct ParcelJsTransformerPlugin {}

impl ParcelJsTransformerPlugin {
  pub fn new() -> Self {
    Self {}
  }
}

impl TransformerPlugin for ParcelJsTransformerPlugin {
  /// This does a lot of equivalent work to `JSTransformer::transform` in
  /// `packages/transformers/js`
  fn transform(
    &mut self,
    context: &mut RunTransformContext,
    input: TransformationInput,
  ) -> Result<TransformResult, Error> {
    let file_system = context.file_system();
    let source_code = input.read_code(file_system)?;

    let transformation_result = parcel_js_swc_core::transform(
      parcel_js_swc_core::Config {
        filename: input
          .file_path()
          .to_str()
          .ok_or_else(|| anyhow!("Invalid non UTF-8 file-path"))?
          .to_string(),
        code: source_code.bytes().to_vec(),
        source_type: parcel_js_swc_core::SourceType::Module,
        ..parcel_js_swc_core::Config::default()
      },
      None,
    )?;

    // TODO handle errors properly
    if let Some(errors) = transformation_result.diagnostics {
      return Err(anyhow!(format!("{:#?}", errors)));
    }

    let asset = Asset::new_empty(input.file_path().to_path_buf(), source_code);
    let config = parcel_js_swc_core::Config::default();
    let options = context.options();
    let result = conversion::convert_result(asset, &config, transformation_result, &options)
      // TODO handle errors properly
      .map_err(|_err| anyhow!("Failed to transform"))?;

    Ok(result)
  }
}

#[cfg(test)]
mod test {
  use std::path::PathBuf;
  use std::sync::Arc;

  use parcel_core::plugin::{
    RunTransformContext, TransformResult, TransformationInput, TransformerPlugin,
  };
  use parcel_core::types::{
    Asset, Code, Dependency, FileType, Location, SourceLocation, SpecifierType, Symbol,
  };
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;

  use crate::ParcelJsTransformerPlugin;

  fn empty_asset() -> Asset {
    Asset {
      asset_type: FileType::Js,
      ..Default::default()
    }
  }

  #[test]
  fn test_asset_id_is_stable() {
    let source_code = Arc::new(Code::from(String::from("function hello() {}")));
    let asset_1 = Asset::new_empty("mock_path".into(), source_code.clone());
    let asset_2 = Asset::new_empty("mock_path".into(), source_code);
    // This nº should not change across runs / compilation
    assert_eq!(asset_1.id(), 5024550712560999390);
    assert_eq!(asset_1.id(), asset_2.id());
  }

  #[test]
  fn test_transformer_on_noop_asset() {
    let source_code = Arc::new(Code::from(String::from("function hello() {}")));
    let target_asset = Asset::new_empty("mock_path".into(), source_code);
    let asset_id = target_asset.id();
    let result = run_test(target_asset).unwrap();

    assert_eq!(
      result,
      TransformResult {
        asset: Asset {
          file_path: "mock_path".into(),
          asset_type: FileType::Js,
          // SWC inserts a newline here
          code: Arc::new(Code::from(String::from("function hello() {}\n"))),
          symbols: vec![],
          has_symbols: true,
          unique_key: Some(format!("{:016x}", asset_id)),
          ..empty_asset()
        },
        dependencies: vec![],
        invalidate_on_file_change: vec![]
      }
    );
  }

  #[test]
  fn test_transformer_on_asset_that_requires_other() {
    let source_code = Arc::new(Code::from(String::from(
      r#"
const x = require('other');
exports.hello = function() {};
    "#,
    )));
    let target_asset = Asset::new_empty("mock_path.js".into(), source_code);
    let asset_id = target_asset.id();
    let result = run_test(target_asset).unwrap();

    let expected_dependencies = vec![Dependency {
      loc: Some(SourceLocation {
        file_path: PathBuf::from("mock_path.js"),
        start: Location {
          line: 2,
          column: 19,
        },
        end: Location {
          line: 2,
          column: 26,
        },
      }),
      source_asset_id: Some(format!("{:016x}", asset_id)),
      source_path: Some(PathBuf::from("mock_path.js")),
      specifier: String::from("other"),
      specifier_type: SpecifierType::CommonJS,
      symbols: vec![Symbol {
        exported: String::from("*"),
        loc: None,
        local: String::from("$other$"),
        ..Symbol::default()
      }],
      ..Default::default()
    }];
    assert_eq!(result.dependencies, expected_dependencies);
    assert_eq!(
      result,
      TransformResult {
        asset: Asset {
          file_path: "mock_path.js".into(),
          asset_type: FileType::Js,
          // SWC inserts a newline here
          code: Arc::new(Code::from(String::from(
            "const x = require(\"e83f3db3d6f57ea6\");\nexports.hello = function() {};\n"
          ))),
          symbols: vec![
            Symbol {
              exported: String::from("hello"),
              loc: Some(SourceLocation {
                file_path: PathBuf::from("mock_path.js"),
                start: Location { line: 3, column: 9 },
                end: Location {
                  line: 3,
                  column: 14
                }
              }),
              local: String::from("$hello"),
              ..Default::default()
            },
            Symbol {
              exported: String::from("*"),
              loc: Some(SourceLocation {
                file_path: PathBuf::from("mock_path.js"),
                start: Location { line: 1, column: 1 },
                end: Location { line: 1, column: 1 }
              }),
              local: String::from("$_"),
              ..Default::default()
            },
            Symbol {
              exported: String::from("*"),
              loc: None,
              local: format!("${:016x}$exports", asset_id),
              ..Default::default()
            }
          ],
          has_symbols: true,
          unique_key: Some(format!("{:016x}", asset_id)),
          ..empty_asset()
        },
        dependencies: expected_dependencies,
        invalidate_on_file_change: vec![]
      }
    );
  }

  fn run_test(asset: Asset) -> anyhow::Result<TransformResult> {
    let file_system = Arc::new(InMemoryFileSystem::default());
    let mut context = RunTransformContext::new(file_system);
    let mut transformer = ParcelJsTransformerPlugin::new();
    let input = TransformationInput::Asset(asset);

    let result = transformer.transform(&mut context, input)?;
    Ok(result)
  }
}
