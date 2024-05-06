use std::path::{Path, PathBuf};

use swc_common::{FileName, SourceMap};
use swc_common::input::StringInput;
use swc_common::sync::Lrc;
use swc_ecma_parser::{Parser, Syntax};
use swc_ecma_parser::lexer::Lexer;
use swc_ecma_visit::Visit;

use parcel_resolver::SpecifierType;

use crate::core::project_path::ProjectPath;
use crate::core::requests::actor::Actor;
use crate::core::requests::asset_graph_request::{Asset, Dependency, ImportVisitor};

enum TransformerMessage {
  TransformAsset {
    project_root: PathBuf,
    target: PathBuf,
  },
}

struct TransformerActor {}

impl TransformerActor {
  pub fn new() -> Self {
    Self {}
  }
}

impl Actor for TransformerActor {
  type Message = TransformerMessage;
  type Response = ();

  async fn handle(&mut self, message: Self::Message) -> anyhow::Result<Self::Response> {
    let TransformerMessage::TransformAsset { project_root, target } = message;
    let asset = transform_asset(&project_root, &target)?;

    Ok(())
  }
}

pub fn transform_asset(project_root: &Path, target: &Path) -> anyhow::Result<Asset> {
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

