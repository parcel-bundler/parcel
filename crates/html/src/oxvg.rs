use std::cell::RefCell;

use crate::arena::{Arena, Node, NodeData, Ref};
use html5ever::{Attribute, QualName};
use lightningcss::{
  rules::CssRuleList,
  stylesheet::{ParserFlags, ParserOptions, StyleSheet},
};
use oxvg_ast::{
  arena::Allocator as OxvgAllocator,
  document::Document as OxvgDocument,
  node::{NodeData as OxvgNodeData, Ref as OxvgRef, Type as OxvgNodeType},
  visitor::Info,
};
use oxvg_collections::{
  atom::Atom as OxvgAtom,
  attribute::{Attr as OxvgAttr, AttrId as OxvgAttrId, xml::XmlSpace},
  element::ElementId,
  name::Prefix as OxvgPrefix,
};
use oxvg_serialize::{PrinterOptions, ToValue};
use serde::Deserialize;
use xxhash_rust::xxh3::xxh3_64;

/// Translate a Parcel DOM into OXVG's typed SVG AST, run the optimiser, and
/// translate the result back into the Parcel arena.
pub fn optimize<'arena>(
  arena: Arena<'arena>,
  root: Ref<'arena>,
  jobs: &oxvg_optimiser::Jobs,
) -> Result<(), String> {
  let values = OxvgAllocator::new_values();
  let mut oxvg_arena = OxvgAllocator::new_arena();
  let allocator = OxvgAllocator::new(&mut oxvg_arena, &values);
  let dom = parcel_to_oxvg(root, &allocator)?;

  if jobs.add_classes_to_s_v_g_element.is_some()
    && let Some(element) = dom.find_element()
    && matches!(element.qual_name().unaliased(), ElementId::Svg)
    && !element.has_attribute(&OxvgAttrId::Class)
  {
    // OXVG only mutates an existing class attribute.
    element.set_attribute(OxvgAttr::new(OxvgAttrId::Class, ""));
  }

  jobs
    .run(dom, &Info::new(allocator))
    .map_err(|error| format!("OXVG optimization failed: {error}"))?;

  let translated = oxvg_to_parcel(arena, dom)?;

  match &root.data {
    NodeData::Document => replace_document(root, translated, jobs.remove_doctype.is_none()),
    NodeData::Element { .. } => replace_element(root, translated),
    _ => return Err("OXVG can only optimize documents and elements".into()),
  }

  Ok(())
}

fn parcel_to_oxvg<'input, 'oxvg>(
  root: Ref<'_>,
  allocator: &OxvgAllocator<'input, 'oxvg>,
) -> Result<OxvgRef<'input, 'oxvg>, String> {
  let dom = allocator.alloc(OxvgNodeData::Document);
  let document = dom
    .element()
    .ok_or_else(|| "Could not create OXVG document".to_owned())?
    .as_document();

  if matches!(root.data, NodeData::Document) {
    for child in children(root) {
      if let Some(child) = parcel_node_to_oxvg(child, &document, allocator)? {
        dom.append_child(child);
      }
    }
  } else if let Some(root) = parcel_node_to_oxvg(root, &document, allocator)? {
    dom.append_child(root);
  }

  Ok(dom)
}

