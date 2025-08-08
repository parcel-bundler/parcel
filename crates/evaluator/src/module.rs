use std::{cell::Cell, collections::HashSet};

use as_any::Downcast;
use indexmap::{IndexMap, IndexSet};
use parcel_core::{Asset, AssetFlags, DependencyFlags, DependencyResolution};
use swc_core::{
  common::{sync::Lrc, Globals, Mark, SourceMap, Span},
  ecma::{ast::*, atoms::Atom as JsWord},
};

// https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-abstract-module-records
trait ModuleRecord {
  fn get_exported_names(
    &self,
    asset_id: u32,
    assets: &Vec<Asset>,
    export_star_set: &mut HashSet<u32>,
  ) -> Option<IndexSet<Symbol>>;

  fn resolve_export(
    &self,
    asset_id: u32,
    assets: &Vec<Asset>,
    name: &Symbol,
    stop_at_side_effects: bool,
    resolve_set: &mut HashSet<(u32, Symbol)>,
  ) -> ResolvedBinding;

  fn get_side_effect_dependencies(&self, asset_id: u32, assets: &Vec<Asset>) -> IndexSet<u32>;

  fn request_symbol(&self, name: Symbol, asset_id: u32, assets: &Vec<Asset>);
}

// https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-source-text-module-records
struct SourceTextModuleRecord {
  pub ast: Module,
  pub source_map: Lrc<SourceMap>,
  pub globals: Globals,
  pub unresolved_mark: Mark,
  pub global_mark: Mark,
  pub import_entries: Vec<ImportEntry>,
  pub local_exports: IndexMap<Symbol, LocalExportRecord>,
  pub indirect_exports: IndexMap<Symbol, IndirectExportRecord>,
  pub star_exports: Vec<u32>,
  pub cjs_exports: Option<IndexMap<Symbol, CjsExportRecord>>,
  pub used_namespace: Cell<bool>,
}

pub struct ImportEntry {
  pub dependency_index: u32,
  pub import_name: Symbol,
  pub local: Id,
  pub span: Span,
}

pub struct LocalExportRecord {
  pub local: Id,
  pub span: Span,
  pub used: Cell<bool>,
}

pub struct IndirectExportRecord {
  pub dependency_index: u32,
  pub import_name: Symbol,
  pub span: Span,
}

pub struct CjsExportRecord {
  pub span: Span,
  pub used: Cell<bool>,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum Symbol {
  Namespace,
  AllButDefault,
  Default,
  Name(JsWord),
}

impl From<JsWord> for Symbol {
  fn from(value: JsWord) -> Self {
    match value.as_str() {
      "default" => Symbol::Default,
      _ => Symbol::Name(value),
    }
  }
}

impl TryFrom<Symbol> for JsWord {
  type Error = ();

  fn try_from(value: Symbol) -> Result<Self, Self::Error> {
    match value {
      Symbol::Default => Ok("default".into()),
      Symbol::Name(name) => Ok(name),
      _ => Err(()),
    }
  }
}

impl Symbol {
  pub fn name(&self) -> JsWord {
    match self {
      Symbol::Name(name) => name.clone(),
      Symbol::Default => "default".into(),
      _ => unreachable!(),
    }
  }
}

#[derive(PartialEq)]
pub enum ResolvedBinding {
  None,
  Ambiguous,
  Local { module_id: u32, name: JsWord },
  Namespace { module_id: u32 },
  SideEffects { module_id: u32 },
}

impl ResolvedBinding {
  fn module_id(&self) -> Option<u32> {
    match self {
      ResolvedBinding::Local { module_id, .. }
      | ResolvedBinding::Namespace { module_id }
      | ResolvedBinding::SideEffects { module_id } => Some(*module_id),
      _ => None,
    }
  }

  fn is_namespace(&self) -> bool {
    matches!(self, ResolvedBinding::Namespace { .. })
  }

