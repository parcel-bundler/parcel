use std::{
  collections::HashMap,
  path::{Path, PathBuf},
  sync::Arc,
};

use parcel_core::{
  AssetType, BuildMode, BuildOptions, FileSystem, HmrOptions, LogLevel, MemoryFileSystem,
  OverlayFileSystem, PathId,
};
use parcel_js::hmr::get_hmr_update;
use parcel_sourcemap::SourceMap;

const INDEX_JS: &str = r#"import { getMessage } from "./dep.mjs";

globalThis.output = "entry-source-map-token" + ":" + getMessage();
"#;

const DEP_JS: &str = r#"export function getMessage() {
  const depMessage = "dep-source-map-token";
  return depMessage;
}
"#;

const INDEX_HTML: &str = r#"<script type="module" src="./index.mjs"></script>
"#;

#[test]
fn dev_source_map_mappings_point_to_original_code() {
  assert_bundle_source_maps(BuildMode::Development, Some(false));
}

#[test]
fn prod_source_map_mappings_point_to_original_code() {
  assert_bundle_source_maps(BuildMode::Production, Some(true));
}

fn assert_bundle_source_maps(mode: BuildMode, minify: Option<bool>) {
  let (input_fs, project_root) = fixture_fs();
  let input_fs = Arc::new(input_fs);
  let cwd = PathId::new(&project_root);

  let output_fs = Arc::new(MemoryFileSystem::new());
  let bundle_graph = parcel::build(
    &vec!["index.html".into()],
    BuildOptions {
      mode,
      optimize: minify,
      content_hash: None,
      source_map: Some(Default::default()),
      env: HashMap::from([("NODE_ENV".into(), "test".into())]),
      log_level: LogLevel::Verbose,
      input_fs,
      output_fs: output_fs.clone(),
      config: None,
      cwd,
      dist_dir: None,
      public_url: Default::default(),
      hmr: None,
      reporters: Vec::new(),
    },
  )
  .unwrap();

  let bundles = bundle_graph
    .bundles
    .iter()
    .filter(|bundle| bundle.ty == AssetType::Js)
    .map(|bundle| {
      let code = output_fs.read_to_string(bundle.dist_path()).unwrap();
      let map = output_fs
        .read_to_string(bundle.dist_path().add_extension("map"))
        .unwrap();
      (code, map)
    })
    .collect::<Vec<_>>();

  assert_generated_token_maps_to_original(
    &bundles,
    "entry-source-map-token",
    "index.mjs",
    INDEX_JS,
  );
  assert_generated_token_maps_to_original(&bundles, "dep-source-map-token", "dep.mjs", DEP_JS);
}

const PARCELRC: &str = r#"{
  "extends": "@parcel/config-default",
  "transformers": {
    "*.css": ["@parcel/transformer-postcss", "..."],
    "*.js": ["@parcel/transformer-babel", "..."]
  }
}
"#;

const POSTCSS_STYLE: &str = r#"@import "./config.css";

.style-token {
  color: var(--color);
}
"#;

const POSTCSS_CONFIG: &str = r#":root {
  --color: red;
}

.config-token {
  color: blue;
}
"#;

const BABEL_PLUGIN: &str = r#"// Inserts statements so generated lines no longer match source lines.
module.exports = ({types: t}) => ({
  visitor: {
    Program(path) {
      for (let i = 0; i < 5; i++) {
        path.unshiftContainer('body', t.expressionStatement(t.stringLiteral('pad' + i)));
      }
    },
  },
});
"#;

const BABEL_INDEX: &str = r#"// A comment
export function getMessage() {
  return "babel-source-map-token";
}
"#;

#[test]
fn dev_postcss_source_map_maps_through_input_map() {
  assert_postcss_source_map(BuildMode::Development, Some(false));
}

#[test]
fn prod_postcss_source_map_maps_through_input_map() {
  assert_postcss_source_map(BuildMode::Production, Some(true));
}

fn assert_postcss_source_map(mode: BuildMode, minify: Option<bool>) {
  let bundles = build_outputs(
    "postcss",
    &[
      (".parcelrc", PARCELRC),
      (".postcssrc", r#"{"plugins": {"postcss-import": {}}}"#),
      ("style.css", POSTCSS_STYLE),
      ("config.css", POSTCSS_CONFIG),
    ],
    "style.css",
    AssetType::Css,
    mode,
    minify,
  );

  // postcss-import inlines config.css into style.css, so only its input map knows where rules came from.
  assert_token_maps_to(
    &bundles,
    ".config-token",
    ".config-token",
    "config.css",
    POSTCSS_CONFIG,
  );
  assert_token_maps_to(
    &bundles,
    ".style-token",
    ".style-token",
    "style.css",
    POSTCSS_STYLE,
  );
}

const SASS_INDEX: &str = r#"@use "partial";

.index-token {
  color: red;
}
"#;

const SASS_PARTIAL: &str = r#".partial-token {
  color: blue;
}
"#;

