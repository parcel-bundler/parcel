use std::{
  borrow::Cow,
  collections::{HashMap, HashSet},
  sync::Arc,
};

use fixedbitset::FixedBitSet;
use serde::Serialize;

use crate::{
  Asset, AssetFlags, AssetKey, AssetRequest, AssetType, Dependency, DependencyFlags,
  DependencyResolution, DiagnosticList, Entry, Environment, EnvironmentFlags, FileContent,
  InvalidationMap, ParcelOptions, PathId, Priority, SourceLocation, SymbolName, SymbolResolution,
  config::ParcelConfig,
  request::{RequestResult, TransformQueue},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
pub struct AssetNodeIndex(pub u32);

impl AssetNodeIndex {
  #[inline]
  pub fn index(&self) -> usize {
    self.0 as usize
  }

  #[inline]
  pub fn from_index(index: usize) -> AssetNodeIndex {
    AssetNodeIndex(index as u32)
  }
}

impl std::fmt::Display for AssetNodeIndex {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.0.fmt(f)
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
pub struct AssetIndex(pub u32);

impl AssetIndex {
  #[inline]
  pub fn index(&self) -> usize {
    self.0 as usize
  }

  #[inline]
  pub fn from_index(index: usize) -> AssetIndex {
    AssetIndex(index as u32)
  }
}

impl std::fmt::Display for AssetIndex {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.0.fmt(f)
  }
}

#[derive(Debug, Clone)]
pub enum AssetNode {
  Deferred {
    request: Arc<AssetRequest>,
    symbols: Vec<SymbolName>,
    requested: bool,
  },
  Asset(AssetIndex),
}

#[derive(Debug, Clone)]
pub struct AssetGraph<'a> {
  pub asset_nodes: Cow<'a, [AssetNode]>,
  pub assets: Cow<'a, [Asset]>,
  pub entries: Cow<'a, [Entry]>,
}

#[derive(Debug, Clone)]
pub struct AssetGraphBuildResult<'a> {
  pub asset_graph: AssetGraph<'a>,
  pub changed_assets: Vec<AssetIndex>,
}

/// Stateful builder for the asset graph, enabling incremental rebuilds.
///
/// The builder owns the persistent asset graph state across builds. After calling
/// `invalidate()` with the set of changed file paths, the next call to `build()`
/// re-transforms only the affected assets and their transitive dependents.
pub struct AssetGraphBuilder {
  /// The asset graph nodes, monotonically growing across builds.
  asset_nodes: Vec<AssetNode>,
  assets: Vec<Asset>,
  asset_keys: HashMap<AssetKey, AssetIndex>,
  /// Deduplication map: AssetRequest → slot index in `asset_nodes`.
  asset_requests: HashMap<Arc<AssetRequest>, AssetNodeIndex>,
  /// Parallel to `asset_nodes`: the original AssetRequest for each slot.
  /// Used to reset slots back to Deferred during invalidation.
  requests: Vec<Arc<AssetRequest>>,
  /// Reverse invalidation map: which assets to re-transform when a file changes.
  invalidation_map: InvalidationMap,
  /// Entry points. `entry.asset` is set after the first build.
  entries: Vec<Entry>,
  options: Arc<ParcelOptions>,
  queue: TransformQueue,
}

impl AssetGraphBuilder {
  pub fn new(entries: Vec<Entry>, config: Arc<ParcelConfig>, options: Arc<ParcelOptions>) -> Self {
    AssetGraphBuilder {
      asset_nodes: Vec::new(),
      assets: Vec::new(),
      asset_keys: HashMap::new(),
      asset_requests: HashMap::new(),
      requests: Vec::new(),
      invalidation_map: InvalidationMap::default(),
      entries,
      queue: TransformQueue::new(config, options.clone()),
      options,
    }
  }

  /// Marks assets as needing re-transformation based on changed/created file URLs.
  /// `changed` are modified or deleted files; `created` are newly created files.
  /// Call before `build()` to trigger an incremental rebuild.
  pub fn invalidate(&mut self, changed: &[PathId], created: &[PathId]) -> HashSet<AssetNodeIndex> {
    let affected = self.invalidation_map.invalidate(changed, created);

    for index in &affected {
      self.reset_asset(*index);
    }

    affected
  }

