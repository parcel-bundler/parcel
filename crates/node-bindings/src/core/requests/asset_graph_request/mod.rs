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
    target_queue.push(entry.clone());
  }

  while let Some(target) = target_queue.pop() {
    let asset = read_asset(&target)?;
    for dependency in &asset.dependencies {
      target_queue.push(ProjectPath::from(PathBuf::from(
        dependency.specifier.clone(),
      )));
    }

    graph.add_node(asset);
  }

  Ok(RunAssetGraphRequestResult {
    asset_graph: AssetGraph { graph },
  })
}

fn read_asset(target: &ProjectPath) -> anyhow::Result<Asset> {
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
    .map_err(|e| anyhow::anyhow!("Failed to parse file"))?;

  let mut import_visitor = ImportVisitor::default();
  import_visitor.visit_module(&program);

  Ok(Asset {
    path: target.as_ref().to_path_buf(),
    dependencies: vec![],
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