fn parcel_node_to_oxvg<'input, 'oxvg>(
  node: Ref<'_>,
  document: &OxvgDocument<'input, 'oxvg>,
  allocator: &OxvgAllocator<'input, 'oxvg>,
) -> Result<Option<OxvgRef<'input, 'oxvg>>, String> {
  let translated = match &node.data {
    NodeData::Document => return Err("Unexpected nested Parcel document".into()),
    // OXVG's concrete AST cannot represent doctypes. They are retained from
    // the Parcel document when the removeDoctype job is disabled.
    NodeData::Doctype { .. } => return Ok(None),
    NodeData::Text { contents } => document.create_text_node(
      allocate_atom(allocator, contents.borrow().as_ref()),
      allocator,
    ),
    NodeData::Comment { contents } => allocator.alloc(OxvgNodeData::Comment(RefCell::new(Some(
      allocate_atom(allocator, contents.as_ref()),
    )))),
    NodeData::ProcessingInstruction { target, contents } => document.create_processing_instruction(
      allocate_atom(allocator, target.as_ref()),
      allocate_atom(allocator, contents.borrow().as_ref()),
      allocator,
    ),
    NodeData::Element { name, attrs, .. } => {
      let element_id = ElementId::new(
        parcel_name_to_oxvg_prefix(name, allocator),
        allocate_atom(allocator, name.local.as_ref()),
      );
      let element = document.create_element(element_id, allocator);
      let parse_style = matches!(element.qual_name().unaliased(), ElementId::Style)
        && !attrs.borrow().iter().any(|attr| {
          attr.name.prefix.is_none()
            && attr.name.ns.is_empty()
            && attr.name.local.as_ref() == "type"
            && !attr.value.is_empty()
            && attr.value.as_ref() != "text/css"
        });

      for attr in attrs.borrow().iter() {
        let attr_id = if is_default_xmlns(&attr.name) {
          OxvgAttrId::XMLNS
        } else {
          element.qual_name().parse_attr_id(
            &parcel_name_to_oxvg_prefix(&attr.name, allocator),
            allocate_atom(allocator, attr.name.local.as_ref()),
          )
        };
        let value = allocator.alloc_str(attr.value.as_ref());
        element.set_attribute(OxvgAttr::new(attr_id, value));
      }

      if parse_style && let Some(style) = parcel_style_to_oxvg(node, allocator) {
        element.append(document.create_style_node(style, allocator));
      } else {
        for child in children(node) {
          if let Some(child) = parcel_node_to_oxvg(child, document, allocator)? {
            element.append(child);
          }
        }
      }

      element.0
    }
  };

  Ok(Some(translated))
}

fn parcel_style_to_oxvg<'input, 'oxvg>(
  element: Ref<'_>,
  allocator: &OxvgAllocator<'input, 'oxvg>,
) -> Option<CssRuleList<'input>> {
  let mut rules = CssRuleList(Vec::new());
  for child in children(element) {
    let NodeData::Text { contents } = &child.data else {
      continue;
    };
    let contents = contents.borrow();
    let source = allocator.alloc_str(contents.as_ref());
    let options = ParserOptions {
      flags: ParserFlags::all(),
      ..ParserOptions::default()
    };
    if let Ok(style) = StyleSheet::parse(source, options) {
      rules.0.extend(style.rules.0);
    }
  }
  (!rules.0.is_empty()).then_some(rules)
}

fn allocate_atom<'input>(allocator: &OxvgAllocator<'input, '_>, value: &str) -> OxvgAtom<'input> {
  OxvgAtom::from(&*allocator.alloc_str(value))
}

fn parcel_name_to_oxvg_prefix<'input>(
  name: &QualName,
  allocator: &OxvgAllocator<'input, '_>,
) -> OxvgPrefix<'input> {
  let prefix = name
    .prefix
    .as_ref()
    .filter(|prefix| !prefix.is_empty())
    .map(|prefix| prefix.as_ref())
    .or_else(|| match name.ns.as_ref() {
      // html5ever often represents these as namespace-only attributes. XML
      // syntax requires their canonical prefixes, which OXVG also expects.
      "http://www.w3.org/XML/1998/namespace" => Some("xml"),
      "http://www.w3.org/1999/xlink" => Some("xlink"),
      "http://www.w3.org/2000/xmlns/" if name.local.as_ref() != "xmlns" => Some("xmlns"),
      _ => None,
    });
  OxvgPrefix::new(
    allocate_atom(allocator, name.ns.as_ref()),
    prefix.map(|prefix| allocate_atom(allocator, prefix)),
  )
}

fn is_default_xmlns(name: &QualName) -> bool {
  name.ns.as_ref() == "http://www.w3.org/2000/xmlns/"
    && name.prefix.as_ref().is_none_or(|prefix| prefix.is_empty())
    && name.local.as_ref() == "xmlns"
}

fn oxvg_to_parcel<'arena>(
  arena: Arena<'arena>,
  dom: OxvgRef<'_, '_>,
) -> Result<Ref<'arena>, String> {
  let mut preserve_whitespace = false;
  oxvg_node_to_parcel(arena, dom, &mut preserve_whitespace, true, true)?
    .ok_or_else(|| "OXVG produced an empty document".to_owned())
}

