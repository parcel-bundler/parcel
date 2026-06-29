use std::{
  borrow::Cow,
  collections::{HashMap, HashSet},
  sync::Arc,
};

use fixedbitset::FixedBitSet;

use crate::{
  Asset, AssetFlags, AssetRequest, AssetType, DependencyResolution, DiagnosticList, Entry,
  EnvironmentFlags, FileContent, InvalidationMap, ParcelOptions, PathId, Priority, SourceLocation,
  SymbolName, SymbolResolution,
  config::ParcelConfig,
  request::{RequestResult, TransformQueue},
};

#[derive(Debug, Clone)]
pub enum AssetNode {
  Deferred {
    request: Arc<AssetRequest>,
    symbols: Vec<SymbolName>,
    requested: bool,
  },
  Asset(Asset),
}

impl AssetNode {
  pub fn expect_asset(&self) -> &Asset {
    match self {
      AssetNode::Asset(asset) => asset,
      _ => unreachable!(),
    }
  }
}

#[derive(Debug, Clone)]
pub struct AssetGraph<'a> {
  pub assets: Cow<'a, [AssetNode]>,
  pub entries: Cow<'a, [Entry]>,
}

#[derive(Debug, Clone)]
pub struct AssetGraphBuildResult<'a> {
  pub asset_graph: AssetGraph<'a>,
  pub changed_assets: HashSet<usize>,
}

/// Stateful builder for the asset graph, enabling incremental rebuilds.
///
/// The builder owns the persistent asset graph state across builds. After calling
/// `invalidate()` with the set of changed file paths, the next call to `build()`
/// re-transforms only the affected assets and their transitive dependents.
pub struct AssetGraphBuilder {
  /// The asset graph nodes, monotonically growing across builds.
  assets: Vec<AssetNode>,
  /// Deduplication map: AssetRequest → slot index in `assets`.
  asset_requests: HashMap<Arc<AssetRequest>, usize>,
  /// Parallel to `assets`: the original AssetRequest for each slot.
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
      assets: Vec::new(),
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
  pub fn invalidate(&mut self, changed: &[PathId], created: &[PathId]) -> HashSet<usize> {
    let affected = self.invalidation_map.invalidate(changed, created);

    for index in &affected {
      self.reset_asset(*index);
    }

    affected
  }

