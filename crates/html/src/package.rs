use std::{
  cell::RefCell,
  collections::{HashMap, HashSet},
};

use crate::{
  SerializableTendril,
  arena::{Node, NodeData, Ref, Sink},
  dependencies::{is_func_iri_attr, is_parcel_tag, parse_xml_stylesheet, serialize_xml_stylesheet},
  head::{can_hoist_from, collect_hoistable, head_key, insert_into_head},
  srcset::{parse_srcset, serialize_srcset},
};
use html5ever::{ExpandedName, expanded_name, local_name, namespace_url, ns, tendril::StrTendril};
use serde::Deserialize;
use typed_arena::Arena;
use xml5ever::tendril::TendrilSink;

#[derive(Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum BundleReference {
  StyleSheet {
    href: SerializableTendril,
    /// Derived media gate for the whole bundle, emitted on the link or @import.
    #[serde(default)]
    media: Option<SerializableTendril>,
  },
  Script {
    src: SerializableTendril,
    module: bool,
  },
}

impl BundleReference {
  fn url(&self) -> &SerializableTendril {
    match self {
      BundleReference::StyleSheet { href, .. } => href,
      BundleReference::Script { src, .. } => src,
    }
  }

  fn create_element<'arena>(
    &self,
    arena: &'arena Arena<Node<'arena>>,
    source: Option<Ref<'arena>>,
  ) -> Ref<'arena> {
    let svg = source.is_some_and(
      |node| matches!(&node.data, NodeData::Element { name, .. } if name.ns == ns!(svg)),
    );
    let local = match self {
      BundleReference::StyleSheet { .. } if svg => local_name!("style"),
      BundleReference::StyleSheet { .. } => local_name!("link"),
      BundleReference::Script { .. } => local_name!("script"),
    };
    let namespace = if svg { ns!(svg) } else { ns!(html) };
    let mut element = Node::create_element(ExpandedName {
      ns: &namespace,
      local: &local,
    });

    if let Some(source) = source {
      if let (
        NodeData::Element { name, attrs, .. },
        NodeData::Element {
          name: element_name,
          attrs: element_attrs,
          ..
        },
      ) = (&source.data, &mut element.data)
      {
        element_name.prefix = name.prefix.clone();
        // A namespace declared on the referring element isn't in scope for
        // its new sibling. Copy that binding when preserving the prefix.
        let binding = name
          .prefix
          .as_ref()
          .map(|prefix| prefix.as_ref())
          .unwrap_or("xmlns");
        if let Some(attr) = attrs
          .borrow()
          .iter()
          .find(|attr| attr.name.ns == ns!(xmlns) && attr.name.local.as_ref() == binding)
        {
          element_attrs.get_mut().push(attr.clone());
        }
      }
    }

    let element: Ref = arena.alloc(element);
    match self {
      BundleReference::StyleSheet { href, media } if svg => {
        // SVG styles preserve cascade position in both standalone XML and
        // inline HTML. xml-stylesheet PIs can only apply in the XML prolog,
        // and HTML links cannot be parsed inside inline SVG in text/html.
        use cssparser::ToCss;
        let url = cssparser::Token::UnquotedUrl(href.0.as_ref().into()).to_css_string();
        let mut css = format!("@import {url}");
        if let Some(media) = media {
          css.push(' ');
          css.push_str(&media.0);
        }
        css.push(';');
        element.set_text_content(arena, css.into());
      }
      BundleReference::StyleSheet { href, media } => {
        element.set_attribute(expanded_name!("", "rel"), "stylesheet");
        element.set_attribute(expanded_name!("", "href"), &href.0);
        if let Some(media) = media {
          element.set_attribute(expanded_name!("", "media"), &media.0);
        }
      }
      BundleReference::Script { src, module } => {
        if *module {
          element.set_attribute(expanded_name!("", "type"), "module");
        }
        let attr = if svg {
          local_name!("href")
        } else {
          local_name!("src")
        };
        element.set_attribute(
          ExpandedName {
            ns: &ns!(),
            local: &attr,
          },
          &src.0,
        );
      }
    }
    element
  }
}

#[derive(Deserialize)]
pub struct InlineBundle {
  pub contents: SerializableTendril,
  pub module: bool,
}

