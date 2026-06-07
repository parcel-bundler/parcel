use std::{
  collections::{HashMap, HashSet},
  sync::Arc,
};

use fixedbitset::FixedBitSet;

use crate::{
  Asset, AssetFlags, AssetRequest, AssetType, DependencyResolution, DiagnosticList, Entry,
  EnvironmentFlags, FileContent, ParcelOptions, Priority, SourceLocation, SymbolName,
  SymbolResolution,
  config::ParcelConfig,
  request::{RequestResult, TransformQueue},
};

#[derive(Debug)]
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

#[derive(Debug)]
pub struct AssetGraph {
  pub assets: Vec<AssetNode>,
  pub entries: Vec<Entry>,
}

pub fn build_asset_graph(
  mut entries: Vec<Entry>,
  config: Arc<ParcelConfig>,
  options: Arc<ParcelOptions>,
) -> Result<AssetGraph, DiagnosticList> {
  let mut queue = TransformQueue::new(config, options.clone());

  let mut assets: Vec<AssetNode> = Vec::new();
  let mut asset_requests: HashMap<Arc<AssetRequest>, usize> = HashMap::new();

  for entry in &mut entries {
    let req = Arc::new(AssetRequest {
      loc: SourceLocation {
        url: entry.url.clone(),
        start: Default::default(),
        end: Default::default(),
      },
      ty: AssetType::from_url(&entry.url),
      content: Arc::new(FileContent::new(
        entry.url.to_file_path(&options.project_root)?,
        options.input_fs.clone(),
      )),
      target: entry.target.clone(),
      pipeline: None,
      side_effects: true,
    });

    let index = assets.len();
    assets.push(AssetNode::Deferred {
      request: req.clone(),
      symbols: if entry.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
        vec![SymbolName::Namespace]
      } else {
        Vec::new()
      },
      requested: true,
    });
    entry.asset = Some(index);
    asset_requests.insert(req.clone(), index);
    queue.transform(index, req);
  }

  while let Some(result) = queue.receive() {
    match result {
      RequestResult::Transform(res) => {
        let mut res = res?;
        for dep in &mut res.asset.dependencies {
          let priority = dep.priority;
          if let DependencyResolution::Deferred(req) = &dep.resolution {
            if let Some(&index) = asset_requests.get(req) {
              dep.resolution = DependencyResolution::Asset(index as u32);

              // Lazy/parallel deps must be transformed even if the package has sideEffects: false,
              // because the user explicitly requested this module via import().
              if priority != Priority::Sync {
                if let AssetNode::Deferred {
                  requested, request, ..
                } = &mut assets[index]
                {
                  if !*requested {
                    *requested = true;
                    queue.transform(index, request.clone());
                  }
                }
              }
            } else {
              let req = req.clone();

              // Allocate a new asset index.
              let index = assets.len();
              dep.resolution = DependencyResolution::Asset(index as u32);
              asset_requests.insert(req.clone(), index);

              // If the dependency has side effects or is loaded via dynamic import, always transform it.
              let requested = req.side_effects || priority != Priority::Sync;
              assets.push(AssetNode::Deferred {
                request: req.clone(),
                symbols: Vec::new(),
                requested,
              });

              if requested {
                queue.transform(index, req);
              }
            }
          }
        }

        let import_len = res.asset.symbols.imports.len();
        let prev = std::mem::replace(&mut assets[res.index], AssetNode::Asset(res.asset));
        let requested_symbols = if let AssetNode::Deferred { symbols, .. } = prev {
          symbols
        } else {
          Vec::new()
        };

        // Propagate the requested symbols for this asset to un-defer dependencies.
        for name in requested_symbols {
          request_symbol(
            &mut assets,
            res.index as u32,
            name,
            &mut HashSet::new(),
            &mut queue,
          );
        }

        // Propagate this asset's imported symbols.
        for i in 0..import_len {
          let AssetNode::Asset(asset) = &assets[res.index] else {
            unreachable!()
          };

          let symbol = &asset.symbols.imports[i];
          let dep = &asset.dependencies[symbol.dep_index as usize];
          if let DependencyResolution::Asset(resolved_index) = dep.resolution {
            let name = symbol.symbol.clone();
            request_symbol(
              &mut assets,
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

  // Store symbol resolutions for each import.
  for asset_index in 0..assets.len() {
    if let AssetNode::Asset(asset) = &assets[asset_index] {
      for import_index in 0..asset.symbols.imports.len() {
        let AssetNode::Asset(asset) = &assets[asset_index] else {
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
              &mut assets,
              resolved_index,
              name.clone(),
              &mut HashSet::new(),
              &mut queue,
            )
          };

          let AssetNode::Asset(asset) = &mut assets[asset_index] else {
            unreachable!()
          };

          let symbol = &mut asset.symbols.imports[import_index];
          symbol.resolved = res;
        }
      }
    }
  }

  Ok(AssetGraph { assets, entries })
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

impl AssetGraph {
  /// Visits all assets in depth-first order starting from each entry.
  pub fn dfs<'a>(&'a self) -> impl Iterator<Item = (usize, &'a Asset, Option<String>)> {
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