  fn reset_asset(&mut self, index: AssetNodeIndex) {
    if let AssetNode::Asset(_) = &self.asset_nodes[index.index()] {
      let request = self.requests[index.index()].clone();
      self.asset_nodes[index.index()] = AssetNode::Deferred {
        request,
        symbols: Vec::new(),
        requested: true,
      };
    }
  }

  /// Builds (or incrementally rebuilds) the asset graph.
  ///
  /// On the first call, performs a full build starting from entries.
  /// On subsequent calls after `invalidate()`, re-transforms only the affected assets.
  ///
  /// Returns a borrowed `AssetGraph` view suitable for bundling.
  pub fn build(&mut self) -> Result<AssetGraph<'_>, DiagnosticList> {
    Ok(self.build_with_changes()?.asset_graph)
  }

  /// Builds the asset graph and reports every asset transformed during this build.
  pub fn build_with_changes(&mut self) -> Result<AssetGraphBuildResult<'_>, DiagnosticList> {
    let mut queue = &mut self.queue;
    let mut changed_assets = Vec::new();

    // Queue entry assets. On the first build, allocate new slots.
    // On subsequent builds, entries already have slots; re-queue if Deferred.
    for entry in &mut self.entries {
      if let Some(index) = entry.asset {
        // Slot exists — only re-queue if it was invalidated (reset to Deferred).
        if let AssetNode::Deferred {
          requested: true,
          request,
          ..
        } = &self.asset_nodes[index.index()]
        {
          queue.transform(index, request.clone());
        }
      } else {
        // Initial build: create the slot.
        let req = Arc::new(AssetRequest {
          loc: SourceLocation {
            url: entry.url.clone(),
            start: Default::default(),
            end: Default::default(),
          },
          ty: AssetType::from_url(&entry.url),
          content: Arc::new(FileContent::new(
            entry.url.to_file_path()?,
            self.options.input_fs.clone(),
          )),
          target: entry.target.clone(),
          pipeline: None,
          side_effects: true, // TODO: resolve this for real?
        });

        let index = AssetNodeIndex::from_index(self.asset_nodes.len());
        self.asset_nodes.push(AssetNode::Deferred {
          request: req.clone(),
          symbols: if entry.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
            vec![SymbolName::Namespace]
          } else {
            Vec::new()
          },
          requested: true,
        });
        self.requests.push(req.clone());
        entry.asset = Some(index);
        self.asset_requests.insert(req.clone(), index);
        queue.transform(index, req);
      }
    }

    // On incremental rebuilds, also re-queue non-entry assets that were invalidated.
    // (Entry assets were handled above; skip them here to avoid double-queuing.)
    let entry_indices: HashSet<AssetNodeIndex> =
      self.entries.iter().filter_map(|e| e.asset).collect();
    for (index, node) in self.asset_nodes.iter().enumerate() {
      let index = AssetNodeIndex::from_index(index);
      if let AssetNode::Deferred {
        requested: true,
        request,
        ..
      } = node
      {
        if !entry_indices.contains(&index) {
          queue.transform(index, request.clone());
        }
      }
    }

    while let Some(result) = queue.receive() {
      match result {
        RequestResult::Transform(res) => {
          // Always record invalidations, even when the transform errored.
          self.invalidation_map.add(res.index, res.invalidations);

          let asset = match res.result {
            Ok(asset) => asset,
            Err(err) => return Err(err),
          };

          let key = asset.key();
          let index = if let Some(&index) = self.asset_keys.get(&key) {
            self.assets[index.index()] = asset;
            index
          } else {
            let index = AssetIndex::from_index(self.assets.len());
            self.assets.push(asset);
            self.asset_keys.insert(key, index);
            index
          };

          changed_assets.push(index);

          let asset = &mut self.assets[index.index()];
          for dep in &mut asset.dependencies {
            let priority = dep.priority;
            if let DependencyResolution::Deferred(req) = &dep.resolution {
              if let Some(&index) = self.asset_requests.get(req) {
                dep.resolution = DependencyResolution::Asset(index);

                // Lazy/parallel deps must be transformed even if the package has sideEffects: false,
                // because the user explicitly requested this module via import().
                if priority != Priority::Sync {
                  if let AssetNode::Deferred {
                    requested, request, ..
                  } = &mut self.asset_nodes[index.index()]
                  {
                    if !*requested {
                      *requested = true;
                      queue.transform(index, request.clone());
                    }
                  }
                }
              } else {
                let req = req.clone();

                // Allocate a new asset slot.
                let index = AssetNodeIndex::from_index(self.asset_nodes.len());
                dep.resolution = DependencyResolution::Asset(index);
                self.asset_requests.insert(req.clone(), index);

                // If the dependency has side effects or is loaded via dynamic import, always transform it.
                let requested = req.side_effects || priority != Priority::Sync;
                self.asset_nodes.push(AssetNode::Deferred {
                  request: req.clone(),
                  symbols: Vec::new(),
                  requested,
                });
                self.requests.push(req.clone());

                if requested {
                  queue.transform(index, req);
                }
              }
            }
          }

          let import_len = asset.symbols.imports.len();
          let prev = std::mem::replace(
            &mut self.asset_nodes[res.index.index()],
            AssetNode::Asset(index),
          );
          let requested_symbols = if let AssetNode::Deferred { symbols, .. } = prev {
            symbols
          } else {
            Vec::new()
          };

          // Propagate the requested symbols for this asset to un-defer dependencies.
          for name in requested_symbols {
            request_symbol(
              &mut self.asset_nodes,
              &mut self.assets,
              res.index,
              name,
              None,
              &mut HashSet::new(),
              &mut queue,
            );
          }

          // Propagate this asset's imported symbols.
          for i in 0..import_len {
            let AssetNode::Asset(asset) = &self.asset_nodes[res.index.index()] else {
              unreachable!()
            };

            let asset = &self.assets[asset.index()];
            let symbol = &asset.symbols.imports[i];
            let dep = &asset.dependencies[symbol.dep_index as usize];
            if let DependencyResolution::Asset(resolved_index) = dep.resolution {
              let name = symbol.symbol.clone();
              let environment = asset.target.environment;
              request_symbol(
                &mut self.asset_nodes,
                &mut self.assets,
                resolved_index,
                name,
                Some(environment),
                &mut HashSet::new(),
                &mut queue,
              );
            }
          }
        }
      }
    }

    // Finalize symbol resolutions for each imported symbol.
    for asset_index in 0..self.asset_nodes.len() {
      if let AssetNode::Asset(asset) = &self.asset_nodes[asset_index] {
        let asset = &self.assets[asset.index()];
        for import_index in 0..asset.symbols.imports.len() {
          let AssetNode::Asset(asset) = &self.asset_nodes[asset_index] else {
            unreachable!()
          };

          let asset = &self.assets[asset.index()];
          let symbol = &asset.symbols.imports[import_index];
          let dep = &asset.dependencies[symbol.dep_index as usize];
          if let DependencyResolution::Asset(resolved_index) = dep.resolution {
            let name = symbol.symbol.clone();
            let environment = asset.target.environment;
            let res = if dep.priority == Priority::Lazy
              && let AssetNode::Asset(asset_index) = &self.asset_nodes[resolved_index.index()]
            {
              SymbolResolution::Runtime {
                asset_index: *asset_index,
                name,
              }
            } else {
              request_symbol(
                &mut self.asset_nodes,
                &mut self.assets,
                resolved_index,
                name.clone(),
                Some(environment),
                &mut HashSet::new(),
                &mut queue,
              )
            };

            let AssetNode::Asset(asset) = &mut self.asset_nodes[asset_index] else {
              unreachable!()
            };

            let asset = &mut self.assets[asset.index()];
            let symbol = &mut asset.symbols.imports[import_index];
            symbol.resolved = res;
          }
        }
      }
    }

    Ok(AssetGraphBuildResult {
      asset_graph: AssetGraph {
        asset_nodes: Cow::Borrowed(&self.asset_nodes),
        assets: Cow::Borrowed(&self.assets),
        entries: Cow::Borrowed(&self.entries),
      },
      changed_assets,
    })
  }

  /// Builds the asset graph and returns owned graph storage.
  ///
  /// This is useful for one-shot builds where the builder will be dropped immediately after
  /// building, so its retained assets and entries can be moved instead of cloned.
  pub fn build_owned(self) -> Result<AssetGraph<'static>, DiagnosticList> {
    Ok(self.build_owned_with_changes()?.asset_graph)
  }

  /// Builds the asset graph, reports transformed assets, and returns owned graph storage.
  pub fn build_owned_with_changes(
    mut self,
  ) -> Result<AssetGraphBuildResult<'static>, DiagnosticList> {
    let changed_assets = self.build_with_changes()?.changed_assets;
    Ok(AssetGraphBuildResult {
      asset_graph: AssetGraph {
        asset_nodes: Cow::Owned(self.asset_nodes),
        assets: Cow::Owned(self.assets),
        entries: Cow::Owned(self.entries),
      },
      changed_assets,
    })
  }
}