/// Escapes JavaScript for an HTML `<script>` element, whose content is raw text that a `</script`
/// ends, and in which `<!--` can start a comment-like state that hides a following `</script>`.
/// Replacing `</script` with `</\script` and `<!--` with `<\!--` keeps string and template literals
/// equal, since `\s` and `\!` are identity escapes there, while `<\/script` could change a regular
/// expression such as `0</script/`.
fn escape_inline_script(code: &StrTendril) -> StrTendril {
  const CLOSE_TAG: &str = "</script";
  let mut escaped = String::with_capacity(code.len() + 8);
  let mut rest: &str = code;
  while let Some(index) = rest.find('<') {
    escaped.push_str(&rest[..index]);
    rest = &rest[index..];
    if rest.starts_with("<!--") {
      escaped.push_str("<\\!--");
      rest = &rest[4..];
    } else if rest
      .get(..CLOSE_TAG.len())
      .is_some_and(|tag| tag.eq_ignore_ascii_case(CLOSE_TAG))
    {
      escaped.push_str("</\\");
      escaped.push_str(&rest[2..CLOSE_TAG.len()]);
      rest = &rest[CLOSE_TAG.len()..];
    } else {
      escaped.push('<');
      rest = &rest[1..];
    }
  }
  escaped.push_str(rest);
  escaped.into()
}

/// Wraps a page in the layout referenced by its `<parcel:layout src="...">` element.
///
/// The layout document becomes the page. The content of the page's `<body>` (with the
/// `<parcel:layout>` element unwrapped) fills the layout's `<parcel:slot>` elements: elements with a
/// `slot="name"` attribute go to `<parcel:slot name="name">`, and everything else to the unnamed
/// slot. A slot that receives no content keeps its children as a fallback. Elements in the page's
/// `<head>` are appended to the layout's, replacing those with the same key (e.g. `<title>`), and
/// attributes on the page's `<html>` and `<body>` are merged onto the layout's. Head elements within
/// the page's content (e.g. a `<title>` in markdown) are hoisted into the layout's `<head>` too, but
/// those in the layout's own body are left in place.
///
/// Slots are collected before content is moved in, so a `<parcel:slot>` within the page (i.e. a
/// layout that itself uses a layout) is passed through for the next page to fill.
pub fn apply_layout<'arena>(
  arena: &'arena Arena<Node<'arena>>,
  dom: Ref<'arena>,
  inline_bundles: &HashMap<SerializableTendril, InlineBundle>,
) {
  let Some(page_layout) = find_parcel_tag(dom, "layout") else {
    return;
  };
  let Some(bundle) = page_layout
    .get_attribute(expanded_name!("", "src"))
    .and_then(|src| inline_bundles.get(&SerializableTendril(src)))
  else {
    return;
  };

  let layout = html5ever::driver::parse_document(Sink::new(arena), Default::default())
    .one(&*bundle.contents.0);

  let mut slots = Vec::new();
  layout.walk(&mut |n| {
    if let NodeData::Element { name, .. } = &n.data {
      if is_parcel_tag(&name.expanded(), "slot") {
        slots.push(n);
      }
    }
  });

  // The page's content, in document order, with <parcel:layout> unwrapped.
  let page_body = dom.find(expanded_name!(html "body"));
  let content = match page_layout.parent.get() {
    Some(parent) if page_body.is_some_and(|body| std::ptr::eq(parent, body)) => children(parent)
      .into_iter()
      .flat_map(|n| {
        if std::ptr::eq(n, page_layout) {
          children(n)
        } else {
          vec![n]
        }
      })
      .collect(),
    _ => children(page_layout),
  };

  let mut hoisted = Vec::new();
  for &node in &content {
    collect_hoistable(node, &mut hoisted);
  }
  for &node in &hoisted {
    node.detach();
  }

  let mut slotted: HashMap<StrTendril, Vec<Ref<'arena>>> = HashMap::new();
  for node in content {
    if node.parent.get().is_none() {
      // Hoisted.
      continue;
    }
    let name = node
      .get_attribute(expanded_name!("", "slot"))
      .unwrap_or_default();
    node.remove_attribute(expanded_name!("", "slot"));
    slotted.entry(name).or_default().push(node);
  }

  for slot in slots {
    let name = slot
      .get_attribute(expanded_name!("", "name"))
      .unwrap_or_default();
    let nodes = slotted.remove(&name).unwrap_or_else(|| children(slot));
    for node in nodes {
      slot.insert_before(node);
    }
    slot.detach();
  }

  if let (Some(page_head), Some(layout_head)) = (
    dom.find(expanded_name!(html "head")),
    layout.find(expanded_name!(html "head")),
  ) {
    insert_into_head(layout_head, children(page_head));
    insert_into_head(layout_head, hoisted);
  }

  merge_attributes(
    dom.find(expanded_name!(html "html")),
    layout.find(expanded_name!(html "html")),
  );
  merge_attributes(page_body, layout.find(expanded_name!(html "body")));

  for node in children(dom) {
    node.detach();
  }
  for node in children(layout) {
    dom.append(node);
  }
}