fn oxvg_node_to_parcel<'arena>(
  arena: Arena<'arena>,
  source: OxvgRef<'_, '_>,
  preserve_whitespace: &mut bool,
  is_first: bool,
  is_last: bool,
) -> Result<Option<Ref<'arena>>, String> {
  let translated = match source.node_type() {
    OxvgNodeType::Document | OxvgNodeType::DocumentFragment => {
      arena.alloc(Node::new(NodeData::Document, 0))
    }
    OxvgNodeType::DocumentType => return Ok(None),
    OxvgNodeType::Element => {
      let element = source
        .element()
        .ok_or_else(|| "OXVG element had no element data".to_owned())?;
      let mut attrs = Vec::with_capacity(element.attributes().len());
      for attr in element.attributes() {
        if let OxvgAttr::XmlSpace(space) = attr.unaliased() {
          *preserve_whitespace = matches!(space, XmlSpace::Preserve);
        }
        let name = if matches!(attr.name().unaliased(), OxvgAttrId::XMLNS) {
          QualName::new(None, "http://www.w3.org/2000/xmlns/".into(), "xmlns".into())
        } else {
          oxvg_attr_name_to_parcel(attr.prefix(), attr.local_name())
        };
        let value = attr
          .to_value_string(PrinterOptions {
            minify: true,
            ..PrinterOptions::default()
          })
          .map_err(|error| format!("Could not format OXVG attribute: {error}"))?;
        attrs.push(Attribute {
          name,
          value: value.into(),
        });
      }

      arena.alloc(Node::new(
        NodeData::Element {
          name: oxvg_name_to_parcel(element.prefix(), element.local_name()),
          attrs: RefCell::new(attrs),
          template_contents: None,
          mathml_annotation_xml_integration_point: false,
        },
        0,
      ))
    }
    OxvgNodeType::Text | OxvgNodeType::CDataSection => {
      let Some(text) = source.text_content() else {
        return Ok(None);
      };
      let Some(text) = normalize_oxvg_text(&text, *preserve_whitespace, is_first, is_last) else {
        return Ok(None);
      };
      arena.alloc(Node::new(
        NodeData::Text {
          contents: RefCell::new(text.into()),
        },
        0,
      ))
    }
    OxvgNodeType::Style => {
      let Some(style) = source.style() else {
        return Ok(None);
      };
      let text = style
        .borrow()
        .to_value_string(PrinterOptions {
          minify: true,
          ..PrinterOptions::default()
        })
        .map_err(|error| format!("Could not format OXVG style: {error}"))?;
      arena.alloc(Node::new(
        NodeData::Text {
          contents: RefCell::new(text.into()),
        },
        0,
      ))
    }
    OxvgNodeType::Comment => {
      let contents = source.text_content().unwrap_or_default().to_string();
      arena.alloc(Node::new(
        NodeData::Comment {
          contents: contents.into(),
        },
        0,
      ))
    }
    OxvgNodeType::ProcessingInstruction => {
      let (target, contents) = source
        .processing_instruction()
        .ok_or_else(|| "OXVG processing instruction had no data".to_owned())?;
      arena.alloc(Node::new(
        NodeData::ProcessingInstruction {
          target: target.to_string().into(),
          contents: RefCell::new(
            contents
              .map(|contents| contents.to_string())
              .unwrap_or_default()
              .into(),
          ),
        },
        0,
      ))
    }
  };

  for child in source.child_nodes_iter() {
    let child_is_first = source.first_child().is_none_or(|node| node == child)
      || child
        .previous_sibling()
        .is_some_and(|node| node.node_type() == OxvgNodeType::Text);
    let child_is_last = source.last_child().is_none_or(|node| node == child)
      || child
        .next_sibling()
        .is_some_and(|node| node.node_type() == OxvgNodeType::Text);
    if let Some(child) = oxvg_node_to_parcel(
      arena,
      child,
      preserve_whitespace,
      child_is_first,
      child_is_last,
    )? {
      translated.append(child);
    }
  }

  Ok(Some(translated))
}

fn oxvg_name_to_parcel(prefix: &OxvgPrefix<'_>, local: &OxvgAtom<'_>) -> QualName {
  QualName::new(
    prefix.value().map(|prefix| prefix.as_str().into()),
    prefix.ns().uri().as_str().into(),
    local.as_str().into(),
  )
}

