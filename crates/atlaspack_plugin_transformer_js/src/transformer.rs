use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

use anyhow::{anyhow, Error};

use atlaspack_core::plugin::{PluginContext, PluginOptions, TransformerPlugin};
use atlaspack_core::plugin::{TransformResult, TransformationInput};
use atlaspack_core::types::engines::EnvironmentFeature;
use atlaspack_core::types::{
  Asset, BuildMode, Diagnostic, ErrorKind, FileType, LogLevel, OutputFormat, SourceType,
};
use atlaspack_filesystem::FileSystemRef;

use crate::ts_config::{Jsx, Target, TsConfig};

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
pub struct AtlaspackJsTransformerPlugin {
  file_system: FileSystemRef,
  options: Arc<PluginOptions>,
  ts_config: Option<TsConfig>,
}

impl AtlaspackJsTransformerPlugin {
  pub fn new(ctx: &PluginContext) -> Result<Self, Error> {
    let ts_config = ctx
      .config
      .load_json_config::<TsConfig>("tsconfig.json")
      .map(|config| config.contents)
      .map_err(|err| {
        let diagnostic = err.downcast_ref::<Diagnostic>();

        if diagnostic.is_some_and(|d| d.kind != ErrorKind::NotFound) {
          return Err(err);
        }

        Ok(None::<TsConfig>)
      })
      .ok();

    Ok(Self {
      file_system: ctx.file_system.clone(),
      options: ctx.options.clone(),
      ts_config,
    })
  }
}

impl fmt::Debug for AtlaspackJsTransformerPlugin {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.debug_struct("AtlaspackJsTransformerPlugin")
      .field("options", &self.options)
      .finish()
  }
}

impl TransformerPlugin for AtlaspackJsTransformerPlugin {
  /// This does a lot of equivalent work to `JSTransformer::transform` in
  /// `packages/transformers/js`
  fn transform(&mut self, input: TransformationInput) -> Result<TransformResult, Error> {
    let compiler_options = self
      .ts_config
      .as_ref()
      .and_then(|ts| ts.compiler_options.as_ref());

    let env = input.env();
    let file_type = input.file_type();
    let is_node = env.context.is_node();
    let source_code = input.read_code(self.file_system.clone())?;

    let mut targets: HashMap<String, String> = HashMap::new();
    if env.context.is_browser() {
      for (name, version) in env.engines.browsers.iter() {
        if let Some(version) = version {
          targets.insert(
            String::from(name),
            format!("{}.{}", version.major(), version.minor()),
          );
        }
      }
    }

    if env.context.is_electron() {
      if let Some(version) = env.engines.electron {
        targets.insert(
          String::from("electron"),
          format!("{}.{}", version.major(), version.minor()),
        );
      }
    }

    if env.context.is_node() {
      if let Some(version) = env.engines.node {
        targets.insert(
          String::from("node"),
          format!("{}.{}", version.major(), version.minor()),
        );
      }
    }

    let transformation_result = atlaspack_js_swc_core::transform(
      atlaspack_js_swc_core::Config {
        // TODO: Infer from package.json
        automatic_jsx_runtime: compiler_options
          .map(|co| {
            co.jsx
              .as_ref()
              .is_some_and(|jsx| matches!(jsx, Jsx::ReactJsx | Jsx::ReactJsxDev))
              || co.jsx_import_source.is_some()
          })
          .unwrap_or_default(),
        code: source_code.bytes().to_vec(),
        decorators: compiler_options
          .and_then(|co| co.experimental_decorators)
          .unwrap_or_default(),
        env: self
          .options
          .env
          .clone()
          .unwrap_or_default()
          .iter()
          .map(|(key, value)| (key.as_str().into(), value.as_str().into()))
          .collect(),
        filename: input
          .file_path()
          .to_str()
          .ok_or_else(|| anyhow!("Invalid non UTF-8 file-path"))?
          .to_string(),
        insert_node_globals: !is_node && env.source_type != SourceType::Script,
        is_browser: env.context.is_browser(),
        is_development: self.options.mode == BuildMode::Development,
        is_esm_output: env.output_format == OutputFormat::EsModule,
        is_jsx: matches!(file_type, FileType::Jsx | FileType::Tsx),
        is_library: env.is_library,
        is_type_script: matches!(file_type, FileType::Ts | FileType::Tsx),
        is_worker: env.context.is_worker(),
        // TODO Infer from package.json
        jsx_import_source: compiler_options.and_then(|co| co.jsx_import_source.clone()),
        jsx_pragma: compiler_options.and_then(|co| co.jsx_factory.clone()),
        jsx_pragma_frag: compiler_options.and_then(|co| co.jsx_fragment_factory.clone()),
        node_replacer: is_node,
        project_root: self.options.project_root.to_string_lossy().into_owned(),
        // TODO: Boolean(
        //   pkg?.dependencies?.react ||
        //     pkg?.devDependencies?.react ||
        //     pkg?.peerDependencies?.react,
        // );
        react_refresh: self.options.mode == BuildMode::Development
          // && TODO: self.options.hmr_options
          && env.context.is_browser()
          && !env.is_library
          && !env.context.is_worker()
          && !env.context.is_worklet(),
        replace_env: !is_node,
        scope_hoist: env.should_scope_hoist && env.source_type != SourceType::Script,
        source_maps: env.source_map.is_some(),
        source_type: match env.source_type {
          SourceType::Module => atlaspack_js_swc_core::SourceType::Module,
          SourceType::Script => atlaspack_js_swc_core::SourceType::Script,
        },
        supports_module_workers: env.should_scope_hoist
          && env.engines.supports(EnvironmentFeature::WorkerModule),
        // TODO: Update transformer to use engines directly
        targets: Some(targets),
        trace_bailouts: self.options.log_level == LogLevel::Verbose,
        use_define_for_class_fields: compiler_options
          .map(|co| {
            co.use_define_for_class_fields.unwrap_or_else(|| {
              // Default useDefineForClassFields to true if target is ES2022 or higher (including ESNext)
              co.target.as_ref().is_some_and(|target| {
                matches!(target, Target::ES2022 | Target::ES2023 | Target::ESNext)
              })
            })
          })
          .unwrap_or_default(),
        ..atlaspack_js_swc_core::Config::default()
      },
      None,
    )?;

    // TODO handle errors properly
    if let Some(errors) = transformation_result.diagnostics {
      return Err(anyhow!(format!("{:#?}", errors)));
    }

    let file_path = input.file_path();
    let file_type = FileType::from_extension(
      file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default(),
    );

    let asset = Asset {
      code: source_code,
      env: env.clone(),
      file_path: file_path.to_path_buf(),
      file_type,
      ..Asset::default()
    };

    let config = atlaspack_js_swc_core::Config::default();
    let result = conversion::convert_result(asset, &config, transformation_result, &self.options)
      // TODO handle errors properly
      .map_err(|_err| anyhow!("Failed to transform"))?;

    Ok(result)
  }
}