  fn name(&self) -> Option<&JsWord> {
    match self {
      ResolvedBinding::Local { name, .. } => Some(name),
      _ => None,
    }
  }
}

fn get_imported_module(
  asset_id: u32,
  assets: &Vec<Asset>,
  dep_index: u32,
) -> Option<(u32, &dyn ModuleRecord)> {
  let asset = &assets[asset_id as usize];
  let dep = &asset.dependencies[dep_index as usize];
  let Some(resolved_asset_index) = dep.resolved_asset else {
    return None;
  };

  let resolved_asset = &assets[resolved_asset_index as usize];
  let Some(resolved_module) = resolved_asset
    .content
    .downcast_ref::<SourceTextModuleRecord>()
  else {
    return None;
  };

  Some((resolved_asset_index, resolved_module))
}

impl ModuleRecord for SourceTextModuleRecord {
  // https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-getexportednames
  fn get_exported_names(
    &self,
    asset_id: u32,
    assets: &Vec<Asset>,
    export_star_set: &mut HashSet<u32>,
  ) -> Option<IndexSet<Symbol>> {
    // If there are unknown CJS exports, the exported names are unknown.
    let Some(cjs_exports) = &self.cjs_exports else {
      return None;
    };

    if !export_star_set.insert(asset_id) {
      // We've reached the starting point of an export * circularity.
      return Some(IndexSet::new());
    }

    let mut exported_names = IndexSet::new();
    exported_names.extend(self.local_exports.keys().cloned());
    exported_names.extend(self.indirect_exports.keys().cloned());
    exported_names.extend(cjs_exports.keys().cloned());

    for dep_index in &self.star_exports {
      let Some((resolved_asset_id, resolved_module)) =
        get_imported_module(asset_id, assets, *dep_index)
      else {
        continue;
      };

      let star_names =
        resolved_module.get_exported_names(resolved_asset_id, assets, export_star_set)?;
      for name in star_names {
        if name != Symbol::Default {
          exported_names.insert(name);
        }
      }
    }

    Some(exported_names)
  }

  // https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-resolveexport
  fn resolve_export(
    &self,
    asset_id: u32,
    assets: &Vec<Asset>,
    name: &Symbol,
    stop_at_side_effects: bool,
    resolve_set: &mut HashSet<(u32, Symbol)>,
  ) -> ResolvedBinding {
    if !resolve_set.insert((asset_id, name.clone())) {
      // Circular.
      return ResolvedBinding::None;
    }

    if self.local_exports.contains_key(name)
      || self.cjs_exports.is_none()
      || matches!(&self.cjs_exports, Some(cjs) if cjs.contains_key(name))
    {
      return ResolvedBinding::Local {
        module_id: asset_id,
        name: name.name(),
      };
    }

    if stop_at_side_effects
      && assets[asset_id as usize]
        .flags
        .contains(AssetFlags::SIDE_EFFECTS)
    {
      return ResolvedBinding::SideEffects {
        module_id: asset_id,
      };
    }

    if let Some(record) = self.indirect_exports.get(name) {
      let Some((resolved_asset_id, resolved_module)) =
        get_imported_module(asset_id, assets, record.dependency_index)
      else {
        return ResolvedBinding::None;
      };

      if record.import_name == Symbol::Namespace {
        return ResolvedBinding::Namespace {
          module_id: resolved_asset_id,
        };
      } else {
        return resolved_module.resolve_export(
          resolved_asset_id,
          assets,
          &record.import_name,
          stop_at_side_effects,
          resolve_set,
        );
      }
    }

    if *name == Symbol::Default {
      // NOTE: A default export cannot be provided by an export * from "mod" declaration.
      return ResolvedBinding::None;
    }

    let mut star_resolution = ResolvedBinding::None;
    for dep_index in &self.star_exports {
      let Some((resolved_asset_id, resolved_module)) =
        get_imported_module(asset_id, assets, *dep_index)
      else {
        continue;
      };

      let resolution = resolved_module.resolve_export(
        resolved_asset_id,
        assets,
        name,
        stop_at_side_effects,
        resolve_set,
      );
      if resolution != ResolvedBinding::None {
        if resolution == ResolvedBinding::Ambiguous {
          return ResolvedBinding::Ambiguous;
        }

        if star_resolution == ResolvedBinding::None {
          star_resolution = resolution;
        } else {
          if star_resolution.module_id() != resolution.module_id() {
            return ResolvedBinding::Ambiguous;
          }

          if star_resolution.is_namespace() != resolution.is_namespace() {
            return ResolvedBinding::Ambiguous;
          }

          if star_resolution.name() != resolution.name() {
            return ResolvedBinding::Ambiguous;
          }
        }
      }
    }

    star_resolution
  }