/// Abstracts the side effects of symbol resolution so a single ResolveExport traversal
/// can drive both the mutating build-time pass (which marks symbols as requested and
/// queues deferred assets for transformation) and read-only resolution on a completed
/// graph.
trait SymbolGraph {
  fn asset_node(&self, asset_index: AssetNodeIndex) -> &AssetNode;

  fn asset(&self, asset_index: AssetIndex) -> &Asset;

  /// Called when resolution reaches an asset that has not been transformed yet.
  fn resolve_deferred(&mut self, asset_index: AssetNodeIndex, name: SymbolName)
  -> SymbolResolution;

  fn mark_export_requested(&mut self, _asset_index: AssetNodeIndex, _export_index: usize) {}
  fn mark_indirect_requested(&mut self, _asset_index: AssetNodeIndex, _indirect_index: usize) {}
  fn request_all(&mut self, _asset_index: AssetNodeIndex) {}
}

/// Build-time resolution over a graph that is still being constructed.
struct RequestSymbols<'a> {
  asset_nodes: &'a mut Vec<AssetNode>,
  assets: &'a mut Vec<Asset>,
  queue: &'a mut TransformQueue,
}

impl SymbolGraph for RequestSymbols<'_> {
  fn asset_node(&self, asset_index: AssetNodeIndex) -> &AssetNode {
    &self.asset_nodes[asset_index.index()]
  }

  fn asset(&self, asset_index: AssetIndex) -> &Asset {
    &self.assets[asset_index.index()]
  }

  fn resolve_deferred(
    &mut self,
    asset_index: AssetNodeIndex,
    name: SymbolName,
  ) -> SymbolResolution {
    let AssetNode::Deferred {
      request,
      symbols,
      requested,
    } = &mut self.asset_nodes[asset_index.index()]
    else {
      unreachable!()
    };

    symbols.push(name);
    if !*requested {
      *requested = true;
      self.queue.transform(asset_index, request.clone());
    }

    SymbolResolution::Ambiguous
  }

  fn mark_export_requested(&mut self, asset_index: AssetNodeIndex, export_index: usize) {
    let AssetNode::Asset(asset) = &mut self.asset_nodes[asset_index.index()] else {
      unreachable!()
    };
    let asset = &mut self.assets[asset.index()];
    asset.symbols.exports[export_index].requested = true;
  }

  fn mark_indirect_requested(&mut self, asset_index: AssetNodeIndex, indirect_index: usize) {
    let AssetNode::Asset(asset) = &mut self.asset_nodes[asset_index.index()] else {
      unreachable!()
    };
    let asset = &mut self.assets[asset.index()];
    asset.symbols.indirect[indirect_index].requested = true;
  }

  fn request_all(&mut self, asset_index: AssetNodeIndex) {
    request_all(self.asset_nodes, self.assets, asset_index, self.queue);
  }
}

