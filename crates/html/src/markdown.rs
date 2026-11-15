use crate::arena::{Node, NodeData, Ref, SerializableHandle, Sink};
use html5ever::{ExpandedName, expanded_name, local_name, namespace_url, ns, tendril::TendrilSink};
use parcel_core::{AssetType, BufferContent, Diagnostic, PathId, Transformer};
use std::{cell::RefCell, collections::HashSet, path::Path, sync::Arc};
use typed_arena::Arena;

#[derive(Default, serde::Deserialize)]
pub struct MarkdownOptions {
  #[serde(default)]
  pub layout: Option<String>,
  #[serde(default)]
  pub gfm: bool,
  /// Adds ids to headings, and renders a table of contents as `<ol parcel:slot="toc">`.
  #[serde(default)]
  pub toc: bool,
  /// Adds ids to headings, and wraps their contents in a link to themselves.
  #[serde(default)]
  pub anchors: bool,
  /// Adds a `<title>` with the text of the first `<h1>`, unless the page has one.
  #[serde(default)]
  pub title: bool,
  /// Adds a `<meta name="description">` with the text of the first paragraph, unless the page has
  /// one.
  #[serde(default)]
  pub description: bool,
}

#[derive(Default)]
pub struct MarkdownTransformer {
  pub layout: Option<PathId>,
  pub gfm: bool,
  pub toc: bool,
  pub anchors: bool,
  pub title: bool,
  pub description: bool,
}

impl MarkdownTransformer {
  pub fn new(
    config: Option<serde_json::Value>,
    path: PathId,
  ) -> Result<MarkdownTransformer, Diagnostic> {
    if let Some(config) = config {
      let options = serde_json::from_value::<MarkdownOptions>(config)?;
      Ok(MarkdownTransformer {
        layout: options
          .layout
          .map(|layout| path.resolve(Path::new(&layout))),
        gfm: options.gfm,
        toc: options.toc,
        anchors: options.anchors,
        title: options.title,
        description: options.description,
      })
    } else {
      Ok(MarkdownTransformer::default())
    }
  }
}

impl Transformer for MarkdownTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _ctx: &parcel_core::PluginContext,
  ) -> Result<parcel_core::Asset, parcel_core::DiagnosticList> {
    let content = asset.content.read_string()?;
    let mut options = if self.gfm {
      markdown::Options::gfm()
    } else {
      markdown::Options::default()
    };
    options.compile.allow_dangerous_html = true;
    options.compile.gfm_tagfilter = false;
    let mut result = markdown::to_html_with_options(&content, &options).unwrap();
    if let Some(layout) = &self.layout {
      let layout = layout.relative_url(&asset.loc.url.to_file_path()?);
      result = format!("<parcel:layout src={:?}>{}</parcel:layout>", layout, result);
    }
    let result = if self.toc || self.anchors || self.title || self.description {
      self.process_html(result.as_bytes())?
    } else {
      result.into_bytes()
    };
    asset.content = Arc::new(BufferContent::new(result));
    asset.ty = AssetType::Html;
    Ok(asset)
  }
}

const TOC_MIN_DEPTH: u8 = 2;
const TOC_MAX_DEPTH: u8 = 4;

struct Heading<'arena> {
  node: Ref<'arena>,
  depth: u8,
}