fn oxvg_attr_name_to_parcel(prefix: &OxvgPrefix<'_>, local: &OxvgAtom<'_>) -> QualName {
  let Some(prefix_value) = prefix.value() else {
    // Default namespaces do not apply to attributes in XML.
    return QualName::new(None, "".into(), local.as_str().into());
  };
  QualName::new(
    Some(prefix_value.as_str().into()),
    prefix.ns().uri().as_str().into(),
    local.as_str().into(),
  )
}

fn normalize_oxvg_text(
  text: &str,
  preserve_whitespace: bool,
  is_first: bool,
  is_last: bool,
) -> Option<String> {
  if preserve_whitespace {
    return Some(
      text
        .chars()
        .map(|character| match character {
          '\n' | '\t' => ' ',
          character => character,
        })
        .collect(),
    );
  }
  if text.trim_start().is_empty() {
    return None;
  }

  let mut output = String::new();
  if !is_first && text.starts_with(char::is_whitespace) {
    output.push(' ');
  }
  let mut parts = text.split_whitespace();
  output.push_str(parts.next()?);
  for part in parts {
    output.push(' ');
    output.push_str(part);
  }
  if !is_last && text.ends_with(char::is_whitespace) {
    output.push(' ');
  }
  Some(output)
}

fn first_element<'arena>(root: Ref<'arena>) -> Option<Ref<'arena>> {
  if matches!(root.data, NodeData::Element { .. }) {
    return Some(root);
  }
  let mut child = root.first_child.get();
  while let Some(node) = child {
    if let Some(element) = first_element(node) {
      return Some(element);
    }
    child = node.next_sibling.get();
  }
  None
}

fn children<'arena>(root: Ref<'arena>) -> impl Iterator<Item = Ref<'arena>> {
  let mut child = root.first_child.get();
  std::iter::from_fn(move || {
    let res = child;
    if let Some(node) = child {
      child = node.next_sibling.get();
    }
    res
  })
}

fn replace_document<'arena>(root: Ref<'arena>, translated: Ref<'arena>, preserve_doctype: bool) {
  let doctypes = preserve_doctype
    .then(|| {
      children(root)
        .into_iter()
        .filter(|node| matches!(node.data, NodeData::Doctype { .. }))
        .collect::<Vec<_>>()
    })
    .unwrap_or_default();
  let translated_children = children(translated);

  for child in children(root) {
    child.detach();
  }

  let mut inserted_doctype = false;
  for child in translated_children {
    if !inserted_doctype && matches!(child.data, NodeData::Element { .. }) {
      for doctype in &doctypes {
        root.append(doctype);
      }
      inserted_doctype = true;
    }
    root.append(child);
  }
  if !inserted_doctype {
    for doctype in doctypes {
      root.append(doctype);
    }
  }
}

fn replace_element<'arena>(root: Ref<'arena>, translated: Ref<'arena>) {
  if let Some(element) = first_element(translated) {
    root.insert_before(element);
  }
  root.detach();
}

#[derive(Deserialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrefixIdsOptions {
  pub delim: Option<String>,
  #[serde(default)]
  pub prefix: Option<String>,
  #[serde(default)]
  pub prefix_ids: Option<bool>,
  #[serde(default)]
  pub prefix_class_names: Option<bool>,
}

