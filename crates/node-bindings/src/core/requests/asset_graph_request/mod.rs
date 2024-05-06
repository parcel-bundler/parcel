use std::borrow::Cow;
use std::path::Path;
use std::path::PathBuf;

use napi_derive::napi;
use parcel_resolver::Cache;
use parcel_resolver::CacheCow;
use parcel_resolver::OsFileSystem;
use parcel_resolver::Resolution;
use parcel_resolver::ResolveResult;
use parcel_resolver::SpecifierType;
use petgraph::graph::NodeIndex;
use petgraph::Graph;
use swc_common::input::StringInput;
use swc_common::sync::Lrc;
use swc_common::FileName;
use swc_common::SourceMap;
use swc_ecma_ast::{ExportDecl, ExportNamedSpecifier, ExportSpecifier, ImportDecl, ModuleExportName, NamedExport};
use swc_ecma_parser::lexer::Lexer;
use swc_ecma_parser::Parser;
use swc_ecma_parser::Syntax;
use swc_ecma_visit::Visit;

use crate::core::project_path::ProjectPath;

#[napi(object)]
pub struct AssetGraphRequest {
  pub entries: Vec<String>,
  pub name: String,
}

pub struct RunAssetGraphRequestParams<'a> {
  pub asset_graph_request: &'a AssetGraphRequest,
  pub project_root: &'a Path,
}

#[derive(Clone, Debug)]
pub struct Asset {
  path: ProjectPath,
  dependencies: Vec<Dependency>,
}

#[derive(Debug, Clone)]
pub struct Dependency {
  specifier: String,
  specifier_type: SpecifierType,
}

pub struct AssetGraph {
  graph: Graph<AssetGraphNode, ()>,
}

pub struct RunAssetGraphRequestResult {
  pub asset_graph: AssetGraph,
}

#[derive(Debug)]
enum AssetGraphNode {
  Asset(Asset),
  Dependency(Dependency),
}

/// // 'root.js'
/// import './something.js'
enum WorkItem {
  VisitAsset {
    /// Where you're resolving from either the root or another asset
    source: PathBuf,
    /// This is the path
    specifier: String,
    /// if this asset is a dependency pending resolution/transform, this is the
    /// dependency index to link to it
    dependency_index: Option<NodeIndex>,
  },
}

/// Asset graph request builds the dependency graph of assets on a subtree
pub fn run_asset_graph_request(
  RunAssetGraphRequestParams {
    asset_graph_request,
    project_root,
  }: RunAssetGraphRequestParams,
) -> anyhow::Result<RunAssetGraphRequestResult> {
  let mut target_queue: Vec<WorkItem> = vec![];
  for entry in &asset_graph_request.entries {
    target_queue.push(WorkItem::VisitAsset {
      source: project_root.into(),
      specifier: entry.clone(),
      dependency_index: None,
    });
  }

  let fs = OsFileSystem::default();
  let resolver =
    parcel_resolver::Resolver::parcel(Cow::Borrowed(project_root), CacheCow::Owned(Cache::new(fs)));

  let mut graph = Graph::new();
  while let Some(WorkItem::VisitAsset {
    source,
    specifier: target,
    dependency_index,
  }) = target_queue.pop()
  {
    println!("Visiting asset: {:?}", target);
    let ResolveResult { result, .. } =
      resolver.resolve(&target, &Path::new(&source), SpecifierType::Esm);

    match result {
      Ok((Resolution::Path(target), _)) => {
        // production quality version of `read_asset`
        // https://product-fabric.atlassian.net/browse/AFB-367
        let asset = transform_asset(project_root, &target)?;

        let asset_index = graph.add_node(AssetGraphNode::Asset(asset.clone()));
        if let Some(parent_index) = dependency_index {
          graph.add_edge(parent_index, asset_index, ());
        }

        for dependency in &asset.dependencies {
          let dependency_index = graph.add_node(AssetGraphNode::Dependency(dependency.clone()));
          graph.add_edge(asset_index, dependency_index, ());

          target_queue.push(WorkItem::VisitAsset {
            source: target.clone(),
            specifier: dependency.specifier.clone(),
            dependency_index: Some(dependency_index),
          });
        }
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

fn transform_asset(project_root: &Path, target: &Path) -> anyhow::Result<Asset> {
  println!("Reading asset: {:?}", target);
  let contents = std::fs::read_to_string(&target)?;

  let cm: Lrc<SourceMap> = Default::default();
  let file_name = FileName::Real(target.to_path_buf());
  let source_file = cm.new_source_file(file_name, contents.into());
  let syntax = Syntax::Es(Default::default());
  let lexer = Lexer::new(
    // We want to parse ecmascript
    syntax,
    // EsVersion defaults to es5
    Default::default(),
    StringInput::from(&*source_file),
    None,
  );
  let mut parser = Parser::new_from(lexer);
  let program = parser
    .parse_module()
    .map_err(|_err| anyhow::anyhow!("Failed to parse file"))?;

  println!("Parsed module: {:#?}", program);

  let mut import_visitor = ImportVisitor::default();
  import_visitor.visit_module(&program);

  println!("project_root={:?} target={:?}", project_root, &target);
  Ok(Asset {
    path: ProjectPath::new(project_root, &target)?,
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

  fn visit_named_export(&mut self, n: &NamedExport) {
    n.src.as_ref().map(|src| {
      self.imports.push(src.value.to_string());
    });
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
    let dir = PathBuf::from(dir);
    assert!(dir.is_absolute());

    let project_root =
      PathBuf::from("../../packages/core/integration-tests/test/integration/js-export-many");
    let project_root = dir.join(project_root).canonicalize().unwrap();
    let file_path = "/index.js".to_string();

    println!("file_path: {:?}", file_path);
    let asset_graph_request = AssetGraphRequest {
      entries: vec![file_path],
      name: "test".to_string(),
    };

    let result = run_asset_graph_request(RunAssetGraphRequestParams {
      asset_graph_request: &asset_graph_request,
      project_root: &project_root,
    })
    .expect("Failed to run asset graph request");
    let dot = petgraph::dot::Dot::new(&result.asset_graph.graph);
    std::fs::write("asset_graph.dot", format!("{:?}", dot)).expect("Failed to write dot file");
    std::process::Command::new("dot")
      .arg("-Tpng")
      .arg("asset_graph.dot")
      .arg("-o")
      .arg("asset_graph.png")
      .output()
      .expect("Failed to run dot command");

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