#[cfg(test)]
mod test {
  use std::path::PathBuf;

  use atlaspack_core::{
    config_loader::ConfigLoader,
    plugin::PluginLogger,
    types::{Code, Dependency, Location, SourceLocation, SpecifierType, Symbol},
  };
  use atlaspack_filesystem::in_memory_file_system::InMemoryFileSystem;

  use super::*;

  fn empty_asset() -> Asset {
    Asset {
      file_type: FileType::Js,
      ..Default::default()
    }
  }

  #[test]
  fn test_asset_id_is_stable() {
    let source_code = Arc::new(Code::from(String::from("function hello() {}")));

    let asset_1 = Asset {
      code: source_code.clone(),
      file_path: "mock_path".into(),
      ..Asset::default()
    };

    let asset_2 = Asset {
      code: source_code,
      file_path: "mock_path".into(),
      ..Asset::default()
    };

    // This nº should not change across runs / compilation
    assert_eq!(asset_1.id(), 12098957784286304761);
    assert_eq!(asset_1.id(), asset_2.id());
  }

  #[test]
  fn test_transformer_on_noop_asset() {
    let source_code = Arc::new(Code::from(String::from("function hello() {}")));
    let target_asset = Asset {
      code: source_code,
      file_path: "mock_path.js".into(),
      ..Asset::default()
    };
    let asset_id = target_asset.id();
    let result = run_test(target_asset).unwrap();

    assert_eq!(
      result,
      TransformResult {
        asset: Asset {
          file_path: "mock_path.js".into(),
          file_type: FileType::Js,
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
    let target_asset = Asset {
      code: source_code,
      file_path: "mock_path.js".into(),
      ..Asset::default()
    };
    let asset_id = target_asset.id();
    let result = run_test(target_asset).unwrap();

    let mut expected_dependencies = vec![Dependency {
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
      placeholder: Some("e83f3db3d6f57ea6".to_string()),
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
    expected_dependencies[0].set_placeholder("e83f3db3d6f57ea6");
    expected_dependencies[0].set_kind("Require");

    assert_eq!(result.dependencies, expected_dependencies);
    assert_eq!(
      result,
      TransformResult {
        asset: Asset {
          file_path: "mock_path.js".into(),
          file_type: FileType::Js,
          // SWC inserts a newline here
          code: Arc::new(Code::from(String::from(
            "var x = require(\"e83f3db3d6f57ea6\");\nexports.hello = function() {};\n"
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

    let ctx = PluginContext {
      config: Arc::new(ConfigLoader {
        fs: file_system.clone(),
        project_root: PathBuf::default(),
        search_path: PathBuf::default(),
      }),
      file_system,
      logger: PluginLogger::default(),
      options: Arc::new(PluginOptions::default()),
    };

    let mut transformer = AtlaspackJsTransformerPlugin::new(&ctx).expect("Expected transformer");

    let result = transformer.transform(TransformationInput::Asset(asset))?;
    Ok(result)
  }
}