impl MarkdownTransformer {
  /// Post-processes the compiled HTML as a DOM.
  ///
  /// With `toc` or `anchors`, gives each h2-h6 heading without an id one derived from its text.
  /// The h1 is the page title, which doesn't need an anchor, and would otherwise take the id of a
  /// section with the same name.
  ///
  /// With `toc`, appends a table of contents of the h2-h4 headings to the body as
  /// `<ol parcel:slot="toc">`, so a layout can place it with `<parcel:slot name="toc">`.
  ///
  /// With `anchors`, wraps the contents of each h2-h6 heading in a link to itself. The heading's
  /// own text names the link, so screen readers announce the heading as usual, and no extra text
  /// (which would need translating) or ARIA is needed. Any `#` symbol is left to CSS.
  ///
  /// With `title` and `description`, adds a `<title>` and `<meta name="description">` to the
  /// `<head>` from the first `<h1>` and the first paragraph, unless the page already has them.
  fn process_html(&self, html: &[u8]) -> Result<Vec<u8>, Diagnostic> {
    let arena = Arena::new();
    let dom = html5ever::driver::parse_document(Sink::new(&arena), Default::default())
      .from_utf8()
      .one(html);
    let (Some(head), Some(body)) = (
      dom.find(expanded_name!(html "head")),
      dom.find(expanded_name!(html "body")),
    ) else {
      return Ok(html.to_vec());
    };

    let mut headings = Vec::new();
    let mut used = HashSet::new();
    collect_headings(body, &mut headings, &mut used);

    if self.title && !has_element(dom, &|n| is_element(n, expanded_name!(html "title"))) {
      let title = headings
        .iter()
        .find(|h| h.depth == 1)
        .map(|h| collapse_whitespace(&h.node.text_content()))
        .filter(|t| !t.is_empty());
      if let Some(title) = title {
        let element = element(&arena, "title");
        element.append(text(&arena, &title));
        head.append(element);
      }
    }

    if self.description && !has_element(dom, &is_meta_description) {
      let description = dom
        .find(expanded_name!(html "p"))
        .map(|p| collapse_whitespace(&p.text_content()))
        .filter(|d| !d.is_empty());
      if let Some(description) = description {
        let element = element(&arena, "meta");
        element.set_attribute(expanded_name!("", "name"), "description");
        element.set_attribute(expanded_name!("", "content"), &description);
        head.append(element);
      }
    }

    if self.toc || self.anchors {
      add_heading_ids(&headings, &mut used);
    }

    if self.anchors {
      for heading in &headings {
        if heading.depth > 1 {
          add_anchor(&arena, heading.node);
        }
      }
    }

    if self.toc {
      if let Some(toc) = render_toc(&arena, &headings) {
        body.prepend(toc);
      }
    }

    let mut vec = Vec::new();
    let handle: SerializableHandle = dom.into();
    html5ever::serialize::serialize(&mut vec, &handle, Default::default())?;
    Ok(vec)
  }
}

fn add_heading_ids(headings: &[Heading], used: &mut HashSet<String>) {
  for heading in headings {
    if heading.depth == 1
      || heading
        .node
        .get_attribute(expanded_name!("", "id"))
        .is_some()
    {
      continue;
    }
    let slug = slugify(&heading.node.text_content());
    if slug.is_empty() {
      continue;
    }
    let mut id = slug.clone();
    let mut i = 1;
    while used.contains(&id) {
      id = format!("{}-{}", slug, i);
      i += 1;
    }
    heading.node.set_attribute(expanded_name!("", "id"), &id);
    used.insert(id);
  }
}

/// Collects the HTML headings in document order, and the ids already in use. Foreign content and
/// `<template>` contents are skipped.
fn collect_headings<'arena>(
  node: Ref<'arena>,
  headings: &mut Vec<Heading<'arena>>,
  used: &mut HashSet<String>,
) {
  let mut child = node.first_child.get();
  while let Some(c) = child {
    child = c.next_sibling.get();
    let NodeData::Element { name, .. } = &c.data else {
      continue;
    };
    if name.ns != ns!(html) {
      continue;
    }
    if let Some(id) = c.get_attribute(expanded_name!("", "id")) {
      used.insert(id.to_string());
    }
    let depth = match name.local {
      local_name!("h1") => 1,
      local_name!("h2") => 2,
      local_name!("h3") => 3,
      local_name!("h4") => 4,
      local_name!("h5") => 5,
      local_name!("h6") => 6,
      _ => 0,
    };
    if depth > 0 {
      headings.push(Heading { node: c, depth });
    }
    collect_headings(c, headings, used);
  }
}

/// Wraps the heading's contents in `<a href="#id">`, unless it already contains a link (links
/// can't be nested).
fn add_anchor<'arena>(arena: &'arena Arena<Node<'arena>>, heading: Ref<'arena>) {
  let Some(id) = heading.get_attribute(expanded_name!("", "id")) else {
    return;
  };
  if heading.first_child.get().is_none() {
    return;
  }
  let mut has_link = false;
  heading.walk(&mut |n| {
    if let NodeData::Element { name, .. } = &n.data {
      has_link |= name.expanded() == expanded_name!(html "a");
    }
  });
  if has_link {
    return;
  }

  let link = element(arena, "a");
  link.set_attribute(expanded_name!("", "href"), &format!("#{}", id));
  while let Some(child) = heading.first_child.get() {
    child.detach();
    link.append(child);
  }
  heading.append(link);
}

