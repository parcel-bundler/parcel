use std::borrow::Cow;
use std::path::Path;
use std::path::PathBuf;

use napi_derive::napi;
use swc_common::input::StringInput;
use swc_common::sync::Lrc;
use swc_common::FileName;
use swc_common::SourceMap;
use swc_ecma_ast::ImportDecl;
use swc_ecma_parser::lexer::Lexer;
use swc_ecma_parser::Parser;
use swc_ecma_parser::Syntax;
use swc_ecma_visit::Visit;

use parcel_resolver::Cache;
use parcel_resolver::CacheCow;
use parcel_resolver::OsFileSystem;
use parcel_resolver::Resolution;
use parcel_resolver::ResolveResult;
use parcel_resolver::SpecifierType;

use crate::core::project_path::ProjectPath;

#[napi(object)]
pub struct AssetGraphRequest {
  pub entries: Vec<ProjectPath>,
  pub name: String,
}

pub struct RunAssetGraphRequestParams<'a> {
  pub asset_graph_request: &'a AssetGraphRequest,
  pub project_root: &'a str,
}

pub struct Asset {
  path: PathBuf,
  dependencies: Vec<Dependency>,
}

pub struct Dependency {
  specifier: String,
  specifier_type: SpecifierType,
}

pub struct AssetGraph {
  graph: petgraph::graph::Graph<Asset, ()>,
}

pub struct RunAssetGraphRequestResult {
  pub asset_graph: AssetGraph,
}

/// Asset graph request builds the dependency graph of assets on a subtree
pub fn run_asset_graph_request(
  RunAssetGraphRequestParams {
    asset_graph_request,
    project_root,
  }: RunAssetGraphRequestParams,
) -> anyhow::Result<RunAssetGraphRequestResult> {
  let mut graph = petgraph::graph::Graph::new();

  let mut target_queue = vec![];
  for entry in &asset_graph_request.entries {
    target_queue.push((project_root.to_string(), entry.clone()));
  }

  let fs = OsFileSystem::default();
  let resolver = parcel_resolver::Resolver::parcel(
    Cow::Owned(project_root.to_string().into()),
    CacheCow::Owned(Cache::new(fs)),
  );
  while let Some((source, target)) = target_queue.pop() {
    let ResolveResult { result, .. } = resolver.resolve(
      target.as_ref().to_str().unwrap(),
      &Path::new(&source),
      SpecifierType::Esm,
    );

    match result {
      Ok((Resolution::Path(result), _)) => {
        let asset = read_asset(&result.into())?;
        for dependency in &asset.dependencies {
          target_queue.push((
            target.as_ref().to_str().unwrap().to_string(),
            ProjectPath::from(PathBuf::from(dependency.specifier.clone())),
          ));
        }

        graph.add_node(asset);
      }
      Err(err) => {
        eprintln!("Resolution error: {:?}", err);
      }
      _ => {
        eprintln!("Resolution error: unknown");
      }
    }
  }

  Ok(RunAssetGraphRequestResult {
    asset_graph: AssetGraph { graph },
  })
}

fn read_asset(target: &ProjectPath) -> anyhow::Result<Asset> {
  println!("Reading asset: {:?}", target);
  let contents = std::fs::read_to_string(&target)?;

  let cm: Lrc<SourceMap> = Default::default();
  let file_name = FileName::Real(target.as_ref().to_path_buf());
  let source_file = cm.new_source_file(file_name, contents.into());
  let lexer = Lexer::new(
    // We want to parse ecmascript
    Syntax::Es(Default::default()),
    // EsVersion defaults to es5
    Default::default(),
    StringInput::from(&*source_file),
    None,
  );
  let mut parser = Parser::new_from(lexer);
  let program = parser
    .parse_module()
    .map_err(|_err| anyhow::anyhow!("Failed to parse file"))?;

  println!("Parsed module: {:?}", program);

  let mut import_visitor = ImportVisitor::default();
  import_visitor.visit_module(&program);

  Ok(Asset {
    path: target.as_ref().to_path_buf(),
    dependencies: import_visitor
      .imports
      .iter()
      .map(|specifier| Dependency {
        specifier: specifier.clone(),
        specifier_type: SpecifierType::Esm,
      })
      .collect(),
  })
}

#[derive(Default)]
struct ImportVisitor {
  imports: Vec<String>,
}

impl Visit for ImportVisitor {
  fn visit_import_decl(&mut self, n: &ImportDecl) {
    self.imports.push(n.src.value.to_string());
  }
}

#[cfg(test)]
mod test {
  use swc_common::input::StringInput;
  use swc_common::sync::Lrc;
  use swc_common::SourceMap;
  use swc_ecma_parser::lexer::Lexer;
  use swc_ecma_parser::Parser;
  use swc_ecma_parser::Syntax;

  use super::*;

  #[test]
  fn test_run_asset_graph_request() {
    let dir = env!("CARGO_MANIFEST_DIR");
    let relative_path = PathBuf::from(
      "../../packages/core/integration-tests/test/integration/babel-node-modules/index.js",
    );
    let dir = PathBuf::from(dir);
    let path = dir.join(relative_path);

    let asset_graph_request = AssetGraphRequest {
      entries: vec![ProjectPath::from(path)],
      name: "test".to_string(),
    };

    let project_root = "/";

    let result = run_asset_graph_request(RunAssetGraphRequestParams {
      asset_graph_request: &asset_graph_request,
      project_root,
    })
    .expect("Failed to run asset graph request");

    assert_eq!(result.asset_graph.graph.node_count(), 2);
  }

  #[test]
  fn test_import_visitor() {
    let source = r#"
      import { foo } from 'bar';
      import * as baz from 'qux';
      import quux from 'corge';
    "#;

    let cm: Lrc<SourceMap> = Default::default();
    let file_name = FileName::Custom("test".to_string());
    let source_file = cm.new_source_file(file_name, source.into());
    let lexer = Lexer::new(
      // We want to parse ecmascript
      Syntax::Es(Default::default()),
      // EsVersion defaults to es5
      Default::default(),
      StringInput::from(&*source_file),
      None,
    );
    let mut parser = Parser::new_from(lexer);

    let program: swc_ecma_ast::Module = parser.parse_module().unwrap();
    let mut import_visitor = ImportVisitor::default();
    import_visitor.visit_module(&program);

    assert_eq!(import_visitor.imports, vec!["bar", "qux", "corge"]);
  }
}
