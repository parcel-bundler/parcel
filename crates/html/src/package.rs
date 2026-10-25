use std::{
  cell::RefCell,
  collections::{HashMap, HashSet},
};

use crate::{
  SerializableTendril,
  arena::{Node, NodeData, Ref},
  dependencies::{is_func_iri_attr, parse_xml_stylesheet, serialize_xml_stylesheet},
  srcset::{parse_srcset, serialize_srcset},
};
use html5ever::{ExpandedName, expanded_name, local_name, namespace_url, ns, tendril::StrTendril};
use serde::Deserialize;
use typed_arena::Arena;

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

/// When a script runs relative to parsing the document.
#[derive(Clone, Copy, PartialEq)]
enum ScriptTiming {
  /// Runs when the parser reaches it.
  Sync,
  /// Runs after parsing, in document order with the other deferred and module scripts.
  Deferred,
}

/// When a `<script>` runs, or None when it's async and runs in no particular order.
fn script_timing<'arena>(node: Ref<'arena>, external: bool) -> Option<ScriptTiming> {
  if node.get_attribute(expanded_name!("", "async")).is_some() {
    return None;
  }
  let module = node
    .get_attribute(expanded_name!("", "type"))
    .is_some_and(|ty| ty.as_ref() == "module");
  // `defer` has no effect on inline classic scripts.
  if module || (external && node.get_attribute(expanded_name!("", "defer")).is_some()) {
    Some(ScriptTiming::Deferred)
  } else {
    Some(ScriptTiming::Sync)
  }
}

/// The tag a document-wide script needs at the start of the document.
enum ScriptTag<'arena> {
  /// None: the document's own tag runs before every element that needs it.
  InTime,
  /// The document's own tag, moved there, which keeps its attributes.
  Own(Ref<'arena>),
  /// A new tag.
  New,
}