  fn get_side_effect_dependencies(&self, asset_id: u32, assets: &Vec<Asset>) -> IndexSet<u32> {
    let mut res = IndexSet::new();
    let asset = &assets[asset_id as usize];
    let mut import_entry_index = 0;
    for (dep_index, dep) in asset.dependencies.iter().enumerate() {
      let dep_index = dep_index as u32;
      let Some(resolved_asset_id) = dep.resolved_asset else {
        while self.import_entries[import_entry_index].dependency_index == dep_index {
          import_entry_index += 1;
        }
        continue;
      };

      let resolved = &assets[resolved_asset_id as usize];
      if !dep.flags.contains(DependencyFlags::IS_ESM)
        || resolved.flags.contains(AssetFlags::SIDE_EFFECTS)
      {
        res.insert(resolved_asset_id);
      } else {
        // Resolved asset is side-effect free, but imported symbols may resolve through re-exports to assets that *do* have side effects.
        loop {
          let import_entry = &self.import_entries[import_entry_index];
          debug_assert!(
            import_entry.dependency_index >= dep_index,
            "import entries should be sorted!"
          );

          if import_entry.dependency_index == dep_index {
            let resolved = self.resolve_export(
              resolved_asset_id,
              assets,
              &import_entry.import_name,
              true,
              &mut HashSet::new(),
            );
            if let Some(resolved) = resolved.module_id() {
              res.insert(resolved);
            }
          } else {
            break;
          }

          import_entry_index += 1;
        }
      }
    }

    res
  }

  fn request_symbol(&self, name: Symbol, asset_id: u32, assets: &Vec<Asset>) {
    if name == Symbol::Namespace || self.cjs_exports.is_none() {
      self.used_namespace.set(true);
      // TODO: mark all deps as used too
      return;
    }

    if let Some(record) = self.local_exports.get(&name) {
      record.used.set(true);
      // TODO: mark any imports referenced by this re-export as used.
      return;
    }

    if let Some(record) = self.indirect_exports.get(&name) {
      // Mark as used
      let asset = &assets[asset_id as usize];
      let dep = &asset.dependencies[record.dependency_index as usize];
      if let Some(resolved_asset_index) = dep.resolved_asset {
        let resolved_asset = &assets[resolved_asset_index as usize];
        let Some(resolved_module) = resolved_asset
          .content
          .downcast_ref::<SourceTextModuleRecord>()
        else {
          return;
        };

        resolved_module.request_symbol(record.import_name.clone(), resolved_asset_index, assets);
      } else {
        // TODO: un-defer
      }
      return;
    }

    if name == Symbol::Default {
      // A default export cannot be provided by an export *.
      return;
    }

    // Propagate to ALL star re-exports.
    for dep_index in &self.star_exports {
      let asset = &assets[asset_id as usize];
      let dep = &asset.dependencies[*dep_index as usize];
      if let Some(resolved_asset_index) = dep.resolved_asset {
        let resolved_asset = &assets[resolved_asset_index as usize];
        let Some(resolved_module) = resolved_asset
          .content
          .downcast_ref::<SourceTextModuleRecord>()
        else {
          return;
        };

        resolved_module.request_symbol(name.clone(), resolved_asset_index, assets);
      } else {
        // TODO: un-defer
      }
    }
  }
}

impl SourceTextModuleRecord {
  /// Returns the re-exports from this module that may be accessed directly.
  /// This can happen when there are unknown CJS exports, or when the namespace is used.
  pub fn re_exports(&self, asset_id: u32, assets: &Vec<Asset>) -> Vec<ResolvedBinding> {
    if self.cjs_exports.is_none() || self.used_namespace.get() {
      let mut re_exports =
        Vec::with_capacity(self.indirect_exports.len() + self.star_exports.len());
      for exp in self.indirect_exports.values() {
        let resolved = self.resolve_export(
          asset_id,
          assets,
          &exp.import_name,
          false,
          &mut HashSet::new(),
        );
        match resolved {
          ResolvedBinding::None => continue,
          ResolvedBinding::Ambiguous => {
            todo!()
          }
          _ => {}
        }
        re_exports.push(resolved);
      }

      for dep_index in &self.star_exports {
        let Some((resolved_asset_id, _)) = get_imported_module(asset_id, assets, *dep_index) else {
          continue;
        };

        re_exports.push(ResolvedBinding::Namespace {
          module_id: resolved_asset_id,
        });
      }

      re_exports
    } else {
      Vec::new()
    }
  }
}
