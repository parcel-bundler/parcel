use std::{collections::HashMap, path::PathBuf, sync::Arc};

use arena::{SerializableHandle, Sink};
use dependencies::collect_dependencies;
use html5ever::tendril::{StrTendril, TendrilSink};
use jsx::{JsxOptions, to_component};
use optimize::optimize;
use oxvg::ConfigItem;
use package::insert_bundle_references;
use parcel_core::{Asset, AssetType, Dependency, Diagnostic, Environment};
use serde::{Deserialize, Serialize, Serializer};
use swc_core::ecma::codegen::to_code;
use typed_arena::Arena;

pub use package::{BundleReference, InlineBundle};

use crate::arena::Node;

mod arena;
mod dependencies;
mod jsx;
mod optimize;
mod oxvg;
mod package;
mod serialize_html;
mod serialize_xml;
mod srcset;

#[derive(Hash, PartialEq, Eq, PartialOrd, Ord, Default, Clone)]
pub struct SerializableTendril(pub StrTendril);

impl serde::Serialize for SerializableTendril {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: Serializer,
  {
    serializer.serialize_str(self.0.as_ref())
  }
}

impl<'de> serde::Deserialize<'de> for SerializableTendril {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let s: String = Deserialize::deserialize(deserializer)?;
    Ok(SerializableTendril(s.into()))
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOptions {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub file_path: PathBuf,
  pub xml: bool,
  pub env: Arc<Environment>,
  pub hmr: bool,
}

#[derive(Serialize)]
pub struct TransformResult {
  pub dependencies: Vec<Dependency>,
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub assets: Vec<Asset>,
  pub errors: Vec<Diagnostic>,
}

pub fn transform_html(options: TransformOptions) -> TransformResult {
  let arena = Arena::new();
  let dom = if options.xml {
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  } else {
    html5ever::driver::parse_document(Sink::new(&arena), html5ever::ParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  };

  let (deps, assets, mut errors) = collect_dependencies(
    &arena,
    &dom,
    options.file_path,
    AssetType::Html,
    options.env,
    options.hmr,
  );

  let mut vec = Vec::new();
  let res = if options.xml {
    serialize_xml::serialize(&mut vec, dom)
  } else {
    let handle: SerializableHandle = dom.into();
    html5ever::serialize::serialize(
      &mut vec,
      &handle,
      html5ever::serialize::SerializeOpts::default(),
    )
  };
  if let Err(err) = res {
    errors.push(err.into());
  }

  TransformResult {
    code: vec,
    dependencies: deps,
    assets,
    errors,
  }
}

pub fn transform_svg(options: TransformOptions) -> TransformResult {
  let arena = Arena::new();
  let dom =
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice());
  let (deps, assets, mut errors) = collect_dependencies(
    &arena,
    &dom,
    options.file_path,
    AssetType::Svg,
    options.env,
    options.hmr,
  );

  let mut vec = Vec::new();
  if let Err(err) = serialize_xml::serialize(&mut vec, dom) {
    errors.push(err.into());
  }

  TransformResult {
    code: vec,
    dependencies: deps,
    assets,
    errors,
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageOptions {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub xml: bool,
  pub bundles: Vec<BundleReference>,
  pub inline_bundles: HashMap<SerializableTendril, InlineBundle>,
  pub import_map: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize)]
pub struct PackageResult {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
}

pub fn package_html(options: PackageOptions) -> Result<PackageResult, ()> {
  let arena = Arena::new();
  let dom = if options.xml {
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  } else {
    html5ever::driver::parse_document(Sink::new(&arena), html5ever::ParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  };

  insert_bundle_references(
    &arena,
    dom,
    options.bundles,
    options.inline_bundles,
    options.import_map,
  );

  let mut vec = Vec::new();
  if options.xml {
    serialize_xml::serialize(&mut vec, dom).map_err(|_| ())?;
  } else {
    html5ever::serialize::serialize(
      &mut vec,
      &SerializableHandle(dom),
      html5ever::serialize::SerializeOpts::default(),
    )
    .map_err(|_| ())?;
  }

  Ok(PackageResult { code: vec })
}

pub fn package_svg(options: PackageOptions) -> Result<PackageResult, ()> {
  let arena = Arena::new();
  let dom =
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice());

  insert_bundle_references(
    &arena,
    dom,
    options.bundles,
    options.inline_bundles,
    options.import_map,
  );

  let mut vec = Vec::new();
  serialize_xml::serialize(&mut vec, dom).map_err(|_| ())?;

  Ok(PackageResult { code: vec })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeHtmlOptions {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub xml: bool,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub config: optimize::OptimizeOptions,
}

fn ok_or_default<'de, T, D>(deserializer: D) -> Result<T, D::Error>
where
  T: serde::Deserialize<'de> + Default,
  D: serde::Deserializer<'de>,
{
  Ok(T::deserialize(deserializer).unwrap_or_default())
}

pub fn optimize_html(options: OptimizeHtmlOptions) -> Result<PackageResult, ()> {
  let arena = Arena::new();
  let dom = if options.xml {
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  } else {
    html5ever::driver::parse_document(Sink::new(&arena), html5ever::ParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice())
  };

  optimize(&arena, dom, options.config);

  let mut vec: Vec<u8> = Vec::new();
  if options.xml {
    serialize_xml::serialize(&mut vec, dom).map_err(|_| ())?;
  } else {
    serialize_html::serialize(&mut vec, dom, serialize_html::SerializeOpts::default())
      .map_err(|_| ())?;
  }

  Ok(PackageResult { code: vec })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeSvgOptions {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub config: oxvg::OxvgConfig,
}

pub fn optimize_svg(options: OptimizeSvgOptions) -> Result<PackageResult, ()> {
  let arena = Arena::new();
  let dom =
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice());

  optimize::optimize_svg(&arena, dom, &options.config);

  let mut vec = Vec::new();
  serialize_xml::serialize(&mut vec, dom).map_err(|_| ())?;

  Ok(PackageResult { code: vec })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgReactOptions {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub config: JsxOptions,
}

pub fn svg_react(mut options: SvgReactOptions) -> Result<PackageResult, ()> {
  let arena = Arena::new();
  let dom =
    xml5ever::driver::parse_document(Sink::new(&arena), xml5ever::driver::XmlParseOpts::default())
      .from_utf8()
      .one(options.code.as_slice());

  if options.config.svgo {
    if options.config.icon.is_some() || !options.config.dimensions {
      options.config.svgo_config.remove_view_box = ConfigItem::Bool(false);
    }

    optimize::optimize_svg(&arena, dom, &options.config.svgo_config);
  }

  swc_core::common::GLOBALS.set(&swc_core::common::Globals::new(), || {
    let program = to_component(dom, options.config);
    let code = to_code(&program);

    Ok(PackageResult {
      code: code.into_bytes(),
    })
  })
}

#[cfg(test)]
mod tests {
  use crate::transform_html;

  #[test]
  fn test_transform() {
    let res = transform_html(crate::TransformOptions {
      code: "<html><body><template><div>test</div><span>hi</span></template></body></html>".into(),
      file_path: "foo.html".into(),
      xml: false,
      env: Default::default(),
      hmr: false,
    });

    assert_eq!(
      std::str::from_utf8(&res.code).unwrap(),
      "<html><head></head><body><template><div>test</div><span>hi</span></template></body></html>"
    );
  }
}