#[derive(Deserialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OxvgConfig {
  #[serde(deserialize_with = "ok_or_default")]
  pub default: DefaultTrue,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub add_attributes_to_svg_element: ConfigItem<oxvg_optimiser::AddAttributesToSVGElement>,
  #[serde(
    default,
    deserialize_with = "ok_or_default",
    rename = "addClassesToSVGElement"
  )]
  pub add_classes_to_svg: ConfigItem<oxvg_optimiser::AddClassesToSVGElement>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub cleanup_list_of_values: ConfigItem<oxvg_optimiser::CleanupListOfValues>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub prefix_ids: ConfigItem<PrefixIdsOptions>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_attributes_by_selector: ConfigItem<oxvg_optimiser::RemoveAttributesBySelector>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_attrs: ConfigItem<oxvg_optimiser::RemoveAttrs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_dimensions: ConfigItem<oxvg_optimiser::RemoveDimensions>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_elements_by_attr: ConfigItem<oxvg_optimiser::RemoveElementsByAttr>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_off_canvas_paths: ConfigItem<oxvg_optimiser::RemoveOffCanvasPaths>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_raster_images: ConfigItem<oxvg_optimiser::RemoveRasterImages>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_scripts: ConfigItem<oxvg_optimiser::RemoveScripts>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_style_element: ConfigItem<oxvg_optimiser::RemoveStyleElement>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_title: ConfigItem<oxvg_optimiser::RemoveTitle>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_view_box: ConfigItem<oxvg_optimiser::RemoveViewBox>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub reuse_paths: ConfigItem<()>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_doctype: ConfigItem<oxvg_optimiser::RemoveDoctype>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_xml_proc_inst: ConfigItem<oxvg_optimiser::RemoveXMLProcInst>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_comments: ConfigItem<oxvg_optimiser::RemoveComments>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_deprecated_attrs: ConfigItem<oxvg_optimiser::RemoveDeprecatedAttrs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_metadata: ConfigItem<oxvg_optimiser::RemoveMetadata>,
  #[serde(default, deserialize_with = "ok_or_default", rename = "cleanupAttrs")]
  pub cleanup_attributes: ConfigItem<oxvg_optimiser::CleanupAttrs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub merge_styles: ConfigItem<()>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub inline_styles: ConfigItem<oxvg_optimiser::InlineStyles>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub minify_styles: ConfigItem<oxvg_optimiser::MinifyStyles>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub cleanup_ids: ConfigItem<oxvg_optimiser::CleanupIds>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_useless_defs: ConfigItem<oxvg_optimiser::RemoveUselessDefs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub cleanup_numeric_values: ConfigItem<oxvg_optimiser::CleanupNumericValues>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub convert_colors: ConfigItem<oxvg_optimiser::ConvertColors>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_unknowns_and_defaults: ConfigItem<oxvg_optimiser::RemoveUnknownsAndDefaults>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_non_inheritable_group_attrs:
    ConfigItem<oxvg_optimiser::RemoveNonInheritableGroupAttrs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_useless_stroke_and_fill: ConfigItem<oxvg_optimiser::RemoveUselessStrokeAndFill>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub cleanup_enable_background: ConfigItem<oxvg_optimiser::CleanupEnableBackground>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_hidden_elems: ConfigItem<oxvg_optimiser::RemoveHiddenElems>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_empty_text: ConfigItem<oxvg_optimiser::RemoveEmptyText>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub convert_shape_to_path: ConfigItem<oxvg_optimiser::ConvertShapeToPath>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub convert_ellipse_to_circle: ConfigItem<oxvg_optimiser::ConvertEllipseToCircle>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub move_elems_attrs_to_group: ConfigItem<oxvg_optimiser::MoveElemsAttrsToGroup>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub move_group_attrs_to_elems: ConfigItem<oxvg_optimiser::MoveGroupAttrsToElems>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub collapse_groups: ConfigItem<oxvg_optimiser::CollapseGroups>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub apply_transforms: ConfigItem<oxvg_optimiser::ApplyTransforms>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub convert_path_data: ConfigItem<oxvg_optimiser::ConvertPathData>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub convert_transform: ConfigItem<oxvg_optimiser::ConvertTransform>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_empty_attrs: ConfigItem<oxvg_optimiser::RemoveEmptyAttrs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_empty_containers: ConfigItem<oxvg_optimiser::RemoveEmptyContainers>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub merge_paths: ConfigItem<oxvg_optimiser::MergePaths>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub sort_attrs: ConfigItem<oxvg_optimiser::SortAttrs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub sort_defs_children: ConfigItem<oxvg_optimiser::SortDefsChildren>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_desc: ConfigItem<oxvg_optimiser::RemoveDesc>,
  #[serde(
    default,
    deserialize_with = "ok_or_default",
    rename = "removeEditorsNSData"
  )]
  pub remove_editors_ns_data: ConfigItem<oxvg_optimiser::RemoveEditorsNSData>,
  #[serde(default, deserialize_with = "ok_or_default", rename = "removeUnusedNS")]
  pub remove_unused_n_s: ConfigItem<oxvg_optimiser::RemoveUnusedNS>,
  #[serde(default, deserialize_with = "ok_or_default", rename = "removeXMLNS")]
  pub remove_x_m_l_n_s: ConfigItem<oxvg_optimiser::RemoveXMLNS>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_xlink: ConfigItem<oxvg_optimiser::RemoveXlink>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(transparent)]