fn children<'arena>(node: Ref<'arena>) -> Vec<Ref<'arena>> {
  let mut children = Vec::new();
  let mut child = node.first_child.get();
  while let Some(c) = child {
    children.push(c);
    child = c.next_sibling.get();
  }
  children
}

fn find_parcel_tag<'arena>(node: Ref<'arena>, tag: &str) -> Option<Ref<'arena>> {
  let mut found = None;
  node.walk(&mut |n| {
    if found.is_none() {
      if let NodeData::Element { name, .. } = &n.data {
        if is_parcel_tag(&name.expanded(), tag) {
          found = Some(n);
        }
      }
    }
  });
  found
}

/// Copies attributes from the page's `<html>` or `<body>` onto the layout's. The page's values win,
/// except `class`, which is combined.
fn merge_attributes<'arena>(from: Option<Ref<'arena>>, to: Option<Ref<'arena>>) {
  let (
    Some(from),
    Some(NodeData::Element {
      attrs: to_attrs, ..
    }),
  ) = (from, to.map(|n| &n.data))
  else {
    return;
  };
  let NodeData::Element { attrs, .. } = &from.data else {
    return;
  };
  let mut to_attrs = to_attrs.borrow_mut();
  for attr in attrs.borrow().iter() {
    match to_attrs.iter_mut().find(|a| a.name == attr.name) {
      Some(existing) if attr.name.expanded() == expanded_name!("", "class") => {
        let mut value = existing.value.clone();
        value.push_char(' ');
        value.push_tendril(&attr.value);
        existing.value = value;
      }
      Some(existing) => existing.value = attr.value.clone(),
      None => to_attrs.push(attr.clone()),
    }
  }
}

