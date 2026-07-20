use std::{collections::HashMap, fmt::Write};

use indexmap::{IndexMap, IndexSet};
use parcel_core::{
  Asset, AssetIndex, AssetType, BundleGraph, OutputFormat, ParcelConfig, ParcelOptions,
  get_bundle_content,
};

use crate::packager::{Resolution, SyntheticAsset, asset_dependencies};

#[derive(serde::Serialize, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum HmrUpdate<'a> {
  Update {
    assets: Vec<HmrAsset<'a>>,
  },
  Error {
    diagnostics: parcel_core::RenderedDiagnostics,
  },
}

#[derive(Debug, serde::Serialize)]
#[serde(untagged)]
enum Id {
  Asset(String),
  Bundle(String),
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HmrAsset<'a> {
  id: Id,
  #[serde(rename = "type")]
  ty: AssetType,
  output: String,
  env_hash: String,
  output_format: OutputFormat,
  deps_by_bundle: HashMap<String, IndexMap<String, Resolution<'a>>>,
}

pub fn get_hmr_update<'a>(
  changed_assets: Vec<(AssetIndex, &'a Asset)>,
  bundle_graph: &'a BundleGraph,
  config: &'a ParcelConfig,
  options: &'a ParcelOptions,
) -> HmrUpdate<'a> {
  let mut synthetic_assets = IndexSet::new();
  let mut assets = Vec::with_capacity(changed_assets.len());
  for (id, asset) in changed_assets {
    let dependencies = asset_dependencies(
      id,
      asset,
      bundle_graph,
      None,
      &mut synthetic_assets,
      &|bundle_index| {
        get_bundle_content(
          config,
          bundle_graph,
          &bundle_graph.bundles[bundle_index],
          options,
        )
      },
      &bundle_graph.project_root,
    )
    .unwrap();

    // TODO: I think we don't need this anymore. Was added in https://github.com/parcel-bundler/parcel/pull/4311
    // due to runtimes producing different dependencies per bundle.
    let mut deps_by_bundle = HashMap::new();
    deps_by_bundle.insert("TODO".into(), dependencies);

    let mut output = String::new();
    if asset.ty == AssetType::Js {
      output = format!(
        "parcelHotUpdate['{}'] = function (module, exports, require) {{{}}}",
        asset.id(&bundle_graph.project_root),
        String::from_utf8(asset.content.read().unwrap()).unwrap()
      );
    }

    assets.push(HmrAsset {
      id: Id::Asset(asset.id(&bundle_graph.project_root)),
      ty: asset.ty.clone(),
      output,
      // TODO: needed to filter out assets that come from a different target, preventing page reload.
      env_hash: "TODO".into(),
      output_format: asset.target.output_format.clone(),
      deps_by_bundle,
    });
  }

  // TODO: only changed ones??
  for synthetic_asset in synthetic_assets {
    let asset_id = synthetic_asset.id(bundle_graph, &bundle_graph.project_root);
    let id = if matches!(synthetic_asset, SyntheticAsset::CssModuleExports(_)) {
      Id::Asset(asset_id.clone())
    } else {
      Id::Bundle(asset_id.clone())
    };

    let mut output = String::new();
    write!(&mut output, "parcelHotUpdate[").unwrap();
    write!(&mut output, "'{}'", asset_id).unwrap();
    write!(&mut output, "] = function (module, exports, require) {{").unwrap();
    synthetic_asset
      .write_content(
        &mut output,
        false,
        bundle_graph,
        &bundle_graph.bundles[0], // TODO
        &|bundle_index| {
          get_bundle_content(
            config,
            bundle_graph,
            &bundle_graph.bundles[bundle_index],
            options,
          )
        },
        &bundle_graph.project_root,
      )
      .unwrap();
    write!(&mut output, "}}").unwrap();

    let mut deps_by_bundle = HashMap::new();
    deps_by_bundle.insert(
      "TODO".into(),
      synthetic_asset.dependencies(bundle_graph, &bundle_graph.project_root),
    );

    assets.push(HmrAsset {
      id,
      ty: AssetType::Js,
      output,
      env_hash: "TODO".into(),
      output_format: OutputFormat::Esmodule,
      deps_by_bundle,
    });
  }

  HmrUpdate::Update { assets }
}