pub struct DefaultTrue(bool);

impl Default for DefaultTrue {
  fn default() -> Self {
    Self(true)
  }
}

#[derive(Deserialize, Default, Debug, Clone)]
#[serde(untagged)]
pub enum ConfigItem<C> {
  #[serde(skip)]
  #[default]
  None,
  Bool(bool),
  Config(C),
}

impl<C> ConfigItem<C> {
  fn is_some(&self) -> bool {
    matches!(self, Self::Bool(true) | Self::Config(_))
  }
}

fn ok_or_default<'de, T, D>(deserializer: D) -> Result<T, D::Error>
where
  T: serde::Deserialize<'de> + Default,
  D: serde::Deserializer<'de>,
{
  Ok(T::deserialize(deserializer).unwrap_or_default())
}

pub enum OxvgKind {
  Html,
  Svg,
}

impl OxvgConfig {
  pub fn into_jobs(&self, kind: OxvgKind, path: &str) -> oxvg_optimiser::Jobs {
    let mut jobs = if self.default.0 {
      match kind {
        OxvgKind::Html => oxvg_optimiser::Jobs {
          convert_shape_to_path: None,
          remove_title: None,
          remove_desc: None,
          remove_unknowns_and_defaults: Some(oxvg_optimiser::RemoveUnknownsAndDefaults {
            keep_aria_attrs: true,
            keep_role_attr: true,
            ..Default::default()
          }),
          cleanup_ids: None,
          remove_hidden_elems: None,
          ..Default::default()
        },
        OxvgKind::Svg => oxvg_optimiser::Jobs {
          cleanup_ids: None,
          ..Default::default()
        },
      }
    } else {
      oxvg_optimiser::Jobs::none()
    };

    macro_rules! job {
      ($config:ident => $job:ident) => {
        jobs.$job = match &self.$config {
          ConfigItem::None => jobs.$job,
          ConfigItem::Bool(true) => Some(Default::default()),
          ConfigItem::Bool(false) => None,
          ConfigItem::Config(config) => Some(config.clone().into()),
        };
      };
      ($name:ident) => {
        job!($name => $name);
      };
    }

    job!(add_attributes_to_svg_element => add_attributes_to_s_v_g_element);
    job!(add_classes_to_svg => add_classes_to_s_v_g_element);
    job!(cleanup_list_of_values);
    jobs.prefix_ids = match &self.prefix_ids {
      ConfigItem::None => jobs.prefix_ids,
      ConfigItem::Bool(false) => None,
      ConfigItem::Bool(true) => Some(prefix_ids(path, None)),
      ConfigItem::Config(config) => Some(prefix_ids(path, Some(config))),
    };
    job!(remove_attributes_by_selector);
    job!(remove_attrs);
    job!(remove_dimensions);
    job!(remove_elements_by_attr);
    job!(remove_off_canvas_paths);
    job!(remove_raster_images);
    job!(remove_scripts);
    job!(remove_style_element);
    job!(remove_title);
    job!(remove_view_box);
    bool_job(&self.reuse_paths, &mut jobs.reuse_paths);
    job!(remove_doctype);
    job!(remove_xml_proc_inst => remove_x_m_l_proc_inst);
    job!(remove_comments);
    job!(remove_deprecated_attrs);
    job!(remove_metadata);
    job!(cleanup_attributes => cleanup_attrs);
    bool_job(&self.merge_styles, &mut jobs.merge_styles);
    job!(inline_styles);
    job!(minify_styles);
    job!(cleanup_ids);
    job!(remove_useless_defs);
    job!(cleanup_numeric_values);
    job!(convert_colors);
    job!(remove_unknowns_and_defaults);
    job!(remove_non_inheritable_group_attrs);
    job!(remove_useless_stroke_and_fill);
    job!(cleanup_enable_background);
    job!(remove_hidden_elems);
    job!(remove_empty_text);
    job!(convert_shape_to_path);
    job!(convert_ellipse_to_circle);
    job!(move_elems_attrs_to_group);
    job!(move_group_attrs_to_elems);
    job!(collapse_groups);
    job!(apply_transforms);
    job!(convert_path_data);
    job!(convert_transform);
    job!(remove_empty_attrs);
    job!(remove_empty_containers);
    job!(merge_paths);
    job!(sort_attrs);
    job!(sort_defs_children);
    job!(remove_desc);
    job!(remove_editors_ns_data => remove_editors_n_s_data);
    job!(remove_unused_n_s);
    job!(remove_x_m_l_n_s);
    job!(remove_xlink);
    jobs
  }