pub fn insert_bundle_references<'arena>(
  arena: &'arena Arena<Node<'arena>>,
  dom: &'arena Node<'arena>,
  bundles: Vec<BundleReference>,
  inline_bundles: HashMap<SerializableTendril, InlineBundle>,
  stylesheet_media: &HashMap<SerializableTendril, Option<SerializableTendril>>,
  element_refs: &HashMap<SerializableTendril, Vec<BundleReference>>,
  reference_scopes: &[Ref<'arena>],
  mut import_map: serde_json::map::Map<String, serde_json::Value>,
  manifest: Option<String>,
) {
  let data_parcel_key = ExpandedName {
    ns: &ns!(),
    local: &"data-parcel-key".into(),
  };

  let mut import_map_node = None;
  // An HTML document has one scope. XML supplies its embedded content roots,
  // each of which needs its own copy of shared scripts and stylesheets.
  let scope_roots: HashSet<*const Node> = reference_scopes
    .iter()
    .map(|node| *node as *const Node)
    .collect();
  let mut inserted: HashMap<*const Node, HashSet<SerializableTendril>> = HashMap::new();
  // Head elements from included content, moved into <head> after the walk.
  let mut hoisted = Vec::new();
  // In a document without an HTML <head> (e.g. HTML embedded in a feed), included head elements
  // have nowhere to go, and are dropped rather than left in the content.
  let has_head = dom.find(expanded_name!(html "head")).is_some();

  dom.walk(&mut |node| {
    if let NodeData::Element { name, attrs, .. } = &node.data {
      // Resolve positional references before replacing attribute placeholders.
      if (name.ns == ns!(html) || name.ns == ns!(svg)) && !element_refs.is_empty() {
        let scope = if scope_roots.is_empty() {
          Some(dom as *const Node)
        } else {
          let mut ancestor = Some(node);
          let mut scope = None;
          while let Some(parent) = ancestor {
            let key = parent as *const Node;
            if scope_roots.contains(&key) {
              scope = Some(key);
              break;
            }
            ancestor = parent.parent.get();
          }
          scope
        };

        if let Some(scope) = scope {
          for attr in attrs.borrow().iter() {
            if let Some(refs) = element_refs.get(&SerializableTendril(attr.value.clone())) {
              for reference in refs {
                if inserted
                  .entry(scope)
                  .or_default()
                  .insert(reference.url().clone())
                {
                  let element = reference.create_element(arena, Some(node));
                  node.insert_before(element);
                }
              }
            }
          }
        }
      }

      match name.expanded() {
        expanded_name!(html "script") | expanded_name!(svg "script") => {
          if let Some(key) = node.get_attribute(data_parcel_key.clone()) {
            if let Some(bundle) = inline_bundles.get(&SerializableTendril(key)) {
              node.remove_attribute(data_parcel_key.clone());
              let contents = if name.ns == ns!(html) {
                escape_inline_script(&bundle.contents.0)
              } else {
                bundle.contents.0.clone()
              };
              node.set_text_content(arena, contents);
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
        n if is_parcel_tag(&n, "include") => {
          if let Some(src) = node.get_attribute(expanded_name!("", "src")) {
            if let Some(bundle) = inline_bundles.get(&SerializableTendril(src)) {
              let fragment = html5ever::driver::parse_fragment(
                Sink::new(&arena),
                html5ever::ParseOpts::default(),
                xml5ever::QualName::new(None, ns!(html), local_name!("div")),
                Vec::new(),
              )
              .one(&*bundle.contents.0);
              // html5ever places fragment children under a synthetic HTML root.
              let root = fragment.first_child.get().unwrap();
              if can_hoist_from(node, dom) {
                collect_hoistable(root, &mut hoisted);
              } else if !has_head {
                let mut metadata = Vec::new();
                collect_hoistable(root, &mut metadata);
                for node in metadata {
                  node.detach();
                }
              }
              while let Some(child) = root.first_child.get() {
                node.insert_before(child);
              }
              node.detach();
            }
          }
        }
        _ => {}
      }

      for attr in attrs.borrow_mut().iter_mut() {
        if name.ns == ns!(html)
          && (attr.name.expanded() == expanded_name!("", "srcset")
            || attr.name.local.as_ref() == "imagesrcset")
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

      // <meta http-equiv="refresh" content="N; url=URL">: the URL was replaced above, so
      // restore the delay that was split off during transformation.
      if name.expanded() == expanded_name!(html "meta") {
        if let Some(delay) = node.get_attribute(ExpandedName {
          ns: &ns!(),
          local: &"data-parcel-refresh".into(),
        }) {
          node.remove_attribute(ExpandedName {
            ns: &ns!(),
            local: &"data-parcel-refresh".into(),
          });
          if let Some(url) = node.get_attribute(expanded_name!("", "content")) {
            node.set_attribute(
              expanded_name!("", "content"),
              &format!("{}; url={}", delay, url),
            );
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
    insert_into_head(head, hoisted);

    // A layout's head already references the bundles its own page loads, which may be shared with
    // this page's.
    let existing: HashSet<String> = children(head).into_iter().filter_map(head_key).collect();
    for bundle in bundles.into_iter().rev() {
      let element = bundle.create_element(arena, None);
      if head_key(element).is_none_or(|key| !existing.contains(&key)) {
        head.prepend(element);
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

    if let Some(manifest) = manifest {
      // A data block, read by the JS runtime (see `runtime.js`), so it runs under strict Content
      // Security Policies.
      let node = arena.alloc(Node::create_element(expanded_name!(html "script")));
      node.set_attribute(expanded_name!("", "type"), "application/json");
      node.set_attribute(
        ExpandedName {
          ns: &ns!(),
          local: &"data-parcel-manifest".into(),
        },
        "",
      );
      node.set_text_content(arena, manifest.into());
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

#[cfg(test)]
mod tests {
  use super::*;
  use crate::{PackageOptions, arena::Sink, package_html, package_svg, serialize_xml};
  use html5ever::tendril::TendrilSink;

  fn references() -> Vec<BundleReference> {
    vec![
      BundleReference::StyleSheet {
        href: SerializableTendril("theme.css".into()),
        media: Some(SerializableTendril("print".into())),
      },
      BundleReference::Script {
        src: SerializableTendril("shared.js".into()),
        module: true,
      },
    ]
  }

  #[test]
  fn inline_scripts_escape_closing_tags_and_comments() {
    let code: StrTendril = r#"a='</script>';b='</SCRIPT >';c='<!-- x';d=1<2;e='<scripts>'"#.into();
    assert_eq!(
      &*escape_inline_script(&code),
      r#"a='</\script>';b='</\SCRIPT >';c='<\!-- x';d=1<2;e='<scripts>'"#
    );
  }

  #[test]
  fn positional_scripts_and_stylesheets_keep_order_and_deduplicate_per_page() {
    let result = package_html(PackageOptions {
      code: br#"<html><head><script src="one.js"></script><script src="two.js"></script></head><body></body></html>"#.to_vec(),
      xml: false,
      bundles: Vec::new(),
      inline_bundles: Default::default(),
      stylesheet_media: Default::default(),
      element_refs: [
        (SerializableTendril("one.js".into()), references()),
        (SerializableTendril("two.js".into()), references()),
      ].into(),
      import_map: Default::default(),
      manifest: None,
    }).unwrap();
    assert_eq!(
      String::from_utf8(result.code).unwrap(),
      r#"<html><head><link rel="stylesheet" href="theme.css" media="print"><script type="module" src="shared.js"></script><script src="one.js"></script><script src="two.js"></script></head><body></body></html>"#
    );
  }

  #[test]
  fn positional_svg_styles_preserve_order_media_and_local_namespace_bindings() {
    let result = package_svg(PackageOptions {
      code: br#"<svg xmlns="http://www.w3.org/2000/svg"><style>.shape{fill:red}</style><s:script xmlns:s="http://www.w3.org/2000/svg" href="one.js"/><script href="two.js"/><style>.shape{fill:blue}</style></svg>"#.to_vec(),
      xml: true,
      bundles: Vec::new(),
      inline_bundles: Default::default(),
      stylesheet_media: Default::default(),
      element_refs: [
        (SerializableTendril("one.js".into()), references()),
        (SerializableTendril("two.js".into()), references()),
      ].into(),
      import_map: Default::default(),
      manifest: None,
    }).unwrap();
    assert_eq!(
      String::from_utf8(result.code).unwrap(),
      r#"<svg xmlns="http://www.w3.org/2000/svg"><style>.shape{fill:red}</style><s:style xmlns:s="http://www.w3.org/2000/svg">@import url(theme.css) print;</s:style><s:script xmlns:s="http://www.w3.org/2000/svg" type="module" href="shared.js"/><s:script xmlns:s="http://www.w3.org/2000/svg" href="one.js"/><script href="two.js"/><style>.shape{fill:blue}</style></svg>"#
    );
  }

  #[test]
  fn positional_styles_in_inline_svg_escape_css_urls() {
    let result = package_html(PackageOptions {
      code: br#"<svg><style>.shape{fill:red}</style><script href="one.js"></script><script href="two.js"></script><style>.shape{fill:blue}</style></svg>"#.to_vec(),
      xml: false,
      bundles: Vec::new(),
      inline_bundles: Default::default(),
      stylesheet_media: Default::default(),
      element_refs: ["one.js", "two.js"].into_iter().map(|key| (
        SerializableTendril(key.into()),
        vec![BundleReference::StyleSheet {
          href: SerializableTendril("theme (dark).css".into()),
          media: None,
        }],
      )).collect(),
      import_map: Default::default(),
      manifest: None,
    }).unwrap();
    assert_eq!(
      String::from_utf8(result.code).unwrap(),
      r#"<html><head></head><body><svg><style>.shape{fill:red}</style><style>@import url(theme\20 \(dark\).css);</style><script href="one.js"></script><script href="two.js"></script><style>.shape{fill:blue}</style></svg></body></html>"#
    );
  }

  #[test]
  fn fragment_scopes_deduplicate_locally_and_preserve_xhtml_bindings() {
    let arena = Arena::new();
    let dom = xml5ever::driver::parse_document(Sink::new(&arena), Default::default()).one(
      r#"<feed xmlns="http://www.w3.org/2005/Atom"><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><s:script xmlns:s="http://www.w3.org/1999/xhtml" src="one.js"/><script src="two.js"/></div></content><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><script src="three.js"/></div></content><script xmlns="http://www.w3.org/1999/xhtml" src="one.js"/></feed>"#,
    );
    let mut scopes = Vec::new();
    dom.walk(&mut |node| {
      if let NodeData::Element { name, .. } = &node.data {
        if name.ns.as_ref() == crate::xml::ATOM_NS && name.local.as_ref() == "content" {
          scopes.push(node);
        }
      }
    });
    let element_refs = ["one.js", "two.js", "three.js"]
      .into_iter()
      .map(|key| (SerializableTendril(key.into()), references()))
      .collect();
    insert_bundle_references(
      &arena,
      dom,
      Vec::new(),
      Default::default(),
      &Default::default(),
      &element_refs,
      &scopes,
      Default::default(),
      None,
    );
    let mut code = Vec::new();
    serialize_xml::serialize(&mut code, dom).unwrap();
    let code = String::from_utf8(code).unwrap();
    assert_eq!(code.matches("href=\"theme.css\"").count(), 2);
    assert_eq!(code.matches("src=\"shared.js\"").count(), 2);
    assert!(code.contains(r#"<s:link xmlns:s="http://www.w3.org/1999/xhtml" rel="stylesheet" href="theme.css" media="print"/><s:script xmlns:s="http://www.w3.org/1999/xhtml" type="module" src="shared.js"/>"#));
  }
}