pub fn insert_bundle_references<'arena>(
  arena: &'arena Arena<Node<'arena>>,
  dom: &'arena Node<'arena>,
  bundles: Vec<BundleReference>,
  inline_bundles: HashMap<SerializableTendril, InlineBundle>,
  stylesheet_media: &HashMap<SerializableTendril, Option<SerializableTendril>>,
  element_refs: &HashMap<SerializableTendril, Vec<BundleReference>>,
  element_scripts: &HashMap<SerializableTendril, Vec<SerializableTendril>>,
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

  // Document-wide scripts are inserted at the start of the document, so they run before the
  // elements that need them. A script the document already references doesn't need another tag
  // when its own tag runs first for every such element. Otherwise its tag is moved to the start.
  let mut needed_by: HashMap<&SerializableTendril, usize> = HashMap::new();
  for url in element_scripts.values().flatten() {
    *needed_by.entry(url).or_default() += 1;
  }
  // Scripts the document has referenced so far, when they run, and their first in-order tag and
  // its placeholder.
  let mut loaded: HashMap<SerializableTendril, (ScriptTiming, Ref<'arena>, SerializableTendril)> =
    HashMap::new();
  let mut loaded_in_time: HashMap<&SerializableTendril, usize> = HashMap::new();

  dom.walk(&mut |node| {
    if let NodeData::Element { name, attrs, .. } = &node.data {
      if !element_scripts.is_empty() {
        let script = matches!(
          name.expanded(),
          expanded_name!(html "script") | expanded_name!(svg "script")
        );
        let src = if !script {
          None
        } else if name.ns == ns!(svg) {
          node
            .get_attribute(expanded_name!(xlink "href"))
            .or_else(|| node.get_attribute(expanded_name!("", "href")))
        } else {
          node.get_attribute(expanded_name!("", "src"))
        };
        let timing = if script {
          script_timing(node, src.is_some())
        } else {
          None
        };

        for attr in attrs.borrow().iter() {
          if let Some(urls) = element_scripts.get(&SerializableTendril(attr.value.clone())) {
            for url in urls {
              let in_time = match (loaded.get(url), timing) {
                (Some((ScriptTiming::Sync, ..)), Some(_)) => true,
                (Some((ScriptTiming::Deferred, ..)), Some(ScriptTiming::Deferred)) => true,
                _ => false,
              };
              if in_time {
                *loaded_in_time.entry(url).or_default() += 1;
              }
            }
          }
        }

        // Scripts in a template don't run.
        let mut root = node;
        while let Some(parent) = root.parent.get() {
          root = parent;
        }
        if let (Some(src), Some(timing), true) = (src, timing, std::ptr::eq(root, dom)) {
          let src = SerializableTendril(src);
          if let Some(bundle) = inline_bundles.get(&src) {
            let entry = loaded
              .entry(bundle.contents.clone())
              .or_insert((timing, node, src));
            if timing == ScriptTiming::Sync {
              entry.0 = ScriptTiming::Sync;
            }
          }
        }
      }

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

  // Scripts that need a tag at the start of the document: those that some element needs before
  // the document's own tag runs, and those that a script moved there needs.
  let mut hoisted: HashSet<&SerializableTendril> = needed_by
    .iter()
    .filter(|(url, count)| loaded_in_time.get(*url) != Some(*count))
    .map(|(url, _)| *url)
    .collect();
  let mut stack: Vec<_> = hoisted.iter().copied().collect();
  while let Some(url) = stack.pop() {
    if let Some(needs) = loaded
      .get(url)
      .and_then(|(_, _, placeholder)| element_scripts.get(placeholder))
    {
      for need in needs {
        if hoisted.insert(need) {
          stack.push(need);
        }
      }
    }
  }
  let script_tag = |src: &SerializableTendril, module: bool, ns: &html5ever::Namespace| {
    match loaded.get(src) {
      Some(_) if !hoisted.contains(src) => ScriptTag::InTime,
      Some((_, node, _)) if matches!(&node.data, NodeData::Element { name, .. } if name.ns == *ns) =>
      {
        if !module {
          // It must run before scripts that run as the parser reaches them.
          node.remove_attribute(expanded_name!("", "defer"));
        }
        node.detach();
        ScriptTag::Own(node)
      }
      _ => ScriptTag::New,
    }
  };

  if let Some(head) = dom.find(expanded_name!(html "head")) {
    for bundle in bundles.into_iter().rev() {
      let tag = match &bundle {
        BundleReference::Script { src, module } => script_tag(src, *module, &ns!(html)),
        BundleReference::StyleSheet { .. } => ScriptTag::New,
      };
      match tag {
        ScriptTag::InTime => {}
        ScriptTag::Own(node) => head.prepend(node),
        ScriptTag::New => head.prepend(bundle.create_element(arena, None)),
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
        BundleReference::Script { src, module } => match script_tag(&src, module, &ns!(svg)) {
          ScriptTag::InTime => {}
          ScriptTag::Own(node) => svg.prepend(node),
          ScriptTag::New => {
            let node = arena.alloc(Node::create_element(expanded_name!(svg "script")));
            node.set_attribute(expanded_name!("", "href"), &src.0);
            svg.prepend(node);
          }
        },
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
      element_scripts: Default::default(),
      import_map: Default::default(),
      manifest: None,
    }).unwrap();
    assert_eq!(
      String::from_utf8(result.code).unwrap(),
      r#"<html><head><link rel="stylesheet" href="theme.css" media="print"><script type="module" src="shared.js"></script><script src="one.js"></script><script src="two.js"></script></head><body></body></html>"#
    );
  }

  fn package_shared_script(code: &str, module: bool) -> String {
    let inline_bundle = |contents: &str| InlineBundle {
      contents: SerializableTendril(contents.into()),
      module,
    };
    let result = package_html(PackageOptions {
      code: code.as_bytes().to_vec(),
      xml: false,
      bundles: vec![BundleReference::Script {
        src: SerializableTendril("/b.js".into()),
        module,
      }],
      inline_bundles: [
        (SerializableTendril("b".into()), inline_bundle("/b.js")),
        (SerializableTendril("inline".into()), inline_bundle("run()")),
      ]
      .into(),
      stylesheet_media: Default::default(),
      element_refs: Default::default(),
      element_scripts: [(
        SerializableTendril("inline".into()),
        vec![SerializableTendril("/b.js".into())],
      )]
      .into(),
      import_map: Default::default(),
      manifest: None,
    })
    .unwrap();
    String::from_utf8(result.code).unwrap()
  }

  #[test]
  fn shared_scripts_are_referenced_once_per_page() {
    let expected = r#"<html><head><script type="module" src="/b.js"></script><script type="module">run()</script></head><body></body></html>"#;
    // The page's own tag already runs first.
    assert_eq!(
      package_shared_script(
        r#"<html><head><script type="module" src="b"></script><script type="module" data-parcel-key="inline"></script></head><body></body></html>"#,
        true
      ),
      expected
    );
    // The page's own tag runs too late, so it moves.
    assert_eq!(
      package_shared_script(
        r#"<html><head><script type="module" data-parcel-key="inline"></script><script type="module" src="b"></script></head><body></body></html>"#,
        true
      ),
      expected
    );
    // An inline classic script runs before deferred scripts, even earlier ones.
    assert_eq!(
      package_shared_script(
        r#"<html><head><script src="b" defer></script><script data-parcel-key="inline"></script></head><body></body></html>"#,
        false
      ),
      r#"<html><head><script src="/b.js"></script><script>run()</script></head><body></body></html>"#
    );
    // Scripts in templates don't run.
    assert_eq!(
      package_shared_script(
        r#"<html><head><template><script type="module" src="b"></script></template><script type="module" data-parcel-key="inline"></script></head><body></body></html>"#,
        true
      ),
      r#"<html><head><script type="module" src="/b.js"></script><template><script type="module" src="/b.js"></script></template><script type="module">run()</script></head><body></body></html>"#
    );
  }

  #[test]
  fn shared_scripts_moved_earlier_keep_what_they_need_before_them() {
    let tendril = |value: &str| SerializableTendril(value.into());
    let script = |src: &str| BundleReference::Script {
      src: tendril(src),
      module: true,
    };
    let inline_bundle = |contents: &str| InlineBundle {
      contents: tendril(contents),
      module: true,
    };
    let result = package_html(PackageOptions {
      code: br#"<html><head><script type="module" src="y"></script><script type="module" data-parcel-key="inline"></script><script type="module" src="x"></script></head><body></body></html>"#.to_vec(),
      xml: false,
      bundles: vec![script("/y.js"), script("/x.js")],
      inline_bundles: [
        (tendril("x"), inline_bundle("/x.js")),
        (tendril("y"), inline_bundle("/y.js")),
        (tendril("inline"), inline_bundle("run()")),
      ]
      .into(),
      stylesheet_media: Default::default(),
      element_refs: Default::default(),
      // y runs before x where x is, but x has to move before the inline script.
      element_scripts: [
        (tendril("inline"), vec![tendril("/x.js")]),
        (tendril("x"), vec![tendril("/y.js")]),
      ]
      .into(),
      import_map: Default::default(),
      manifest: None,
    })
    .unwrap();
    assert_eq!(
      String::from_utf8(result.code).unwrap(),
      r#"<html><head><script type="module" src="/y.js"></script><script type="module" src="/x.js"></script><script type="module">run()</script></head><body></body></html>"#
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
      element_scripts: Default::default(),
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
      element_scripts: Default::default(),
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
      &Default::default(),
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