/// Read-only resolution over a completed graph, e.g. during packaging.
struct ResolveSymbols<'a> {
  asset_nodes: &'a [AssetNode],
  assets: &'a [Asset],
}

impl SymbolGraph for ResolveSymbols<'_> {
  fn asset_node(&self, asset_index: AssetNodeIndex) -> &AssetNode {
    &self.asset_nodes[asset_index.index()]
  }

  fn asset(&self, asset_index: AssetIndex) -> &Asset {
    &self.assets[asset_index.index()]
  }

  fn resolve_deferred(
    &mut self,
    _asset_index: AssetNodeIndex,
    _name: SymbolName,
  ) -> SymbolResolution {
    // The asset was never transformed (e.g. side effect free and unused), so its exports
    // are unknown. Matches the build-time resolution for deferred assets.
    SymbolResolution::Ambiguous
  }
}

fn request_symbol(
  asset_nodes: &mut Vec<AssetNode>,
  assets: &mut Vec<Asset>,
  asset_index: AssetNodeIndex,
  name: SymbolName,
  boundary_environment: Option<Environment>,
  resolve_set: &mut HashSet<(AssetNodeIndex, SymbolName)>,
  queue: &mut TransformQueue,
) -> SymbolResolution {
  resolve_symbol(
    &mut RequestSymbols {
      asset_nodes,
      assets,
      queue,
    },
    asset_index,
    name,
    boundary_environment,
    resolve_set,
  )
}

