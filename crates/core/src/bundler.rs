use std::collections::{HashMap, VecDeque};

use fixedbitset::FixedBitSet;

use crate::{
  AssetType, Bundle, BundleBehavior, BundleFlags, DependencyFlags, DependencyResolution,
  DiagnosticList, EnvironmentContext, ParcelOptions, Priority,
  asset_graph::{AssetGraph, AssetNode},
  bundle_graph::BundleGraph,
  config::{JsPlugin, ParcelConfig},
  namer::name,
};

pub trait Bundler: Send + Sync {
  fn bundle(&self, asset_graph: AssetGraph) -> Result<BundleGraph, DiagnosticList>;
}

impl Bundler for JsPlugin {
  fn bundle(&self, _asset_graph: AssetGraph) -> Result<BundleGraph, DiagnosticList> {
    Err(DiagnosticList(vec![]))
  }
}

pub struct DefaultBundler {}

impl Bundler for DefaultBundler {
  fn bundle(&self, mut asset_graph: AssetGraph) -> Result<BundleGraph, DiagnosticList> {
    let mut bundles = Vec::<Bundle>::new();

    // Step 1: Traverse the asset graph and find bundle roots.
    // A bundle root is created for entries, and lazy, parallel, isolated, or inline dependencies.
    let mut bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    let mut non_entry_bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    for entry in &asset_graph.entries {
      if let Some(asset) = entry.asset {
        bundle_roots.insert(asset);
      }
    }

    for asset_index in 0..asset_graph.assets.len() {
      if let AssetNode::Asset(asset) = &asset_graph.assets[asset_index] {
        if asset.bundle_behavior != BundleBehavior::None {
          bundle_roots.insert(asset_index);
          non_entry_bundle_roots.insert(asset_index);
        }

        for dep in &asset.dependencies {
          if dep.bundle_behavior != BundleBehavior::None || dep.priority != Priority::Sync {
            if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
              bundle_roots.insert(resolved_asset_index as usize);
              non_entry_bundle_roots.insert(resolved_asset_index as usize);
            }
          }
        }
      }
    }

    // reachable_roots is an array of bit sets for each asset. Each bit set
    // indicates which bundle roots are reachable from that asset synchronously.
    let mut reachable_roots =
      vec![FixedBitSet::with_capacity(bundle_roots.count_ones(..)); asset_graph.assets.len()];

    let mut visited = FixedBitSet::with_capacity(asset_graph.assets.len());
    let mut queue = VecDeque::new();
    for (bundle_root_index, bundle_root_asset_index) in bundle_roots.ones().enumerate() {
      visited.clear();
      queue.clear();
      queue.push_back(bundle_root_asset_index);
      visited.insert(bundle_root_asset_index);
      while let Some(asset_index) = queue.pop_front() {
        reachable_roots[asset_index].insert(bundle_root_index);

        if let AssetNode::Asset(asset) = &asset_graph.assets[asset_index] {
          for i in asset.resolved_dependencies() {
            if !visited.contains(i as usize) && !bundle_roots.contains(i as usize) {
              visited.insert(i as usize);
              queue.push_back(i as usize);
            }
          }
        }
      }
    }

    #[derive(Hash, PartialEq, Eq)]
    struct BundleKey<'a> {
      reachable_roots: &'a FixedBitSet,
      context: EnvironmentContext,
      ty: &'a AssetType,
    }

    let mut shared_bundles = HashMap::<BundleKey, usize>::new();
    let mut asset_index_to_bundle_index = HashMap::new();

    // Create bundles for each bundle root first.
    for bundle_root_asset_index in bundle_roots.ones() {
      if let AssetNode::Asset(asset) = &asset_graph.assets[bundle_root_asset_index] {
        let bundle = Bundle {
          ty: asset.ty.clone(),
          env: asset.env.clone(),
          bundle_behavior: asset.bundle_behavior,
          flags: BundleFlags::empty(),
          name: None,
          assets: vec![bundle_root_asset_index],
          entry_assets: vec![bundle_root_asset_index],
          main_entry_asset: Some(bundle_root_asset_index),
          referenced_bundles: Vec::new(),
        };

        let key = BundleKey {
          reachable_roots: &reachable_roots[bundle_root_asset_index],
          context: asset.env.context, // TODO: other environment properties?
          ty: &asset.ty,
        };

        let bundle_index = bundles.len();
        shared_bundles.insert(key, bundle_index);
        asset_index_to_bundle_index.insert(bundle_root_asset_index, bundle_index);
        bundles.push(bundle);
      }
    }

    for entry in &asset_graph.entries {
      if let Some(asset) = entry.asset {
        bundles[asset_index_to_bundle_index[&asset]].flags |=
          BundleFlags::ENTRY | BundleFlags::NEEDS_STABLE_NAME;
      }
    }

    for (asset_index, asset) in asset_graph.assets.iter().enumerate() {
      if bundle_roots.contains(asset_index) || reachable_roots[asset_index].is_clear() {
        continue;
      }

      if let AssetNode::Asset(asset) = asset {
        let key = BundleKey {
          reachable_roots: &reachable_roots[asset_index],
          context: asset.env.context, // TODO: other environment properties?
          ty: &asset.ty,
        };

        let bundle_index = if let Some(bundle_index) = shared_bundles.get_mut(&key) {
          bundles[*bundle_index].assets.push(asset_index);
          *bundle_index
        } else {
          let bundle = Bundle {
            ty: asset.ty.clone(),
            env: asset.env.clone(),
            bundle_behavior: asset.bundle_behavior,
            flags: BundleFlags::empty(),
            name: None,
            assets: vec![asset_index],
            entry_assets: Vec::new(),
            main_entry_asset: None,
            referenced_bundles: Vec::new(),
          };

          let bundle_index = bundles.len();
          shared_bundles.insert(key, bundle_index);
          bundles.push(bundle);
          bundle_index
        };

        // Each reachable root depends on this shared bundle.
        for bundle_root_index in reachable_roots[asset_index].ones() {
          if bundle_root_index != bundle_index {
            bundles[bundle_root_index]
              .referenced_bundles
              .push(bundle_index);
          }
        }
      }
    }

    for asset in asset_graph.assets.iter_mut() {
      if let AssetNode::Asset(asset) = asset {
        for dep in &mut asset.dependencies {
          if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
            if non_entry_bundle_roots.contains(resolved_asset_index as usize) {
              if let Some(bundle_index) =
                asset_index_to_bundle_index.get(&(resolved_asset_index as usize))
              {
                dep.resolution = DependencyResolution::Bundle(*bundle_index as u32);
                if dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME) {
                  bundles[*bundle_index].flags |= BundleFlags::NEEDS_STABLE_NAME;
                }
              }
            }
          }
        }
      }
    }

    // println!("{:?}", bundles);
    Ok(BundleGraph {
      asset_graph,
      bundles,
    })
  }
}

pub fn bundle(
  asset_graph: AssetGraph,
  config: &ParcelConfig,
  options: &ParcelOptions,
) -> Result<BundleGraph, DiagnosticList> {
  let mut bundle_graph = config.bundler.bundle(asset_graph)?;

  for bundle in &mut bundle_graph.bundles {
    // TODO: enforce uniqueness
    let name = name(&bundle_graph.asset_graph, bundle, config, options)?;
    bundle.name = Some(name.into()) // TODO: targets
  }

  Ok(bundle_graph)
}