#[test]
fn dev_sass_source_map_maps_through_native_plugin() {
  assert_sass_source_map(BuildMode::Development, Some(false));
}

#[test]
fn prod_sass_source_map_maps_through_native_plugin() {
  assert_sass_source_map(BuildMode::Production, Some(true));
}

/// The Sass plugin hands its map to Parcel with `parcel_asset_set_content_utf8_with_map`, which is
/// the only place a partial's position survives: its rules are inlined into the compiled CSS.
fn assert_sass_source_map(mode: BuildMode, minify: Option<bool>) {
  // A dev-dependency of this crate, so cargo builds it next to this test binary.
  let library = std::env::current_exe()
    .unwrap()
    .parent()
    .unwrap()
    .join(format!(
      "{}parcel_transformer_sass.{}",
      std::env::consts::DLL_PREFIX,
      std::env::consts::DLL_EXTENSION
    ));
  let package = format!(
    r#"{{"name": "@parcel/transformer-sass", "parcel": {{"abi": 1, "artifacts": {{"none": "none"}}, "devLibrary": {:?}}}}}"#,
    library.to_str().unwrap()
  );
  let bundles = build_outputs(
    if minify == Some(true) {
      "sass-prod"
    } else {
      "sass-dev"
    },
    &[
      (
        ".parcelrc",
        r#"{"extends": "@parcel/config-default", "transformers": {"*.scss": ["@parcel/transformer-sass"]}}"#,
      ),
      (
        "node_modules/@parcel/transformer-sass/package.json",
        &package,
      ),
      ("index.scss", SASS_INDEX),
      ("_partial.scss", SASS_PARTIAL),
    ],
    "index.scss",
    AssetType::Css,
    mode,
    minify,
  );

  assert_token_maps_to(
    &bundles,
    ".partial-token",
    ".partial-token",
    "_partial.scss",
    SASS_PARTIAL,
  );
  assert_token_maps_to(
    &bundles,
    ".index-token",
    ".index-token",
    "index.scss",
    SASS_INDEX,
  );
}

#[test]
fn css_source_map_maps_to_original_code() {
  let bundles = build_outputs(
    "css",
    &[("config.css", POSTCSS_CONFIG)],
    "config.css",
    AssetType::Css,
    BuildMode::Production,
    Some(true),
  );
  assert_token_maps_to(
    &bundles,
    ".config-token",
    ".config-token",
    "config.css",
    POSTCSS_CONFIG,
  );
}

#[test]
fn dev_babel_source_map_maps_through_input_map() {
  assert_babel_source_map(BuildMode::Development, Some(false));
}

#[test]
fn prod_babel_source_map_maps_through_input_map() {
  assert_babel_source_map(BuildMode::Production, Some(true));
}

