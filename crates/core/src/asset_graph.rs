use std::{
  borrow::Cow,
  collections::{HashMap, HashSet},
  sync::Arc,
};

use fixedbitset::FixedBitSet;
use serde::Serialize;

use crate::{
  Asset, AssetFlags, AssetKey, AssetRequest, AssetRequestKey, AssetType, Dependency,
  DependencyFlags, DependencyResolution, DiagnosticList, Entry, Environment, EnvironmentFlags,
  FileContent, InvalidationMap, ParcelOptions, PathId, Priority, SourceLocation, SymbolName,
  SymbolResolution,
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
pub struct AssetNode {
  pub request: Arc<AssetRequest>,
  pub pending_symbols: Vec<SymbolName>,
  pub requested: bool,
  pub asset: Option<AssetIndex>,
}

impl AssetNode {
  fn deferred(
    request: Arc<AssetRequest>,
    pending_symbols: Vec<SymbolName>,
    requested: bool,
  ) -> Self {
    AssetNode {
      request,
      pending_symbols,
      requested,
      asset: None,
    }
  }

  fn needs_transform(&self) -> bool {
    self.asset.is_none() && self.requested
  }

  fn defer(&mut self) {
    if self.asset.take().is_some() {
      self.pending_symbols.clear();
      self.requested = true;
    }
  }

  fn replace_request(&mut self, request: Arc<AssetRequest>) -> bool {
    if self.request.content.eq(&*request.content) {
      return false;
    }

    self.request = request;
    self.defer();
    true
  }

  fn mark_requested(&mut self) -> bool {
    if self.asset.is_none() && !self.requested {
      self.requested = true;
      true
    } else {
      false
    }
  }

  fn resolve(&mut self, asset: AssetIndex) -> Vec<SymbolName> {
    self.asset = Some(asset);
    std::mem::take(&mut self.pending_symbols)
  }

  fn is_current_request(&self, request: &Arc<AssetRequest>) -> bool {
    Arc::ptr_eq(&self.request, request)
  }

  /// Constructs a synthetic resolved node for an existing asset.
  pub fn from_asset(asset_index: AssetIndex, asset: &Asset) -> Self {
    AssetNode {
      request: Arc::new(AssetRequest {
        loc: asset.loc.clone(),
        ty: asset.ty.clone(),
        pipeline: asset.pipeline.clone(),
        target: asset.target.clone(),
        content: asset.content.clone(),
        side_effects: asset.flags.contains(AssetFlags::SIDE_EFFECTS),
        unique_key: asset.unique_key.clone(),
      }),
      pending_symbols: Vec::new(),
      requested: true,
      asset: Some(asset_index),
    }
  }
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
  assets_by_key: HashMap<AssetKey, AssetIndex>,
  /// Deduplication map: stable request identity (everything but content) → slot index
  /// in `asset_nodes`.
  nodes_by_request: HashMap<AssetRequestKey, AssetNodeIndex>,
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
      assets_by_key: HashMap::new(),
      nodes_by_request: HashMap::new(),
      invalidation_map: InvalidationMap::default(),
      entries,
      queue: TransformQueue::new(config, options.clone()),
      options,
    }
  }

  /// Marks assets as needing re-transformation based on changed/created file URLs.
  /// `changed` are modified or deleted files; `created` are newly created files.
  /// Call before `build()` to trigger an incremental rebuild.
  pub fn invalidate(
    &mut self,
    changed: &[PathId],
    created: &[PathId],
    deleted: &[PathId],
  ) -> HashSet<AssetNodeIndex> {
    let affected = self.invalidation_map.invalidate(changed, created, deleted);

    for node_index in &affected {
      self.reset_asset(*node_index);
    }

    affected
  }

  fn reset_asset(&mut self, node_index: AssetNodeIndex) {
    self.asset_nodes[node_index.index()].defer();
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
    let mut errors: Vec<(AssetNodeIndex, DiagnosticList)> = Vec::new();

    // Ensure every entry has an asset node. Existing entries retain their node across builds.
    for entry in &mut self.entries {
      if entry.asset.is_none() {
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
          unique_key: None,
        });

        let node_index = AssetNodeIndex::from_index(self.asset_nodes.len());
        self.asset_nodes.push(AssetNode::deferred(
          req.clone(),
          if entry.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
            vec![SymbolName::Namespace]
          } else {
            Vec::new()
          },
          true,
        ));
        entry.asset = Some(node_index);
        self.nodes_by_request.insert(req.stable_key(), node_index);
      }
    }

    // Queue all requested nodes that have not been transformed yet, including new entries and
    // nodes deferred by invalidation.
    for (node_offset, node) in self.asset_nodes.iter().enumerate() {
      if node.needs_transform() {
        queue.transform(
          AssetNodeIndex::from_index(node_offset),
          node.request.clone(),
        );
      }
    }

    let mut reachable;
    loop {
      while let Some(request_result) = queue.receive() {
        match request_result {
          RequestResult::Transform(transform_result) => {
            // Discard results that were superseded while in flight: if the node's request
            // was replaced with new content after this transform was queued, a newer
            // transform for the same node is pending and this result is stale.
            if !self.asset_nodes[transform_result.index.index()]
              .is_current_request(&transform_result.req)
            {
              continue;
            }

            // Always record invalidations, even when the transform errored.
            self
              .invalidation_map
              .add(transform_result.index, transform_result.invalidations);

            // Errors are collected rather than returned eagerly: a failed transform only fails
            // the build if the node is still referenced once the graph has settled. This keeps
            // the queue drained and lets e.g. a file deleted together with its last importer's
            // edit rebuild cleanly.
            let asset = match transform_result.result {
              Ok(asset) => asset,
              Err(err) => {
                errors.push((transform_result.index, err));
                continue;
              }
            };

            let key = asset.key();
            let asset_index = if let Some(&asset_index) = self.assets_by_key.get(&key) {
              self.assets[asset_index.index()] = asset;
              asset_index
            } else {
              let asset_index = AssetIndex::from_index(self.assets.len());
              self.assets.push(asset);
              self.assets_by_key.insert(key, asset_index);
              asset_index
            };

            changed_assets.push(asset_index);

            let asset = &mut self.assets[asset_index.index()];
            for dep in &mut asset.dependencies {
              let priority = dep.priority;
              if let DependencyResolution::Deferred(req) = &dep.resolution {
                let req = req.clone();
                if let Some(&node_index) = self.nodes_by_request.get(&req.stable_key()) {
                  dep.resolution = DependencyResolution::Asset(node_index);

                  // Same logical asset. If the content changed (e.g. an inline/macro asset
                  // whose parent emitted a new snapshot), re-transform the node with the new
                  // request; any in-flight transform of the old request is discarded when its
                  // result arrives.
                  // TODO: evaluate if we can avoid having multiple in-flight requests for the same asset in the first place.
                  let node = &mut self.asset_nodes[node_index.index()];
                  if node.replace_request(req.clone()) && node.needs_transform() {
                    queue.transform(node_index, req.clone());
                  }

                  // Side-effectful and lazy/parallel deps must be transformed: matching the
                  // requested-ness a brand-new node would get below. (An existing node can be
                  // unrequested e.g. after its transform failed while unreachable.)
                  if priority != Priority::Sync || req.side_effects {
                    let node = &mut self.asset_nodes[node_index.index()];
                    if node.mark_requested() {
                      queue.transform(node_index, node.request.clone());
                    }
                  }
                } else {
                  // Allocate a new asset slot.
                  let node_index = AssetNodeIndex::from_index(self.asset_nodes.len());
                  dep.resolution = DependencyResolution::Asset(node_index);
                  self.nodes_by_request.insert(req.stable_key(), node_index);

                  // If the dependency has side effects or is loaded via dynamic import, always transform it.
                  let requested = req.side_effects || priority != Priority::Sync;
                  self
                    .asset_nodes
                    .push(AssetNode::deferred(req.clone(), Vec::new(), requested));

                  if requested {
                    queue.transform(node_index, req);
                  }
                }
              }
            }

            let import_len = asset.symbols.imports.len();
            let node = &mut self.asset_nodes[transform_result.index.index()];
            let pending_symbols = node.resolve(asset_index);

            // Propagate the requested symbols for this asset to un-defer dependencies.
            for name in pending_symbols {
              request_symbol(
                &mut self.asset_nodes,
                &mut self.assets,
                transform_result.index,
                name,
                None,
                &mut HashSet::new(),
                &mut queue,
              );
            }

            // Propagate this asset's imported symbols.
            for import_index in 0..import_len {
              let asset_index = self.asset_nodes[transform_result.index.index()]
                .asset
                .unwrap();
              let asset = &self.assets[asset_index.index()];
              let symbol = &asset.symbols.imports[import_index];
              let dep = &asset.dependencies[symbol.dep_index as usize];
              if let DependencyResolution::Asset(resolved_node_index) = dep.resolution {
                let name = symbol.symbol.clone();
                let environment = asset.target.environment;
                request_symbol(
                  &mut self.asset_nodes,
                  &mut self.assets,
                  resolved_node_index,
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

      reachable = reachable_nodes(&self.asset_nodes, &self.assets, &self.entries);

      // Recompute symbol request state from scratch. Requests recorded during previous builds
      // may no longer exist — a symbol dropped from an unchanged module's import list, or an
      // importer that became unreachable — and stale `requested` flags would keep dead exports
      // alive. Resetting and re-deriving from the entries and every reachable asset's imports
      // makes the request state identical to what a fresh build would compute.
      //
      // This must happen AFTER the transform queue has drained, not at the start of the build,
      // so that the final flags are a pure function of the settled asset graph. During the
      // drain, `request_symbol` calls propagate from each transform result as it arrives; their
      // flag marks can be stale by the end of the build, because a result that was current when
      // processed may later be superseded within the same build (`replace_request` — e.g. an
      // inline or macro asset whose own invalidation queued it with last build's content before
      // its re-transformed parent supplied the new content). Whether the superseded result's
      // propagation ran at all depends on worker scheduling, so marks made during the drain are
      // nondeterministic; resetting here wipes them and re-derives deterministically. The drain-
      // time propagation still matters for its other side effect: queueing deferred transforms
      // while the queue is live. If we ever guarantee a node cannot be transformed twice in one
      // build (see the TODO on `replace_request` above), the reset could move to the start of
      // the build and the library entry re-request could merge into the entry loop.
      for asset in self.assets.iter_mut() {
        asset.symbols.used_namespace = false;
        for export in &mut asset.symbols.exports {
          export.requested = false;
        }
        for indirect in &mut asset.symbols.indirect {
          indirect.requested = false;
        }
        for star in &mut asset.symbols.star {
          star.requested = false;
        }
      }

      // Library entries request their entire namespace (originally requested via the entry
      // node's pending symbols on the first build).
      for entry_index in 0..self.entries.len() {
        let entry = &self.entries[entry_index];
        if !entry.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
          continue;
        }
        let Some(node_index) = entry.asset else {
          continue;
        };
        request_symbol(
          &mut self.asset_nodes,
          &mut self.assets,
          node_index,
          SymbolName::Namespace,
          None,
          &mut HashSet::new(),
          &mut queue,
        );
      }

      // Finalize symbol resolutions for each imported symbol. Because the request state was
      // reset above, resolving here also re-marks the requested flags for every import.
      for node_offset in 0..self.asset_nodes.len() {
        if !reachable.contains(&AssetNodeIndex::from_index(node_offset)) {
          continue;
        }
        if let Some(asset_index) = self.asset_nodes[node_offset].asset {
          let asset = &self.assets[asset_index.index()];
          for import_index in 0..asset.symbols.imports.len() {
            let asset_index = self.asset_nodes[node_offset].asset.unwrap();
            let asset = &self.assets[asset_index.index()];
            let symbol = &asset.symbols.imports[import_index];
            let dep = &asset.dependencies[symbol.dep_index as usize];
            if let DependencyResolution::Asset(resolved_node_index) = dep.resolution {
              let name = symbol.symbol.clone();
              let environment = asset.target.environment;
              let priority = dep.priority;
              let requested = request_symbol(
                &mut self.asset_nodes,
                &mut self.assets,
                resolved_node_index,
                name.clone(),
                Some(environment),
                &mut HashSet::new(),
                &mut queue,
              );
              // Lazy imports resolve at runtime, but the request above still marks the
              // target's symbols as used so its dependencies are packaged.
              let resolution = if priority == Priority::Lazy
                && let Some(asset_index) = self.asset_nodes[resolved_node_index.index()].asset
              {
                SymbolResolution::Runtime { asset_index, name }
              } else {
                requested
              };

              let asset_index = self.asset_nodes[node_offset].asset.unwrap();
              let asset = &mut self.assets[asset_index.index()];
              let symbol = &mut asset.symbols.imports[import_index];
              symbol.resolved = resolution;
            }
          }
        }
      }

      // Re-deriving requests can queue transforms for assets that were never needed before
      // (e.g. a re-transformed module gained an `export *` of a side-effect-free module).
      // Process them and derive again until the graph is stable.
      if !queue.has_pending() {
        break;
      }
    }

    if !errors.is_empty() {
      // Report errors only for nodes still reachable from an entry. A node whose file was
      // deleted after everything stopped referencing it is no longer part of the build; it is
      // left untransformed and unrequested so it is only re-queued if referenced again.
      let mut reachable_errors = DiagnosticList(Vec::new());
      for (node_index, err) in errors {
        // TODO: if we didn't transform unreachable nodes in the first place this wouldn't happen
        if reachable.contains(&node_index) {
          reachable_errors.0.extend(err.0);
        } else {
          self.asset_nodes[node_index.index()].requested = false;
        }
      }
      if !reachable_errors.0.is_empty() {
        return Err(reachable_errors);
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

/// The set of asset nodes reachable from the entries through resolved dependencies.
fn reachable_nodes(
  asset_nodes: &[AssetNode],
  assets: &[Asset],
  entries: &[Entry],
) -> HashSet<AssetNodeIndex> {
  let mut visited = HashSet::new();
  let mut stack: Vec<AssetNodeIndex> = entries.iter().filter_map(|e| e.asset).collect();
  while let Some(node_index) = stack.pop() {
    if !visited.insert(node_index) {
      continue;
    }
    if let Some(asset_index) = asset_nodes[node_index.index()].asset {
      for dep in &assets[asset_index.index()].dependencies {
        if let DependencyResolution::Asset(target) = dep.resolution {
          stack.push(target);
        }
      }
    }
  }
  visited
}

/// Abstracts the side effects of symbol resolution so a single ResolveExport traversal
/// can drive both the mutating build-time pass (which marks symbols as requested and
/// queues deferred assets for transformation) and read-only resolution on a completed
/// graph.
trait SymbolGraph {
  fn asset_node(&self, node_index: AssetNodeIndex) -> &AssetNode;

  fn asset(&self, asset_index: AssetIndex) -> &Asset;

  /// Called when resolution reaches an asset that has not been transformed yet.
  fn resolve_deferred(&mut self, node_index: AssetNodeIndex, name: SymbolName) -> SymbolResolution;

  fn mark_export_requested(&mut self, _node_index: AssetNodeIndex, _export_index: usize) {}
  fn mark_indirect_requested(&mut self, _node_index: AssetNodeIndex, _indirect_index: usize) {}
  fn request_all(&mut self, _node_index: AssetNodeIndex) {}
}

/// Build-time resolution over a graph that is still being constructed.
struct RequestSymbols<'a> {
  asset_nodes: &'a mut [AssetNode],
  assets: &'a mut [Asset],
  queue: &'a mut TransformQueue,
}

impl SymbolGraph for RequestSymbols<'_> {
  fn asset_node(&self, node_index: AssetNodeIndex) -> &AssetNode {
    &self.asset_nodes[node_index.index()]
  }

  fn asset(&self, asset_index: AssetIndex) -> &Asset {
    &self.assets[asset_index.index()]
  }

  fn resolve_deferred(&mut self, node_index: AssetNodeIndex, name: SymbolName) -> SymbolResolution {
    let node = &mut self.asset_nodes[node_index.index()];
    debug_assert!(node.asset.is_none());

    node.pending_symbols.push(name);
    if node.mark_requested() {
      self.queue.transform(node_index, node.request.clone());
    }

    SymbolResolution::Ambiguous
  }

  fn mark_export_requested(&mut self, node_index: AssetNodeIndex, export_index: usize) {
    let asset_index = self.asset_nodes[node_index.index()].asset.unwrap();
    let asset = &mut self.assets[asset_index.index()];
    asset.symbols.exports[export_index].requested = true;
  }

  fn mark_indirect_requested(&mut self, node_index: AssetNodeIndex, indirect_index: usize) {
    let asset_index = self.asset_nodes[node_index.index()].asset.unwrap();
    let asset = &mut self.assets[asset_index.index()];
    asset.symbols.indirect[indirect_index].requested = true;
  }

  fn request_all(&mut self, node_index: AssetNodeIndex) {
    request_all(self.asset_nodes, self.assets, node_index, self.queue);
  }
}

/// Read-only resolution over a completed graph, e.g. during packaging.
struct ResolveSymbols<'a> {
  asset_nodes: &'a [AssetNode],
  assets: &'a [Asset],
}

impl SymbolGraph for ResolveSymbols<'_> {
  fn asset_node(&self, node_index: AssetNodeIndex) -> &AssetNode {
    &self.asset_nodes[node_index.index()]
  }

  fn asset(&self, asset_index: AssetIndex) -> &Asset {
    &self.assets[asset_index.index()]
  }

  fn resolve_deferred(
    &mut self,
    _node_index: AssetNodeIndex,
    _name: SymbolName,
  ) -> SymbolResolution {
    // The asset was never transformed (e.g. side effect free and unused), so its exports
    // are unknown. Matches the build-time resolution for deferred assets.
    SymbolResolution::Ambiguous
  }
}

fn request_symbol(
  asset_nodes: &mut [AssetNode],
  assets: &mut [Asset],
  node_index: AssetNodeIndex,
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
    node_index,
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

  let Some(asset_index) = graph.asset_node(asset_node_index).asset else {
    return graph.resolve_deferred(asset_node_index, name);
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
    let dep_index = export.dep_index;
    let imported = export.imported.clone();
    // Preserve the re-export even when its dependency is external and cannot be followed.
    graph.mark_indirect_requested(asset_node_index, indirect_index);

    let asset = graph.asset(asset_index);
    if let DependencyResolution::Asset(resolved_asset_index) =
      asset.dependencies[dep_index as usize].resolution
    {
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
  asset_nodes: &mut [AssetNode],
  assets: &mut [Asset],
  node_index: AssetNodeIndex,
  queue: &mut TransformQueue,
) {
  let Some(asset_index) = asset_nodes[node_index.index()].asset else {
    return;
  };

  let asset = &mut assets[asset_index.index()];
  if asset.symbols.used_namespace {
    return;
  }

  asset.symbols.used_namespace = true;

  for sym in &mut asset.symbols.exports {
    sym.requested = true;
  }

  for indirect_index in 0..asset.symbols.indirect.len() {
    let Some(asset_index) = asset_nodes[node_index.index()].asset else {
      continue;
    };

    let asset = &mut assets[asset_index.index()];
    let export = &mut asset.symbols.indirect[indirect_index];
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

  let Some(asset_index) = asset_nodes[node_index.index()].asset else {
    return;
  };

  let asset = &mut assets[asset_index.index()];
  for star_index in 0..asset.symbols.star.len() {
    let Some(asset_index) = asset_nodes[node_index.index()].asset else {
      continue;
    };

    let asset = &mut assets[asset_index.index()];
    let export = &mut asset.symbols.star[star_index];
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
    entry.asset.and_then(|a| self.asset_nodes[a.index()].asset)
  }

  #[inline]
  pub fn resolved_asset(&self, dep: &Dependency) -> Option<(AssetIndex, &Asset)> {
    if let DependencyResolution::Asset(asset_node_index) = dep.resolution {
      if let Some(asset_index) = self.asset_nodes[asset_node_index.index()].asset {
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