// https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-resolveexport
fn resolve_symbol<G: SymbolGraph>(
  graph: &mut G,
  asset_node_index: AssetNodeIndex,
  name: SymbolName,
  boundary_environment: Option<Environment>,
  resolve_set: &mut HashSet<(AssetNodeIndex, SymbolName)>,
) -> SymbolResolution {
  if !resolve_set.insert((asset_node_index, name.clone())) {
    // Circular.
    return SymbolResolution::None;
  }

  let asset_index = match graph.asset_node(asset_node_index) {
    AssetNode::Deferred { .. } => {
      return graph.resolve_deferred(asset_node_index, name);
    }
    AssetNode::Asset(asset_index) => *asset_index,
  };

  if name == SymbolName::Namespace {
    graph.request_all(asset_node_index);
    return SymbolResolution::Namespace { asset_index };
  }

  let asset = graph.asset(asset_index);
  let is_environment_boundary =
    boundary_environment.is_some_and(|environment| asset.target.environment != environment);

  if let Some(export_index) = asset
    .symbols
    .exports
    .iter()
    .position(|export| export.exported == name)
  {
    graph.mark_export_requested(asset_node_index, export_index);
    return SymbolResolution::Export {
      asset_index,
      export_index: export_index as u32,
    };
  }

  if let Some(indirect_index) = asset
    .symbols
    .indirect
    .iter()
    .position(|export| export.exported == name)
  {
    let export = &asset.symbols.indirect[indirect_index];
    if let DependencyResolution::Asset(resolved_asset_index) =
      asset.dependencies[export.dep_index as usize].resolution
    {
      let imported = export.imported.clone();
      graph.mark_indirect_requested(asset_node_index, indirect_index);
      let resolution = resolve_symbol(
        graph,
        resolved_asset_index,
        imported,
        boundary_environment,
        resolve_set,
      );

      // Preserve the first module on the other side of an environment boundary. This is the
      // public facade used by runtimes such as React client and server references.
      if is_environment_boundary && resolution.asset_index().is_some() {
        return SymbolResolution::Runtime { asset_index, name };
      }

      return resolution;
    } else {
      return SymbolResolution::None;
    }
  }

  let mut star_resolution = SymbolResolution::None;

  // A default export cannot be provided by an export * from "mod" declaration.
  if name != SymbolName::Default {
    for i in 0..asset.symbols.star.len() {
      let asset = graph.asset(asset_index);
      let dep = &asset.dependencies[asset.symbols.star[i].dep_index as usize];
      if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
        let res = resolve_symbol(
          graph,
          resolved_asset_index,
          name.clone(),
          boundary_environment,
          resolve_set,
        );

        match res {
          SymbolResolution::None => continue,
          SymbolResolution::Runtime { .. } => {
            graph.request_all(asset_node_index);
            return SymbolResolution::Runtime { asset_index, name };
          }
          _ => {
            if star_resolution == SymbolResolution::None {
              star_resolution = res;
            } else if star_resolution != res {
              star_resolution = SymbolResolution::Ambiguous;
            }
          }
        }
      }
    }
  }

  let flags = graph.asset(asset_index).flags;

  // If the asset has side effects or non-static exports, resolve at runtime.
  if star_resolution == SymbolResolution::None
    && (flags.contains(AssetFlags::SIDE_EFFECTS) || !flags.contains(AssetFlags::STATIC_EXPORTS))
  {
    graph.request_all(asset_node_index);
    return SymbolResolution::Runtime { asset_index, name };
  }

  if is_environment_boundary && star_resolution.asset_index().is_some() {
    return SymbolResolution::Runtime { asset_index, name };
  }

  star_resolution
}

