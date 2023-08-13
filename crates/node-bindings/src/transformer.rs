use std::collections::{HashMap, HashSet};

use crate::db::DB;
use napi::{Env, JsObject, JsUnknown, Result};
use napi_derive::napi;
use parcel_db::{
  ArenaAllocator, ArenaVec, Dependency, DependencyFlags, EnvironmentId, InternedString, Priority,
  SpecifierType, Symbol, TargetId, Vec,
};
use parcel_js_swc_core::{DependencyKind, Diagnostic, TransformResult};
use path_slash::PathBufExt;
use serde::{Deserialize, Serialize};

#[napi]
pub fn transform(opts: JsObject, env: Env) -> Result<JsUnknown> {
  let config: parcel_js_swc_core::Config = env.from_js_value(opts)?;

  let result = convert_result(&config, parcel_js_swc_core::transform(&config)?);
  env.to_js_value(&result)
}

#[cfg(not(target_arch = "wasm32"))]
#[napi]
pub fn transform_async(opts: JsObject, env: Env) -> Result<JsObject> {
  let config: parcel_js_swc_core::Config = env.from_js_value(opts)?;
  let (deferred, promise) = env.create_deferred()?;

  rayon::spawn(move || {
    let res = parcel_js_swc_core::transform(&config);
    match res {
      Ok(result) => deferred.resolve(move |env| env.to_js_value(&convert_result(&config, result))),
      Err(err) => deferred.reject(err.into()),
    }
  });

  Ok(promise)
}

#[derive(Serialize, Debug, Deserialize)]
pub struct Config2 {
  pub filename: String,
  pub env_id: u32,
  #[serde(with = "serde_bytes")]
  pub code: std::vec::Vec<u8>,
  pub module_id: String,
  pub project_root: String,
  pub env: HashMap<String, String>,
  pub inline_fs: bool,
  pub is_type_script: bool,
  pub is_jsx: bool,
  pub jsx_pragma: Option<String>,
  pub jsx_pragma_frag: Option<String>,
  pub automatic_jsx_runtime: bool,
  pub jsx_import_source: Option<String>,
  pub decorators: bool,
  pub use_define_for_class_fields: bool,
  pub is_development: bool,
  pub react_refresh: bool,
  pub targets: Option<HashMap<String, String>>,
  pub supports_module_workers: bool,
  pub trace_bailouts: bool,
  pub is_swc_helpers: bool,
}

#[derive(Serialize, Debug, Default)]
pub struct TransformResult2 {
  #[serde(with = "serde_bytes")]
  pub code: std::vec::Vec<u8>,
  pub map: Option<String>,
  pub shebang: Option<String>,
  pub dependencies: std::vec::Vec<u32>,
  pub symbols: u32,
  // pub hoist_result: Option<HoistResult>,
  // pub symbol_result: Option<CollectResult>,
  pub diagnostics: Option<std::vec::Vec<Diagnostic>>,
  pub needs_esm_helpers: bool,
  pub used_env: HashSet<String>,
  pub has_node_replacements: bool,
  pub has_cjs_exports: bool,
  pub static_cjs_exports: bool,
  pub should_wrap: bool,
}

