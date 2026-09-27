use std::{cell::RefCell, collections::HashMap};

use crate::{
  SerializableTendril,
  arena::{Node, NodeData},
  dependencies::{is_func_iri_attr, parse_xml_stylesheet, serialize_xml_stylesheet},
  srcset::{parse_srcset, serialize_srcset},
};
use html5ever::{ExpandedName, expanded_name, local_name, namespace_url, ns, tendril::StrTendril};
use serde::Deserialize;
use typed_arena::Arena;

/// A stylesheet bundle loaded by a specific element's bundle, emitted as a
/// link inserted before that element so cascade order follows the element's
/// document position.
#[derive(Deserialize)]
pub struct StyleSheetRef {
  pub href: SerializableTendril,
  #[serde(default)]
  pub media: Option<SerializableTendril>,
}

#[derive(Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum BundleReference {
  StyleSheet {
    href: SerializableTendril,
    /// Derived media gate for the whole bundle, emitted on the injected link.
    #[serde(default)]
    media: Option<SerializableTendril>,
  },
  Script {
    src: SerializableTendril,
    module: bool,
    nomodule: bool,
  },
}

#[derive(Deserialize)]
pub struct InlineBundle {
  pub contents: SerializableTendril,
  pub module: bool,
}

pub fn insert_bundle_references<'arena>(
  arena: &'arena Arena<Node<'arena>>,
  dom: &'arena Node<'arena>,
  bundles: Vec<BundleReference>,
  inline_bundles: HashMap<SerializableTendril, InlineBundle>,
  stylesheet_media: &HashMap<SerializableTendril, Option<SerializableTendril>>,
  stylesheet_refs: &HashMap<SerializableTendril, Vec<StyleSheetRef>>,
  mut import_map: serde_json::map::Map<String, serde_json::Value>,
  head_script: Option<String>,
) {
  let data_parcel_key = ExpandedName {
    ns: &ns!(),
    local: &"data-parcel-key".into(),
  };

  let mut import_map_node = None;

  dom.walk(&mut |node| {
    if let NodeData::Element { name, attrs, .. } = &node.data {
      // Stylesheets referenced by this element's bundle load before it, in
      // the bundle's application order. Attribute values still hold the
      // placeholders at this point, before the replacement loop below.
      if !stylesheet_refs.is_empty() {
        let placeholders: Vec<StrTendril> = attrs
          .borrow()
          .iter()
          .map(|attr| attr.value.clone())
          .collect();
        for value in placeholders {
          if let Some(refs) = stylesheet_refs.get(&SerializableTendril(value)) {
            for reference in refs {
              let link = arena.alloc(Node::create_element(expanded_name!(html "link")));
              link.set_attribute(expanded_name!("", "rel"), "stylesheet");
              link.set_attribute(expanded_name!("", "href"), &reference.href.0);
              if let Some(media) = &reference.media {
                link.set_attribute(expanded_name!("", "media"), &media.0);
              }
              node.insert_before(link);
            }
          }
        }
      }
      match name.expanded() {
        expanded_name!(html "script") | expanded_name!(svg "script") => {
          if let Some(key) = node.get_attribute(data_parcel_key.clone()) {
            if let Some(bundle) = inline_bundles.get(&SerializableTendril(key)) {
              node.remove_attribute(data_parcel_key.clone());
              node.set_text_content(arena, bundle.contents.0.clone());
              if bundle.module {
                node.set_attribute(expanded_name!("", "type"), "module");
              }
            }
          } else if let Some(t) = node.get_attribute(expanded_name!("", "type")) {
            if t.as_ref() == "importmap" {
              import_map_node = Some(node);
            }
          }
        }
        expanded_name!(html "link") => {
          // The media attribute of a stylesheet link is re-derived from the
          // resolved bundle: kept or added when a common gate covers every
          // asset, removed when it would wrongly gate co-placed content.
          if let Some(href) = node.get_attribute(expanded_name!("", "href")) {
            if let Some(media) = stylesheet_media.get(&SerializableTendril(href)) {
              match media {
                Some(media) => {
                  node.set_attribute(expanded_name!("", "media"), &media.0);
                }
                None => {
                  node.remove_attribute(expanded_name!("", "media"));
                }
              }
            }
          }
        }
        expanded_name!(html "style") | expanded_name!(svg "style") => {
          if let Some(key) = node.get_attribute(data_parcel_key.clone()) {
            if let Some(bundle) = inline_bundles.get(&SerializableTendril(key)) {
              node.remove_attribute(data_parcel_key.clone());
              node.set_text_content(arena, bundle.contents.0.clone());
            }
          }
        }
        _ => {}
      }

      for attr in attrs.borrow_mut().iter_mut() {
        if attr.name.expanded() == expanded_name!("", "srcset")
          || attr.name.local.as_ref() == "imagesrcset"
        {
          let mut srcset = parse_srcset(&attr.value);
          for img in &mut srcset {
            if let Some(bundle) = inline_bundles.get(&SerializableTendril(img.url.clone().into())) {
              img.url = bundle.contents.0.clone().into();
            }
          }

          attr.value = serialize_srcset(srcset).into();
        } else if let Some(bundle) = inline_bundles.get(&SerializableTendril(attr.value.clone())) {
          if is_func_iri_attr(&attr.name) {
            use cssparser::ToCss;
            let placeholder =
              cssparser::Token::UnquotedUrl(cssparser::CowRcStr::from(bundle.contents.0.as_ref()))
                .to_css_string()
                .into();
            attr.value = placeholder;
          } else {
            attr.value = bundle.contents.0.clone();
          }
        }
      }
    } else if let NodeData::ProcessingInstruction { target, contents } = &node.data {
      if target.as_ref() == "xml-stylesheet" {
        let mut contents = contents.borrow_mut();
        if let Ok(mut attrs) = parse_xml_stylesheet(&contents) {
          for attr in &mut attrs {
            if let Some(bundle) = inline_bundles.get(&SerializableTendril(attr.value.clone())) {
              attr.value = bundle.contents.0.clone();
            }
          }

          *contents = serialize_xml_stylesheet(attrs);
        }
      }
    }
  });

  if let Some(head) = dom.find(expanded_name!(html "head")) {
    for bundle in bundles.into_iter().rev() {
      match bundle {
        BundleReference::StyleSheet { href, media } => {
          let node = arena.alloc(Node::create_element(expanded_name!(html "link")));
          node.set_attribute(expanded_name!("", "rel"), "stylesheet");
          node.set_attribute(expanded_name!("", "href"), &href.0);
          if let Some(media) = media {
            node.set_attribute(expanded_name!("", "media"), &media.0);
          }
          head.prepend(node);
        }
        BundleReference::Script {
          src,
          module,
          nomodule,
        } => {
          let node = arena.alloc(Node::create_element(expanded_name!(html "script")));
          if module {
            node.set_attribute(expanded_name!("", "type"), "module");
          }
          if nomodule {
            node.set_attribute(expanded_name!("", "nomodule"), "");
            node.set_attribute(expanded_name!("", "defer"), "");
          }
          node.set_attribute(expanded_name!("", "src"), &src.0);
          head.prepend(node);
        }
      }
    }

    if !import_map.is_empty() {
      // If there is an existing <script type="importmap">, merge with that.
      // This will remove the existing node so it is moved before all other scripts.
      if let Some(import_map_node) = import_map_node {
        let content: Result<serde_json::Value, _> =
          serde_json::from_str(&import_map_node.text_content());
        if let Ok(serde_json::Value::Object(mut obj)) = content {
          if let Some(serde_json::Value::Object(imports)) = obj.get_mut("imports") {
            imports.append(&mut import_map);
            if let Ok(json) = serde_json::to_string(&obj) {
              import_map_node.set_text_content(arena, json.into());
            }
          }
        }
        head.prepend(import_map_node);
      } else {
        let node = arena.alloc(Node::create_element(expanded_name!(html "script")));
        node.set_attribute(expanded_name!("", "type"), "importmap");
        let mut map = serde_json::Map::new();
        map.insert("imports".into(), serde_json::Value::Object(import_map));
        if let Ok(json) = serde_json::to_string(&map) {
          node.set_text_content(arena, json.into());
        }
        head.prepend(node);
      }
    }

    if let Some(head_script) = head_script {
      let node = arena.alloc(Node::create_element(expanded_name!(html "script")));
      node.set_text_content(arena, head_script.into());
      head.prepend(node);
    }
  } else if let Some(svg) = dom.find(expanded_name!(svg "svg")) {
    for bundle in bundles.into_iter().rev() {
      match bundle {
        BundleReference::StyleSheet { href, media } => {
          let mut attrs = vec![xml5ever::Attribute {
            name: xml5ever::QualName::new(None, ns!(), local_name!("href")),
            value: href.0,
          }];
          if let Some(media) = media {
            attrs.push(xml5ever::Attribute {
              name: xml5ever::QualName::new(None, ns!(), local_name!("media")),
              value: media.0,
            });
          }
          let node = arena.alloc(Node::new(
            NodeData::ProcessingInstruction {
              target: "xml-stylesheet".into(),
              contents: RefCell::new(serialize_xml_stylesheet(attrs)),
            },
            1,
          ));
          dom.prepend(node);
        }
        BundleReference::Script { src, .. } => {
          let node = arena.alloc(Node::create_element(expanded_name!(svg "script")));
          node.set_attribute(expanded_name!("", "href"), &src.0);
          svg.prepend(node);
        }
      }
    }
  }
}
