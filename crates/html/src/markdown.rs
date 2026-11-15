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
  /// Adds ids to headings, and renders a table of contents as `<ol slot="toc">`.
  #[serde(default)]
  pub toc: bool,
  /// Adds ids to headings, and wraps their contents in a link to themselves.
  #[serde(default)]
  pub anchors: bool,
}

#[derive(Default)]
pub struct MarkdownTransformer {
  pub layout: Option<PathId>,
  pub gfm: bool,
  pub toc: bool,
  pub anchors: bool,
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
    let result = if self.toc || self.anchors {
      process_headings(result.as_bytes(), self.toc, self.anchors)?
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

/// Gives each h2-h6 heading without an id one derived from its text. The h1 is the page title,
/// which doesn't need an anchor, and would otherwise take the id of a section with the same name.
///
/// With `toc`, appends a table of contents of the h2-h4 headings to the body as `<ol slot="toc">`,
/// so a layout can place it with `<parcel:slot name="toc">`.
///
/// With `anchors`, wraps the contents of each h2-h6 heading in a link to itself. The heading's own
/// text names the link, so screen readers announce the heading as usual, and no extra text (which
/// would need translating) or ARIA is needed. Any `#` symbol is left to CSS.
fn process_headings(html: &[u8], toc: bool, anchors: bool) -> Result<Vec<u8>, Diagnostic> {
  let arena = Arena::new();
  let dom = html5ever::driver::parse_document(Sink::new(&arena), Default::default())
    .from_utf8()
    .one(html);
  let Some(body) = dom.find(expanded_name!(html "body")) else {
    return Ok(html.to_vec());
  };

  let mut headings = Vec::new();
  let mut used = HashSet::new();
  collect_headings(body, &mut headings, &mut used);

  for heading in &headings {
    if heading.depth == 1
      || heading
        .node
        .get_attribute(expanded_name!("", "id"))
        .is_some()
    {
      continue;
    }
    let slug = slugify(&text_content(heading.node));
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

  if anchors {
    for heading in &headings {
      if heading.depth > 1 {
        add_anchor(&arena, heading.node);
      }
    }
  }

  if toc {
    if let Some(toc) = render_toc(&arena, &headings) {
      body.prepend(toc);
    }
  }

  let mut vec = Vec::new();
  let handle: SerializableHandle = dom.into();
  html5ever::serialize::serialize(&mut vec, &handle, Default::default())?;
  Ok(vec)
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

fn text_content(node: Ref) -> String {
  let mut text = String::new();
  node.walk(&mut |n| {
    if let NodeData::Text { contents } = &n.data {
      text.push_str(&contents.borrow());
    }
  });
  text
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
        list.set_attribute(expanded_name!("", "slot"), "toc");
        root = Some(list);
        stack.push((heading.depth, list, None));
      }
    }

    let item = element(arena, "li");
    let link = element(arena, "a");
    link.set_attribute(expanded_name!("", "href"), &format!("#{}", id));
    link.append(arena.alloc(Node::new(
      NodeData::Text {
        contents: RefCell::new(text_content(heading.node).into()),
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
