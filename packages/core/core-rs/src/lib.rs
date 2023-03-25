use dashmap::DashMap;
use graph::Graph;
use parcel_resolver::{Cache, CacheCow, OsFileSystem, Resolution, Resolver};
use std::{borrow::Cow, path::Path};

use db::{
  Asset, AssetGraphNode, Dependency, DependencyFlags, Environment, EnvironmentContext,
  EnvironmentFlags, OutputFormat, ParcelDb, Priority, SourceType, SpecifierType,
};

mod atomics;
mod db;
mod graph;
mod string_arena;

pub struct Parcel {
  db: ParcelDb,
  resolver: Resolver<'static, OsFileSystem>,
  graph: Graph<AssetGraphNode>,
  nodes_by_asset_id: DashMap<usize, usize>,
}

impl Parcel {
  pub fn new() -> Self {
    Parcel {
      db: ParcelDb::default(),
      resolver: Resolver::parcel(
        Cow::Borrowed(Path::new("/")),
        CacheCow::Owned(Cache::new(OsFileSystem::default())),
      ),
      graph: Graph::new(),
      nodes_by_asset_id: DashMap::new(),
    }
  }

  pub fn run(&self, entry: String) {
    let env = self.db.environment_id(Environment {
      context: EnvironmentContext::Browser,
      output_format: OutputFormat::EsModule,
      source_type: SourceType::Module,
      flags: EnvironmentFlags::empty(),
      loc: None,
    });

    let dep = self.db.create_dependency(Dependency {
      asset_id: None,
      env_id: env,
      specifier: entry,
      specifier_type: SpecifierType::Esm,
      resolve_from: None,
      priority: Priority::Sync,
      bundle_behavior: db::BundleBehavior::None,
      flags: DependencyFlags::ENTRY,
      loc: None,
    });

    let node_id = self.graph.add_node(AssetGraphNode::Dependency(dep));
    self.graph.visit(node_id, |node_id, data| match data {
      AssetGraphNode::Dependency(dep_id) => self.resolve(node_id, *dep_id),
      AssetGraphNode::Asset(asset_id) => self.transform(node_id, *asset_id),
    });

    println!("{:?}", self.graph.len());
    // println!("{:?}", self.db);
  }

  pub fn resolve(&self, node_id: usize, dep_id: usize) {
    let dep = self.db.dependency(dep_id);
    let asset = dep.asset_id.map(|asset_id| self.db.asset(asset_id));
    let from = Path::new(
      asset
        .map(|asset| self.db.file_name(asset.file_id))
        .unwrap_or("/"),
    );
    let (res, _) = self
      .resolver
      .resolve(&dep.specifier, from, parcel_resolver::SpecifierType::Esm)
      .result
      .unwrap();
    // println!("RESOLVE {:?}", dep.specifier);
    match res {
      Resolution::Path(path) => {
        let file_id = self.db.file_id(&path.as_os_str().to_string_lossy());
        let asset_id = self.db.create_asset(Asset {
          file_id,
          env_id: dep.env_id,
          stats: db::AssetStats::default(),
          asset_type: db::AssetType::Js,
          bundle_behavior: db::BundleBehavior::None,
          flags: db::AssetFlags::empty(),
        });
        let asset_node_id = self
          .nodes_by_asset_id
          .entry(asset_id)
          .or_insert_with(|| self.graph.add_node(AssetGraphNode::Asset(asset_id)));
        self.graph.add_edge(0, node_id, *asset_node_id);
      }
      _ => {}
    }
  }

  pub fn transform(&self, node_id: usize, asset_id: usize) {
    let asset = self.db.asset(asset_id);
    let env_id = asset.env_id;
    let filename = self.db.file_name(asset.file_id);
    let code = std::fs::read(filename).unwrap();
    let res = parcel_js_swc_core::transform(parcel_js_swc_core::Config {
      filename: filename.into(),
      code,
      ..Default::default()
    })
    .unwrap();
    // println!("TRANSFORM {:?}", filename);

    res.dependencies.iter().for_each(|dep| {
      let dep_id = self.db.create_dependency(Dependency {
        asset_id: Some(asset_id),
        env_id: env_id, // TODO
        specifier: dep.specifier.to_string(),
        specifier_type: SpecifierType::Esm,
        resolve_from: None,
        priority: Priority::Sync,
        bundle_behavior: db::BundleBehavior::None,
        flags: DependencyFlags::empty(),
        loc: None,
      });
      let dep_node_id = self.graph.add_node(AssetGraphNode::Dependency(dep_id));
      self.graph.add_edge(0, node_id, dep_node_id);
    });
  }
}