  fn reset_asset(&mut self, index: usize) {
    if let AssetNode::Asset(_) = &self.assets[index] {
      let request = self.requests[index].clone();
      self.assets[index] = AssetNode::Deferred {
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
    let mut changed_assets = HashSet::new();

    // Queue entry assets. On the first build, allocate new slots.
    // On subsequent builds, entries already have slots; re-queue if Deferred.
    for entry in &mut self.entries {
      if let Some(index) = entry.asset {
        // Slot exists — only re-queue if it was invalidated (reset to Deferred).
        if let AssetNode::Deferred {
          requested: true,
          request,
          ..
        } = &self.assets[index]
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
          side_effects: true,
        });

        let index = self.assets.len();
        self.assets.push(AssetNode::Deferred {
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
    let entry_indices: HashSet<usize> = self.entries.iter().filter_map(|e| e.asset).collect();
    for (index, node) in self.assets.iter().enumerate() {
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
          changed_assets.insert(res.index);

          // Always record invalidations, even when the transform errored.
          self.invalidation_map.add(res.index, res.invalidations);

          let mut asset = match res.result {
            Ok(asset) => asset,
            Err(err) => return Err(err),
          };

          for dep in &mut asset.dependencies {
            let priority = dep.priority;
            if let DependencyResolution::Deferred(req) = &dep.resolution {
              if let Some(&index) = self.asset_requests.get(req) {
                dep.resolution = DependencyResolution::Asset(index as u32);

                // Lazy/parallel deps must be transformed even if the package has sideEffects: false,
                // because the user explicitly requested this module via import().
                if priority != Priority::Sync {
                  if let AssetNode::Deferred {
                    requested, request, ..
                  } = &mut self.assets[index]
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
                let index = self.assets.len();
                dep.resolution = DependencyResolution::Asset(index as u32);
                self.asset_requests.insert(req.clone(), index);

                // If the dependency has side effects or is loaded via dynamic import, always transform it.
                let requested = req.side_effects || priority != Priority::Sync;
                self.assets.push(AssetNode::Deferred {
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
          let prev = std::mem::replace(&mut self.assets[res.index], AssetNode::Asset(asset));
          let requested_symbols = if let AssetNode::Deferred { symbols, .. } = prev {
            symbols
          } else {
            Vec::new()
          };

          // Propagate the requested symbols for this asset to un-defer dependencies.
          for name in requested_symbols {
            request_symbol(
              &mut self.assets,
              res.index as u32,
              name,
              &mut HashSet::new(),
              &mut queue,
            );
          }

          // Propagate this asset's imported symbols.
          for i in 0..import_len {
            let AssetNode::Asset(asset) = &self.assets[res.index] else {
              unreachable!()
            };

            let symbol = &asset.symbols.imports[i];
            let dep = &asset.dependencies[symbol.dep_index as usize];
            if let DependencyResolution::Asset(resolved_index) = dep.resolution {
              let name = symbol.symbol.clone();
              request_symbol(
                &mut self.assets,
                resolved_index,
                name,
                &mut HashSet::new(),
                &mut queue,
              );
            }
          }
        }
      }
    }

    // Finalize symbol resolutions for each imported symbol.
    for asset_index in 0..self.assets.len() {
      if let AssetNode::Asset(asset) = &self.assets[asset_index] {
        for import_index in 0..asset.symbols.imports.len() {
          let AssetNode::Asset(asset) = &self.assets[asset_index] else {
            unreachable!()
          };

          let symbol = &asset.symbols.imports[import_index];
          let dep = &asset.dependencies[symbol.dep_index as usize];
          if let DependencyResolution::Asset(resolved_index) = dep.resolution {
            let name = symbol.symbol.clone();
            let res = if dep.priority == Priority::Lazy {
              SymbolResolution::Runtime {
                asset_index: resolved_index,
                name,
              }
            } else {
              request_symbol(
                &mut self.assets,
                resolved_index,
                name.clone(),
                &mut HashSet::new(),
                &mut queue,
              )
            };

            let AssetNode::Asset(asset) = &mut self.assets[asset_index] else {
              unreachable!()
            };

            let symbol = &mut asset.symbols.imports[import_index];
            symbol.resolved = res;
          }
        }
      }
    }

    Ok(AssetGraphBuildResult {
      asset_graph: AssetGraph {
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
        assets: Cow::Owned(self.assets),
        entries: Cow::Owned(self.entries),
      },
      changed_assets,
    })
  }
}

// https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-resolveexport
fn request_symbol(
  assets: &mut Vec<AssetNode>,
  asset_index: u32,
  name: SymbolName,
  resolve_set: &mut HashSet<(u32, SymbolName)>,
  queue: &mut TransformQueue,
) -> SymbolResolution {
  if !resolve_set.insert((asset_index, name.clone())) {
    // Circular.
    return SymbolResolution::None;
  }

  let asset_node = &mut assets[asset_index as usize];
  let asset = match asset_node {
    AssetNode::Asset(asset) => asset,
    AssetNode::Deferred {
      request,
      symbols,
      requested,
    } => {
      symbols.push(name);
      if !*requested {
        *requested = true;
        queue.transform(asset_index as usize, request.clone());
      }
      return SymbolResolution::None;
    }
  };

  if name == SymbolName::Namespace {
    request_all(assets, asset_index, queue);
    return SymbolResolution::Namespace { asset_index };
  }

  for (export_index, export) in asset.symbols.exports.iter_mut().enumerate() {
    if export.exported == name {
      export.requested = true;
      return SymbolResolution::Export {
        asset_index,
        export_index: export_index as u32,
      };
    }
  }

  for export in &mut asset.symbols.indirect {
    if export.exported == name {
      let dep = &asset.dependencies[export.dep_index as usize];
      if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
        export.requested = true;
        let imported = export.imported.clone();
        return request_symbol(assets, resolved_asset_index, imported, resolve_set, queue);
      } else {
        return SymbolResolution::None;
      }
    }
  }

  let mut star_resolution = SymbolResolution::None;

  // A default export cannot be provided by an export * from "mod" declaration.
  if name != SymbolName::Default {
    for i in 0..asset.symbols.star.len() {
      let AssetNode::Asset(asset) = &assets[asset_index as usize] else {
        unreachable!()
      };

      let dep = &asset.dependencies[asset.symbols.star[i].dep_index as usize];
      if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
        let res = request_symbol(
          assets,
          resolved_asset_index,
          name.clone(),
          resolve_set,
          queue,
        );

        match res {
          SymbolResolution::None => continue,
          SymbolResolution::Ambiguous => return res,
          SymbolResolution::Runtime { .. } => {
            request_all(assets, asset_index, queue);
            return SymbolResolution::Runtime { asset_index, name };
          }
          _ => {
            if star_resolution == SymbolResolution::None {
              star_resolution = res;
            } else if star_resolution != res {
              return SymbolResolution::Ambiguous;
            }
          }
        }
      }
    }
  }

  let AssetNode::Asset(asset) = &assets[asset_index as usize] else {
    unreachable!()
  };

  // If the asset has side effects or non-static exports, resolve at runtime.
  if star_resolution == SymbolResolution::None && asset.flags.contains(AssetFlags::SIDE_EFFECTS)
    || !asset.flags.contains(AssetFlags::STATIC_EXPORTS)
  {
    request_all(assets, asset_index, queue);
    return SymbolResolution::Runtime { asset_index, name };
  }

  star_resolution
}

fn request_all(assets: &mut Vec<AssetNode>, asset_index: u32, queue: &mut TransformQueue) {
  let AssetNode::Asset(asset) = &mut assets[asset_index as usize] else {
    return;
  };

  if asset.symbols.used_namespace {
    return;
  }

  asset.symbols.used_namespace = true;

  for sym in &mut asset.symbols.exports {
    sym.requested = true;
  }

  for i in 0..asset.symbols.indirect.len() {
    let AssetNode::Asset(asset) = &mut assets[asset_index as usize] else {
      continue;
    };

    let export = &mut asset.symbols.indirect[i];
    if export.requested {
      continue;
    }

    export.requested = true;

    let dep = &asset.dependencies[export.dep_index as usize];
    if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
      let name = export.imported.clone();
      request_symbol(
        assets,
        resolved_asset_index,
        name,
        &mut HashSet::new(),
        queue,
      );
    }
  }

  let AssetNode::Asset(asset) = &mut assets[asset_index as usize] else {
    return;
  };

  for i in 0..asset.symbols.star.len() {
    let AssetNode::Asset(asset) = &mut assets[asset_index as usize] else {
      continue;
    };

    let export = &mut asset.symbols.star[i];
    if export.requested {
      continue;
    }

    export.requested = true;

    let dep = &asset.dependencies[export.dep_index as usize];
    if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
      request_symbol(
        assets,
        resolved_asset_index,
        SymbolName::Namespace,
        &mut HashSet::new(),
        queue,
      );
    }
  }
}

impl<'a> AssetGraph<'a> {
  /// Visits all assets in depth-first order starting from each entry.
  pub fn dfs<'b>(&'b self) -> impl Iterator<Item = (usize, &'b Asset, Option<String>)> {
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

            if let Some(index) = entry.asset {
              if !visited.contains(index) {
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
          if visited.contains(index) {
            continue;
          }

          visited.insert(index);
          if let AssetNode::Asset(asset) = &self.assets[index] {
            for dep in asset.dependencies.iter().rev() {
              if let DependencyResolution::Asset(index) = dep.resolution {
                if !visited.contains(index as usize) {
                  stack.push(index as usize);
                }
              }
            }

            let name = if Some(index) == self.entries[entry_index].asset {
              self.entries[entry_index].dist_entry.clone()
            } else {
              None
            };

            return Some((index, asset, name));
          }
        }
      }
    })
  }
}
