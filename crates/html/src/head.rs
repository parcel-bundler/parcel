//! Hoisting of `<head>` elements produced by `<parcel:layout>`, `<parcel:include>`, and macros.
//!
//! Content produced by these features may contain metadata such as `<title>`, `<meta>`, and
//! `<link>`, which belongs in the document's `<head>` wherever it appears. User-authored HTML that
//! doesn't come from one of these features is never moved.

use crate::arena::{NodeData, Ref};
use html5ever::{ExpandedName, namespace_url, ns};

fn attr(node: Ref, name: &str) -> Option<html5ever::tendril::StrTendril> {
  node.get_attribute(ExpandedName {
    ns: &ns!(),
    local: &name.into(),
  })
}

/// Identifies `<head>` elements that a later copy replaces rather than adds to.
pub fn head_key(node: Ref) -> Option<String> {
  let NodeData::Element { name, .. } = &node.data else {
    return None;
  };
  if name.ns != ns!(html) {
    return None;
  }
  match name.local.as_ref() {
    "title" | "base" => Some(name.local.to_string()),
    "meta" => {
      if attr(node, "charset").is_some() {
        Some("meta charset".into())
      } else if let Some(name) = attr(node, "name") {
        Some(format!("meta name={}", name.to_ascii_lowercase()))
      } else if let Some(property) = attr(node, "property") {
        Some(format!("meta property={property}"))
      } else {
        attr(node, "http-equiv").map(|v| format!("meta http-equiv={}", v.to_ascii_lowercase()))
      }
    }
    "link" => {
      let rel = attr(node, "rel")?.to_ascii_lowercase();
      if rel == "canonical" {
        Some("link canonical".into())
      } else {
        attr(node, "href").map(|href| format!("link {rel} {href}"))
      }
    }
    "script" => attr(node, "src").map(|src| format!("script {src}")),
    _ => None,
  }
}

/// Whether an element belongs in `<head>`. `<meta>` and `<link>` with `itemprop` are microdata,
/// which is valid in the body. `<script>` and `<style>` are not hoisted, since their position matters.
fn is_hoistable(node: Ref) -> bool {
  let NodeData::Element { name, .. } = &node.data else {
    return false;
  };
  if name.ns != ns!(html) {
    return false;
  }
  match name.local.as_ref() {
    "title" | "base" => true,
    "meta" | "link" => attr(node, "itemprop").is_none(),
    _ => false,
  }
}

/// Collects the hoistable elements in `node`'s subtree, in document order. Foreign content (e.g.
/// `<svg>`, which has its own `<title>`), `<template>` contents, and `<noscript>` are skipped.
pub fn collect_hoistable<'arena>(node: Ref<'arena>, out: &mut Vec<Ref<'arena>>) {
  if is_hoistable(node) {
    out.push(node);
    return;
  }
  if let NodeData::Element { name, .. } = &node.data {
    if name.ns != ns!(html) || name.local.as_ref() == "noscript" {
      return;
    }
  }
  let mut child = node.first_child.get();
  while let Some(c) = child {
    child = c.next_sibling.get();
    collect_hoistable(c, out);
  }
}

/// Whether content inserted at `node` may be hoisted: it must be in `root`'s tree (not in
/// `<template>` contents, which are a separate fragment), and not within `<noscript>` or foreign
/// content.
pub fn can_hoist_from<'arena>(node: Ref<'arena>, root: Ref<'arena>) -> bool {
  let mut ancestor = node.parent.get();
  while let Some(a) = ancestor {
    if std::ptr::eq(a, root) {
      return true;
    }
    if let NodeData::Element { name, .. } = &a.data {
      if name.ns != ns!(html) || name.local.as_ref() == "noscript" {
        return false;
      }
    }
    ancestor = a.parent.get();
  }
  false
}

/// Appends `nodes` to `head`, each replacing an existing element with the same key.
pub fn insert_into_head<'arena>(head: Ref<'arena>, nodes: impl IntoIterator<Item = Ref<'arena>>) {
  for node in nodes {
    if let Some(key) = head_key(node) {
      let mut child = head.first_child.get();
      while let Some(c) = child {
        child = c.next_sibling.get();
        if !std::ptr::eq(c, node) && head_key(c).as_ref() == Some(&key) {
          c.detach();
        }
      }
    }
    head.append(node);
  }
}