fn request_all(
  asset_nodes: &mut Vec<AssetNode>,
  assets: &mut Vec<Asset>,
  asset_index: AssetNodeIndex,
  queue: &mut TransformQueue,
) {
  let AssetNode::Asset(asset) = &mut asset_nodes[asset_index.index()] else {
    return;
  };

  let asset = &mut assets[asset.index()];
  if asset.symbols.used_namespace {
    return;
  }

  asset.symbols.used_namespace = true;

  for sym in &mut asset.symbols.exports {
    sym.requested = true;
  }

  for i in 0..asset.symbols.indirect.len() {
    let AssetNode::Asset(asset) = &mut asset_nodes[asset_index.index()] else {
      continue;
    };

    let asset = &mut assets[asset.index()];
    let export = &mut asset.symbols.indirect[i];
    if export.requested {
      continue;
    }

    export.requested = true;

    let dep = &asset.dependencies[export.dep_index as usize];
    if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
      let name = export.imported.clone();
      request_symbol(
        asset_nodes,
        assets,
        resolved_asset_index,
        name,
        None,
        &mut HashSet::new(),
        queue,
      );
    }
  }

  let AssetNode::Asset(asset) = &mut asset_nodes[asset_index.index()] else {
    return;
  };

  let asset = &mut assets[asset.index()];
  for i in 0..asset.symbols.star.len() {
    let AssetNode::Asset(asset) = &mut asset_nodes[asset_index.index()] else {
      continue;
    };

    let asset = &mut assets[asset.index()];
    let export = &mut asset.symbols.star[i];
    if export.requested {
      continue;
    }

    export.requested = true;

    let dep = &asset.dependencies[export.dep_index as usize];
    if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
      request_symbol(
        asset_nodes,
        assets,
        resolved_asset_index,
        SymbolName::Namespace,
        None,
        &mut HashSet::new(),
        queue,
      );
    }
  }
}