fn convert_result(
  config: &parcel_js_swc_core::Config,
  result: TransformResult,
) -> TransformResult2 {
  let mut deps = std::vec::Vec::new();
  let mut dep_map = HashMap::new();
  for dep in result.dependencies {
    match dep.kind {
      DependencyKind::WebWorker => {}
      DependencyKind::ServiceWorker => {}
      DependencyKind::Worklet => {}
      DependencyKind::Url => {}
      DependencyKind::File => {}
      _ => {
        let mut flags = DependencyFlags::empty();
        flags.set(DependencyFlags::OPTIONAL, dep.is_optional);
        let d = Dependency {
          specifier: dep.specifier.as_ref().into(),
          specifier_type: match dep.kind {
            DependencyKind::Require => SpecifierType::Commonjs,
            _ => SpecifierType::Esm,
          },
          priority: match dep.kind {
            DependencyKind::DynamicImport => Priority::Lazy,
            _ => Priority::Sync,
          },
          flags,
          bundle_behavior: parcel_db::BundleBehavior::None,
          resolve_from: pathdiff::diff_paths(&config.filename, &config.project_root)
            .map(|p| p.to_slash_lossy().into()),
          source_asset_id: None,
          placeholder: dep.placeholder.map(|s| s.into()),
          symbols: ArenaVec::new(),
          loc: None,
          target: TargetId(0),
          env: EnvironmentId(config.env_id),
        };

        let placeholder = d.placeholder.as_ref().unwrap_or(&d.specifier).clone();
        let id = DB.create_dependency(d);
        deps.push(id);
        dep_map.insert(placeholder, id);
      }
    }
  }

  let mut has_cjs_exports = false;
  let mut static_cjs_exports = false;
  let mut should_wrap = false;

  let (symbols_addr, symbols) = DB.alloc_struct::<ArenaVec<Symbol>>();
  unsafe { std::ptr::write(symbols, ArenaVec::new()) };
  if let Some(hoist_result) = result.hoist_result {
    symbols.reserve(hoist_result.exported_symbols.len() + hoist_result.re_exports.len() + 1);
    // println!("{:?}", hoist_result);
    for s in hoist_result.exported_symbols {
      let sym = Symbol {
        exported: s.exported.as_ref().into(),
        local: s.local.as_ref().into(),
        loc: None,
        is_weak: false,
      };
      symbols.push(sym);
    }

    for s in hoist_result.imported_symbols {
      if let Some(dep_id) = InternedString::get(&*s.source).and_then(|s| dep_map.get(&s)) {
        let dep: &mut Dependency = DB.read_heap(*dep_id);
        dep.symbols.push(Symbol {
          exported: s.imported.as_ref().into(),
          local: s.local.as_ref().into(),
          loc: None,
          is_weak: false,
        });
      }
    }

    for s in hoist_result.re_exports {
      if let Some(dep_id) = InternedString::get(&*s.source).and_then(|s| dep_map.get(&s)) {
        let dep: &mut Dependency = DB.read_heap(*dep_id);
        if &*s.local == "*" || &*s.imported == "*" {
          dep.symbols.push(Symbol {
            exported: "*".into(),
            local: "*".into(),
            loc: None,
            is_weak: true,
          });
        } else {
          let re_export_name = dep
            .symbols
            .as_slice()
            .iter()
            .find(|sym| sym.exported == &*s.imported)
            .map(|sym| sym.local.clone())
            .unwrap_or_else(|| format!("${}$re_export${}", config.module_id, s.local).into());
          dep.symbols.push(Symbol {
            exported: s.imported.as_ref().into(),
            local: re_export_name.clone(),
            loc: None,
            is_weak: true,
          });
          symbols.push(Symbol {
            exported: s.local.as_ref().into(),
            local: re_export_name,
            loc: None,
            is_weak: false,
          });
        }
      }
    }

    for specifier in hoist_result.wrapped_requires {
      if let Some(dep_id) = InternedString::get(&specifier).and_then(|s| dep_map.get(&s)) {
        let dep: &mut Dependency = DB.read_heap(*dep_id);
        // dep.meta.should_wrap = true
      }
    }

    for (name, specifier) in hoist_result.dynamic_imports {
      if let Some(dep_id) = InternedString::get(&*specifier).and_then(|s| dep_map.get(&s)) {
        let dep: &mut Dependency = DB.read_heap(*dep_id);
        // dep.meta.promise_symbol = name
      }
    }

    if !hoist_result.self_references.is_empty() {
      println!("self references");
    }

    // Add * symbol if there are CJS exports, no imports/exports at all
    // (and the asset has side effects), or the asset is wrapped.
    // This allows accessing symbols that don't exist without errors in symbol propagation.
    if hoist_result.has_cjs_exports
      // || (!hoist_result.is_esm && config.)
      || (hoist_result.should_wrap && !symbols.as_slice().iter().any(|s| s.exported == "*"))
    {
      symbols.push(Symbol {
        exported: "*".into(),
        local: format!("${}$exports", &config.module_id).into(),
        loc: None,
        is_weak: false,
      });
    }

    has_cjs_exports = hoist_result.has_cjs_exports;
    static_cjs_exports = hoist_result.static_cjs_exports;
    should_wrap = hoist_result.should_wrap;
  } else {
    if let Some(symbol_result) = result.symbol_result {
      symbols.reserve(symbol_result.exports.len() + 1);
      for sym in symbol_result.exports {
        let local = if let Some(dep_id) = sym
          .source
          .and_then(|s| InternedString::get(&*s))
          .and_then(|s| dep_map.get(&s))
        {
          let dep: &mut Dependency = DB.read_heap(*dep_id);
          let local = format!("${}${}", *dep_id, sym.local).into();
          dep.symbols.push(Symbol {
            exported: sym.local.as_ref().into(),
            local,
            loc: None,
            is_weak: true,
          });
          local
        } else {
          format!("${}", sym.local).into()
        };

        symbols.push(Symbol {
          exported: sym.exported.as_ref().into(),
          local,
          loc: None,
          is_weak: false,
        });
      }

      for sym in symbol_result.imports {
        if let Some(dep_id) = InternedString::get(&*sym.source).and_then(|s| dep_map.get(&s)) {
          let dep: &mut Dependency = DB.read_heap(*dep_id);
          dep.symbols.push(Symbol {
            exported: sym.imported.as_ref().into(),
            local: sym.local.as_ref().into(),
            loc: None,
            is_weak: false,
          });
        }
      }

      for sym in symbol_result.exports_all {
        if let Some(dep_id) = InternedString::get(&*sym.source).and_then(|s| dep_map.get(&s)) {
          let dep: &mut Dependency = DB.read_heap(*dep_id);
          dep.symbols.push(Symbol {
            exported: "*".into(),
            local: "*".into(),
            loc: None,
            is_weak: true,
          });
        }
      }

      // Add * symbol if there are CJS exports, no imports/exports at all, or the asset is wrapped.
      // This allows accessing symbols that don't exist without errors in symbol propagation.
      if symbol_result.has_cjs_exports
        // || (!symbol_result.is_esm && )
        || (symbol_result.should_wrap && !symbols.as_slice().iter().any(|s| s.exported == "*"))
      {
        symbols.push(Symbol {
          exported: "*".into(),
          local: format!("${}$exports", &config.module_id).into(),
          loc: None,
          is_weak: false,
        });
      }
    } else {
      // If the asset is wrapped, add * as a fallback
      symbols.push(Symbol {
        exported: "*".into(),
        local: format!("${}$exports", &config.module_id).into(),
        loc: None,
        is_weak: false,
      });
    }
  }

  // println!("SYMBOLS {:?} {:?}", symbols_addr, symbols);
  // for id in &deps {
  //   let dep: &mut Dependency = DB.read_heap(*id);
  //   println!("{:?}", dep);
  // }

  TransformResult2 {
    code: result.code,
    map: result.map,
    shebang: result.shebang,
    dependencies: deps,
    symbols: symbols_addr,
    diagnostics: result.diagnostics,
    needs_esm_helpers: result.needs_esm_helpers,
    used_env: result.used_env.into_iter().map(|v| v.to_string()).collect(),
    has_node_replacements: result.has_node_replacements,
    has_cjs_exports,
    static_cjs_exports,
    should_wrap,
  }
}