  pub fn has_any_jobs(&self) -> bool {
    self.default.0
      || self.add_attributes_to_svg_element.is_some()
      || self.add_classes_to_svg.is_some()
      || self.cleanup_list_of_values.is_some()
      || self.prefix_ids.is_some()
      || self.remove_attributes_by_selector.is_some()
      || self.remove_attrs.is_some()
      || self.remove_dimensions.is_some()
      || self.remove_elements_by_attr.is_some()
      || self.remove_off_canvas_paths.is_some()
      || self.remove_raster_images.is_some()
      || self.remove_scripts.is_some()
      || self.remove_style_element.is_some()
      || self.remove_title.is_some()
      || self.remove_view_box.is_some()
      || self.reuse_paths.is_some()
      || self.remove_doctype.is_some()
      || self.remove_xml_proc_inst.is_some()
      || self.remove_comments.is_some()
      || self.remove_deprecated_attrs.is_some()
      || self.remove_metadata.is_some()
      || self.cleanup_attributes.is_some()
      || self.merge_styles.is_some()
      || self.inline_styles.is_some()
      || self.minify_styles.is_some()
      || self.cleanup_ids.is_some()
      || self.remove_useless_defs.is_some()
      || self.cleanup_numeric_values.is_some()
      || self.convert_colors.is_some()
      || self.remove_unknowns_and_defaults.is_some()
      || self.remove_non_inheritable_group_attrs.is_some()
      || self.remove_useless_stroke_and_fill.is_some()
      || self.cleanup_enable_background.is_some()
      || self.remove_hidden_elems.is_some()
      || self.remove_empty_text.is_some()
      || self.convert_shape_to_path.is_some()
      || self.convert_ellipse_to_circle.is_some()
      || self.move_elems_attrs_to_group.is_some()
      || self.move_group_attrs_to_elems.is_some()
      || self.collapse_groups.is_some()
      || self.apply_transforms.is_some()
      || self.convert_path_data.is_some()
      || self.convert_transform.is_some()
      || self.remove_empty_attrs.is_some()
      || self.remove_empty_containers.is_some()
      || self.merge_paths.is_some()
      || self.sort_attrs.is_some()
      || self.sort_defs_children.is_some()
      || self.remove_desc.is_some()
      || self.remove_editors_ns_data.is_some()
      || self.remove_unused_n_s.is_some()
      || self.remove_x_m_l_n_s.is_some()
      || self.remove_xlink.is_some()
  }
}

fn bool_job<T: Default>(config: &ConfigItem<()>, job: &mut Option<T>) {
  *job = match config {
    ConfigItem::None => job.take(),
    ConfigItem::Bool(true) => Some(Default::default()),
    ConfigItem::Bool(false) => None,
    ConfigItem::Config(()) => unreachable!(),
  };
}

fn prefix_ids(path: &str, config: Option<&PrefixIdsOptions>) -> oxvg_optimiser::PrefixIds {
  let hash = format!("{:x}", xxh3_64(path.as_bytes()));
  let mut value = serde_json::Map::new();
  value.insert(
    "prefix".into(),
    config
      .and_then(|config| config.prefix.clone())
      .unwrap_or_else(|| hash[hash.len() - 6..].to_owned())
      .into(),
  );
  if let Some(delim) = config.and_then(|config| config.delim.clone()) {
    value.insert("delim".into(), delim.into());
  }
  if let Some(prefix_ids) = config.and_then(|config| config.prefix_ids) {
    value.insert("prefixIds".into(), prefix_ids.into());
  }
  if let Some(prefix_class_names) = config.and_then(|config| config.prefix_class_names) {
    value.insert("prefixClassNames".into(), prefix_class_names.into());
  }
  serde_json::from_value(value.into()).unwrap_or_default()
}