fn is_element(node: Ref, expected: ExpandedName) -> bool {
  matches!(&node.data, NodeData::Element { name, .. } if name.expanded() == expected)
}

fn is_meta_description(node: Ref) -> bool {
  is_element(node, expanded_name!(html "meta"))
    && node
      .get_attribute(expanded_name!("", "name"))
      .is_some_and(|name| name.eq_ignore_ascii_case("description"))
}

/// Whether the document has an element matching `predicate`, e.g. a `<title>` the author wrote.
fn has_element<'arena>(dom: Ref<'arena>, predicate: &dyn Fn(Ref<'arena>) -> bool) -> bool {
  let mut found = false;
  dom.walk(&mut |n| found |= predicate(n));
  found
}

fn text<'arena>(arena: &'arena Arena<Node<'arena>>, text: &str) -> Ref<'arena> {
  arena.alloc(Node::new(
    NodeData::Text {
      contents: RefCell::new(text.into()),
    },
    0,
  ))
}

fn collapse_whitespace(text: &str) -> String {
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn slugify(text: &str) -> String {
  let mut slug = String::new();
  let mut in_space = false;
  for c in text.trim().to_lowercase().chars() {
    if c.is_whitespace() {
      if !in_space {
        slug.push('-');
      }
      in_space = true;
      continue;
    }
    in_space = false;
    // encodeURIComponent
    if c.is_ascii_alphanumeric() || "-_.!~*'()".contains(c) {
      slug.push(c);
    } else {
      let mut buf = [0; 4];
      for b in c.encode_utf8(&mut buf).bytes() {
        slug.push_str(&format!("%{:02X}", b));
      }
    }
  }
  slug
}

fn element<'arena>(arena: &'arena Arena<Node<'arena>>, local: &str) -> Ref<'arena> {
  arena.alloc(Node::create_element(ExpandedName {
    ns: &ns!(html),
    local: &local.into(),
  }))
}

/// Renders the h2-h4 headings that have ids as a nested list.
fn render_toc<'arena>(
  arena: &'arena Arena<Node<'arena>>,
  headings: &[Heading<'arena>],
) -> Option<Ref<'arena>> {
  // Open lists, with the depth of their items and the last item.
  let mut stack: Vec<(u8, Ref<'arena>, Option<Ref<'arena>>)> = Vec::new();
  let mut root = None;
  for heading in headings {
    if heading.depth < TOC_MIN_DEPTH || heading.depth > TOC_MAX_DEPTH {
      continue;
    }
    let Some(id) = heading.node.get_attribute(expanded_name!("", "id")) else {
      continue;
    };

    while stack.len() > 1 && stack.last().is_some_and(|(d, ..)| *d > heading.depth) {
      stack.pop();
    }
    match stack.last() {
      Some((depth, _, Some(item))) if *depth < heading.depth => {
        // Deeper than the previous heading: nest inside its list item.
        let list = element(arena, "ol");
        item.append(list);
        stack.push((heading.depth, list, None));
      }
      Some(_) => {}
      None => {
        let list = element(arena, "ol");
        list.set_attribute(
          ExpandedName {
            ns: &ns!(),
            local: &"parcel:slot".into(),
          },
          "toc",
        );
        root = Some(list);
        stack.push((heading.depth, list, None));
      }
    }

    let item = element(arena, "li");
    let link = element(arena, "a");
    link.set_attribute(expanded_name!("", "href"), &format!("#{}", id));
    link.append(arena.alloc(Node::new(
      NodeData::Text {
        contents: RefCell::new(heading.node.text_content().into()),
      },
      0,
    )));
    item.append(link);
    let (_, list, last) = stack.last_mut().unwrap();
    list.append(item);
    *last = Some(item);
  }
  root
}