fn assert_babel_source_map(mode: BuildMode, minify: Option<bool>) {
  let bundles = build_outputs(
    "babel",
    &[
      (".parcelrc", PARCELRC),
      (".babelrc", r#"{"plugins": ["./plugin.js"]}"#),
      ("plugin.js", BABEL_PLUGIN),
      ("index.js", BABEL_INDEX),
    ],
    "index.js",
    AssetType::Js,
    mode,
    minify,
  );

  assert_generated_token_maps_to_original(
    &bundles,
    "babel-source-map-token",
    "index.js",
    BABEL_INDEX,
  );
}

const HMR_INDEX_JS: &str = r#"import { getMessage } from "./dep.mjs";

globalThis.output = "hmr-source-map-token" + ":" + getMessage();
"#;

#[test]
fn hmr_update_source_map_points_to_original_code() {
  let (fs, project_root) = fixture_fs();
  let fs = Arc::new(fs);
  let mut parcel = parcel::make_parcel(
    &vec!["index.html".into()],
    BuildOptions {
      mode: BuildMode::Development,
      optimize: None,
      content_hash: None,
      source_map: Some(Default::default()),
      env: HashMap::from([("NODE_ENV".into(), "test".into())]),
      log_level: LogLevel::Verbose,
      input_fs: fs.clone(),
      output_fs: Arc::new(MemoryFileSystem::new()),
      config: None,
      cwd: PathId::new(&project_root),
      dist_dir: None,
      public_url: Default::default(),
      hmr: Some(HmrOptions {
        host: "0.0.0.0".into(),
        port: 1234,
      }),
      reporters: Vec::new(),
    },
  )
  .unwrap();
  parcel.build().unwrap();

  let index = project_root.join("index.mjs");
  write_fixture(&fs, &index, HMR_INDEX_JS);
  parcel.invalidate(&[PathId::new(&index)], &[], &[]).unwrap();
  let config = parcel.config.clone();
  let options = parcel.options.clone();
  let result = parcel.build_with_changes().unwrap();
  let update = get_hmr_update(
    result.changed_assets(),
    &result.bundle_graph,
    &config,
    &options,
  );
  let update = serde_json::to_value(update).unwrap();
  let output = update["assets"]
    .as_array()
    .unwrap()
    .iter()
    .map(|asset| asset["output"].as_str().unwrap())
    .find(|output| output.contains("hmr-source-map-token"))
    .unwrap();

  let (code, comments) = output
    .split_once("\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,")
    .expect("update has an inline source map");
  let (map, source_url) = comments.split_once("\n//# sourceURL=").unwrap();
  assert!(
    source_url.ends_with("/index.mjs?hot-update"),
    "{source_url}"
  );
  let map = String::from_utf8(data_encoding::BASE64.decode(map.as_bytes()).unwrap()).unwrap();

  assert_generated_token_maps_to_original(
    &[(code.to_string(), map)],
    "hmr-source-map-token",
    "index.mjs",
    HMR_INDEX_JS,
  );
}

/// Builds `entry` from `files` in a fresh project and returns the code and map of each bundle of type `ty`.
fn build_outputs(
  name: &str,
  files: &[(&str, &str)],
  entry: &str,
  ty: AssetType,
  mode: BuildMode,
  minify: Option<bool>,
) -> Vec<(String, String)> {
  let fs = OverlayFileSystem::new();
  let project_root = std::env::current_dir()
    .unwrap()
    .join("target")
    .join("parcel-source-map-tests")
    .join(name);
  fs.create_dir_all(PathId::new(&project_root)).unwrap();
  write_fixture(&fs, &project_root.join("package.json"), "{}");
  write_fixture(&fs, &project_root.join("yarn.lock"), "");
  for (path, contents) in files {
    write_fixture(&fs, &project_root.join(path), contents);
  }

  let output_fs = Arc::new(MemoryFileSystem::new());
  let bundle_graph = parcel::build(
    &vec![entry.into()],
    BuildOptions {
      mode,
      optimize: minify,
      content_hash: None,
      source_map: Some(Default::default()),
      env: HashMap::from([("NODE_ENV".into(), "test".into())]),
      log_level: LogLevel::Verbose,
      input_fs: Arc::new(fs),
      output_fs: output_fs.clone(),
      config: None,
      cwd: PathId::new(&project_root),
      dist_dir: None,
      public_url: Default::default(),
      hmr: None,
      reporters: Vec::new(),
    },
  )
  .unwrap();

  bundle_graph
    .bundles
    .iter()
    .filter(|bundle| bundle.ty == ty)
    .map(|bundle| {
      let code = output_fs.read_to_string(bundle.dist_path()).unwrap();
      let map = output_fs
        .read_to_string(bundle.dist_path().add_extension("map"))
        .unwrap();
      (code, map)
    })
    .collect()
}

fn fixture_fs() -> (OverlayFileSystem, PathBuf) {
  let fs = OverlayFileSystem::new();
  let project_root = std::env::current_dir()
    .unwrap()
    .join("target")
    .join("parcel-source-map-tests");
  fs.create_dir_all(PathId::new(&project_root)).unwrap();
  write_fixture(&fs, &project_root.join("index.html"), INDEX_HTML);
  write_fixture(&fs, &project_root.join("index.mjs"), INDEX_JS);
  write_fixture(&fs, &project_root.join("dep.mjs"), DEP_JS);
  (fs, project_root)
}

fn write_fixture(fs: &OverlayFileSystem, path: &Path, contents: &str) {
  fs.create_dir_all(PathId::new(path.parent().unwrap()))
    .unwrap();
  fs.write(PathId::new(path), &contents.as_bytes().to_vec())
    .unwrap();
}

fn assert_generated_token_maps_to_original(
  bundles: &[(String, String)],
  token: &str,
  expected_source: &str,
  expected_source_content: &str,
) {
  let literal = format!("\"{token}\"");
  assert_token_maps_to(
    bundles,
    token,
    &literal,
    expected_source,
    expected_source_content,
  );
}

/// Asserts that `token` in the generated code maps to `original_token` in `expected_source`.
fn assert_token_maps_to(
  bundles: &[(String, String)],
  token: &str,
  original_token: &str,
  expected_source: &str,
  expected_source_content: &str,
) {
  let (generated_code, source_map) = bundles
    .iter()
    .find(|(code, _)| code.contains(token))
    .unwrap_or_else(|| panic!("Could not find {token:?} in any generated JS bundle"));
  let (generated_line, generated_column) = generated_string_position(generated_code, token);
  let mapping = find_mapping(source_map, generated_line, generated_column).unwrap_or_else(|| {
    panic!(
      "Could not find mapping for generated token {token:?} at {generated_line}:{generated_column}"
    )
  });
  let (original_line, original_column) = original_position(expected_source_content, original_token);

  assert!(
    mapping.source.ends_with(expected_source),
    "Expected {token:?} to map to {expected_source:?}, got {:?}",
    mapping.source
  );
  assert_eq!(
    mapping.original_line, original_line,
    "{token:?} original line"
  );
  assert_eq!(
    mapping.original_column, original_column,
    "{token:?} original column"
  );
  assert_eq!(
    mapping.source_content, expected_source_content,
    "{token:?} source content"
  );
}

fn original_position(code: &str, token: &str) -> (u32, u32) {
  position(code, token, "original")
}

fn generated_string_position(code: &str, token: &str) -> (u32, u32) {
  let offset = code
    .find(token)
    .unwrap_or_else(|| panic!("Could not find {token:?} in generated code:\n{code}"));
  let lookup_offset = code[..offset]
    .chars()
    .next_back()
    .filter(|c| *c == '"' || *c == '\'')
    .map_or(offset, |quote| offset - quote.len_utf8());
  line_column_for_offset(code, lookup_offset)
}

fn position(code: &str, token: &str, label: &str) -> (u32, u32) {
  let offset = code
    .find(token)
    .unwrap_or_else(|| panic!("Could not find {token:?} in {label} code:\n{code}"));
  line_column_for_offset(code, offset)
}

fn line_column_for_offset(code: &str, offset: usize) -> (u32, u32) {
  let mut line = 0;
  let mut column = 0;
  for c in code[..offset].chars() {
    if c == '\n' {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  (line, column)
}

fn find_mapping(source_map: &str, generated_line: u32, generated_column: u32) -> Option<Mapping> {
  let mut mappings = Vec::new();
  let value: serde_json::Value = serde_json::from_str(source_map).unwrap();

  // `sources` are relative to the project root, so maps point to it (see `bundle_source_root`).
  let assert_source_root = |map: &serde_json::Value| {
    assert!(
      map["sourceRoot"]
        .as_str()
        .is_some_and(|root| root.ends_with('/')),
      "missing sourceRoot: {map}"
    );
  };

  if value.get("sections").is_some() {
    // Node only applies index maps with top-level `sources` (see `SourceMapIndex`).
    assert_eq!(value["sources"], serde_json::json!([]));
    let index: SourceMapIndex = serde_json::from_value(value).unwrap();
    for section in index.sections {
      // Empty sections end the module before them.
      if section.map["sources"] == serde_json::json!([]) {
        continue;
      }
      assert_source_root(&section.map);
      let map = SourceMap::from_json("/", &section.map.to_string()).unwrap();
      collect_mappings(
        &mut mappings,
        &map,
        section.offset.line,
        section.offset.column,
      );
    }
  } else {
    assert_source_root(&value);
    let map = SourceMap::from_json("/", source_map).unwrap();
    collect_mappings(&mut mappings, &map, 0, 0);
  }

  mappings.sort_by_key(|mapping| (mapping.generated_line, mapping.generated_column));
  mappings.into_iter().rev().find(|mapping| {
    mapping.generated_line == generated_line && mapping.generated_column <= generated_column
  })
}

fn collect_mappings(
  mappings: &mut Vec<Mapping>,
  map: &SourceMap,
  line_offset: u32,
  column_offset: u32,
) {
  for mapping in map.get_mappings() {
    let Some(original) = mapping.original else {
      continue;
    };
    let absolute_line = line_offset + mapping.generated_line;
    let absolute_column = if mapping.generated_line == 0 {
      column_offset + mapping.generated_column
    } else {
      mapping.generated_column
    };

    mappings.push(Mapping {
      generated_line: absolute_line,
      generated_column: absolute_column,
      source: map.get_source(original.source).unwrap().to_owned(),
      original_line: original.original_line,
      original_column: original.original_column,
      source_content: map.get_source_content(original.source).unwrap().to_owned(),
    });
  }
}

#[derive(serde::Deserialize)]
struct SourceMapIndex {
  sections: Vec<SourceMapSection>,
}

#[derive(serde::Deserialize)]
struct SourceMapSection {
  offset: SourceMapSectionOffset,
  map: serde_json::Value,
}

#[derive(serde::Deserialize)]
struct SourceMapSectionOffset {
  line: u32,
  column: u32,
}

struct Mapping {
  generated_line: u32,
  generated_column: u32,
  source: String,
  original_line: u32,
  original_column: u32,
  source_content: String,
}