impl<'a> AssetGraph<'a> {
  /// Visits all assets in depth-first order starting from each entry. The third element is the
  /// entry's requested dist path, for the entry asset of each entry that has one.
  pub fn dfs<'b>(&'b self) -> impl Iterator<Item = (AssetIndex, &'b Asset, Option<PathId>)> {
    let mut stack = Vec::new();
    let mut visited = FixedBitSet::with_capacity(self.assets.len());
    let mut entries = self.entries.iter();
    let mut first_entry = true;
    let mut entry_index = 0;

    std::iter::from_fn(move || {
      loop {
        if stack.is_empty() {
          while let Some(entry) = entries.next() {
            if first_entry {
              first_entry = false;
            } else {
              entry_index += 1;
            }

            if let Some(index) = self.resolved_entry(entry) {
              if !visited.contains(index.index()) {
                stack.push(index);
                break;
              }
            }
          }
        }

        if stack.is_empty() {
          return None;
        }

        while let Some(index) = stack.pop() {
          if visited.contains(index.index()) {
            continue;
          }

          visited.insert(index.index());
          let asset = &self.assets[index.index()];
          for dep in asset.dependencies.iter().rev() {
            if let Some((index, _)) = self.resolved_asset(dep) {
              if !visited.contains(index.index()) {
                stack.push(index);
              }
            }
          }

          let name = if Some(index) == self.resolved_entry(&self.entries[entry_index]) {
            self.entries[entry_index].dist_entry.clone()
          } else {
            None
          };

          return Some((index, asset, name));
        }
      }
    })
  }

  /// Iterates over all resolved asset indices that this asset depends on, in dependency order.
  /// NOTE: This may include duplicates. self.symbols.imports must be sorted by dep_index.
  pub fn resolved_dependencies(&self, asset: &Asset) -> impl Iterator<Item = AssetIndex> {
    let mut dep_index = 0;
    let mut import_index = 0;
    std::iter::from_fn(move || {
      loop {
        // If a dependency has side effects, emit its resolved asset.
        // If the namespace of this asset is used, include all dependencies.
        // If the dependency is referenced by a used indirect or star export,
        if dep_index < asset.dependencies.len() {
          let dep = &asset.dependencies[dep_index];
          if dep.flags.contains(DependencyFlags::SIDE_EFFECTS)
            || asset.symbols.used_namespace
            // TODO: check
            || asset
              .symbols
              .indirect
              .iter()
              .any(|i| i.dep_index == dep_index as u32 && i.requested)
            || asset
              .symbols
              .star
              .iter()
              .any(|i| i.dep_index == dep_index as u32 && i.requested)
          {
            if let Some((asset, _)) = self.resolved_asset(dep) {
              dep_index += 1;
              return Some(asset);
            }
          }
        }

        // Emit all resolved assets for imported symbols in this dependency.
        // Side-effect free re-exports are not included - they are referenced directly through their importers.
        while import_index < asset.symbols.imports.len() {
          let import = &asset.symbols.imports[import_index];
          if import.dep_index > dep_index as u32 {
            break;
          }

          if let Some(asset) = import.resolved.asset_index() {
            import_index += 1;
            return Some(asset);
          }

          import_index += 1;
        }

        // Continue looping while there are more dependencies.
        if dep_index < asset.dependencies.len() {
          dep_index += 1;
          continue;
        }

        return None;
      }
    })
  }

  // https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-getexportednames
  pub fn get_exports(
    &self,
    asset_index: AssetIndex,
    boundary_environment: Environment,
  ) -> Vec<(SymbolName, SymbolResolution)> {
    fn get_exports(
      asset_graph: &AssetGraph,
      asset_index: AssetIndex,
      boundary_environment: Environment,
      export_star_set: &mut HashSet<AssetIndex>,
    ) -> Vec<(SymbolName, SymbolResolution)> {
      if !export_star_set.insert(asset_index) {
        // We've reached the starting point of an export * circularity.
        return Vec::new();
      }

      let mut exported_names = Vec::new();
      let asset = asset_graph.asset(asset_index);
      let is_environment_boundary = asset.target.environment != boundary_environment;

      for (index, export) in asset.symbols.exports.iter().enumerate() {
        exported_names.push((
          export.exported.clone(),
          SymbolResolution::Export {
            asset_index,
            export_index: index as u32,
          },
        ));
      }

      for export in &asset.symbols.indirect {
        if let DependencyResolution::Asset(resolved) =
          asset.dependencies[export.dep_index as usize].resolution
        {
          let resolved = if is_environment_boundary {
            SymbolResolution::Runtime {
              asset_index,
              name: export.exported.clone(),
            }
          } else {
            asset_graph.resolve_export(resolved, export.imported.clone(), boundary_environment)
          };
          exported_names.push((export.exported.clone(), resolved));
        }
      }

      // Per GetExportedNames, names provided by local or named re-exports take precedence
      // over export *, and conflicting export * declarations of the same name are ambiguous.
      let mut seen: HashMap<SymbolName, usize> = exported_names
        .iter()
        .enumerate()
        .map(|(index, (name, _))| (name.clone(), index))
        .collect();
      let star_start = exported_names.len();

      for star in &asset.symbols.star {
        if let Some((resolved, _)) =
          asset_graph.resolved_asset(&asset.dependencies[star.dep_index as usize])
        {
          let names = get_exports(asset_graph, resolved, boundary_environment, export_star_set);
          for (name, resolution) in names {
            if name != SymbolName::Default {
              let resolution = if is_environment_boundary && resolution.asset_index().is_some() {
                SymbolResolution::Runtime {
                  asset_index,
                  name: name.clone(),
                }
              } else {
                resolution
              };
              match seen.entry(name) {
                std::collections::hash_map::Entry::Occupied(entry) => {
                  let index = *entry.get();
                  if index >= star_start && exported_names[index].1 != resolution {
                    exported_names[index].1 = SymbolResolution::Ambiguous;
                  }
                }
                std::collections::hash_map::Entry::Vacant(entry) => {
                  exported_names.push((entry.key().clone(), resolution));
                  entry.insert(exported_names.len() - 1);
                }
              }
            }
          }
        }
      }

      exported_names
    }

    get_exports(self, asset_index, boundary_environment, &mut HashSet::new())
  }

  // https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-resolveexport
  pub fn resolve_export(
    &self,
    asset_index: AssetNodeIndex,
    name: SymbolName,
    boundary_environment: Environment,
  ) -> SymbolResolution {
    resolve_symbol(
      &mut ResolveSymbols {
        asset_nodes: &self.asset_nodes,
        assets: &self.assets,
      },
      asset_index,
      name,
      Some(boundary_environment),
      &mut HashSet::new(),
    )
  }

  #[inline]
  pub fn resolved_entry(&self, entry: &Entry) -> Option<AssetIndex> {
    entry.asset.and_then(|a| {
      if let AssetNode::Asset(asset) = self.asset_nodes[a.index()] {
        Some(asset)
      } else {
        None
      }
    })
  }

  #[inline]
  pub fn resolved_asset(&self, dep: &Dependency) -> Option<(AssetIndex, &Asset)> {
    if let DependencyResolution::Asset(asset_node_index) = dep.resolution {
      if let AssetNode::Asset(asset_index) = self.asset_nodes[asset_node_index.index()] {
        return Some((asset_index, self.asset(asset_index)));
      }
    }

    None
  }

  #[inline]
  pub fn asset(&'a self, asset_index: AssetIndex) -> &'a Asset {
    &self.assets[asset_index.index()]
  }
}
