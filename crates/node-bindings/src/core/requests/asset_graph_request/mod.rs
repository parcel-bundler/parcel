use std::borrow::Cow;
use std::path::Path;
use std::path::PathBuf;

use napi_derive::napi;
use petgraph::Graph;
use petgraph::graph::NodeIndex;
use swc_common::FileName;
use swc_ecma_ast::ImportDecl;
use swc_ecma_ast::NamedExport;
use swc_ecma_visit::Visit;

use parcel_filesystem::FileSystem;
use parcel_resolver::Cache;
use parcel_resolver::CacheCow;
use parcel_resolver::OsFileSystem;
use parcel_resolver::Resolution;
use parcel_resolver::Resolver;
use parcel_resolver::ResolveResult;
use parcel_resolver::SpecifierType;

use crate::core::project_path::ProjectPath;
use crate::core::requests::asset_graph_request::transformer_actor::transform_asset;

pub mod resolver_actor;
pub mod transformer_actor;

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
enum Request {
  Resolve {
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
  let mut target_queue: Vec<Request> = vec![];
  for entry in &asset_graph_request.entries {
    target_queue.push(Request::Resolve {
      source: project_root.into(),
      specifier: entry.clone(),
      dependency_index: None,
    });
  }

  let fs = OsFileSystem::default();
  let resolver = Resolver::parcel(Cow::Borrowed(project_root), CacheCow::Owned(Cache::new(fs)));

  rayon::spawn(|| {});

  let mut graph = Graph::new();
  while let Some(work_item) = target_queue.pop() {
    match work_item {
      Request::Resolve {
        source,
        specifier: target,
        dependency_index,
      } => run_visit_asset(
        &mut graph,
        &resolver,
        &mut target_queue,
        project_root,
        target,
        source,
        dependency_index,
      )?,
    }
  }

  Ok(RunAssetGraphRequestResult {
    asset_graph: AssetGraph { graph },
  })
}

fn run_visit_asset(
  graph: &mut Graph<AssetGraphNode, ()>,
  resolver: &Resolver<impl FileSystem>,
  target_queue: &mut Vec<Request>,
  project_root: &Path,
  target: String,
  source: PathBuf,
  dependency_index: Option<NodeIndex>,
) -> anyhow::Result<()> {
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

        let _ = target_queue.push(Request::Resolve {
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

  Ok(())
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
  use swc_common::SourceMap;
  use swc_common::sync::Lrc;
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
