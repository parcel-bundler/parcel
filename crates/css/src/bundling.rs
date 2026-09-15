//! CSS application order and the intervals that must be packaged together.
//!
//! The bundler supplies its synchronous edges and per-context availability.
//! CSS semantics stay here; the partitioner only consumes asset positions.

use std::ops::Range;

use lightningcss::rules::CssRule;
use parcel_core::{AssetGraph, AssetIndex, AssetType};

use crate::CssContent;

/// Ordered content for one loading context. Each half-open interval in
/// `keep_together` must remain in one file for this context. Constraints may
/// overlap; they do not prevent another context from sharing the same assets.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OrderedContent {
  pub assets: Vec<AssetIndex>,
  pub keep_together: Vec<Range<usize>>,
}

#[derive(Default)]
struct Node {
  dependencies: Vec<AssetIndex>,
  is_css: bool,
  has_css: bool,
  declares_layers: bool,
  pre_import_layers: bool,
  layer_count: usize,
}

/// Analysis shared by all loading contexts in a build. AST summaries and
/// dependency closures are private to CSS and recomputed from the live graph.
pub struct OrderAnalysis {
  nodes: Vec<Node>,
}

impl OrderAnalysis {
  /// `dependencies` must preserve source/execution order and use the same
  /// edge selection as the bundler's reachability analysis (including its
  /// handling of lazy, isolated, and inline boundaries).
  pub fn new(
    graph: &AssetGraph,
    mut dependencies: impl FnMut(AssetIndex) -> Vec<AssetIndex>,
  ) -> Self {
    let mut nodes: Vec<Node> = (0..graph.assets.len()).map(|_| Node::default()).collect();
    let mut order = Vec::new();
    for (index, asset, _) in graph.dfs() {
      let is_css = asset.ty == AssetType::Css;
      let (pre_import_layers, declares_layers) = asset
        .content
        .downcast_ref::<CssContent>()
        .map(|content| summarize(&content.stylesheet.rules.0))
        .unwrap_or_default();
      nodes[index.index()] = Node {
        dependencies: dependencies(index),
        is_css,
        has_css: is_css,
        declares_layers,
        pre_import_layers,
        layer_count: asset
          .target
          .style_condition
          .as_ref()
          .map_or(0, |condition| condition.layers.len()),
      };
      order.push(index);
    }

    // Reachability includes cycles. Propagate both summaries to a fixed point;
    // reverse DFS order resolves acyclic closures in few passes.
    loop {
      let mut changed = false;
      for &index in order.iter().rev() {
        let node = &nodes[index.index()];
        let has_css = node.has_css || node.dependencies.iter().any(|a| nodes[a.index()].has_css);
        let declares_layers = node.declares_layers
          || node.dependencies.iter().any(|a| {
            let child = &nodes[a.index()];
            child.is_css && (child.declares_layers || child.layer_count > node.layer_count)
          });
        let node = &mut nodes[index.index()];
        changed |= node.has_css != has_css || node.declares_layers != declares_layers;
        node.has_css = has_css;
        node.declares_layers = declares_layers;
      }
      if !changed {
        break;
      }
    }
    Self { nodes }
  }

  /// Determine CSS order for one root. Traverse available assets too, but
  /// include only assets for which `required` is true in this context's output.
  pub fn for_context(
    &self,
    root: AssetIndex,
    required: impl Fn(AssetIndex) -> bool,
  ) -> OrderedContent {
    if !self.nodes[root.index()].has_css {
      return OrderedContent::default();
    }
    // JS modules execute at their first import. Stop at each CSS entry, whose
    // @import closure has its own last-occurrence content order below.
    let mut seen = vec![false; self.nodes.len()];
    let mut entries = Vec::new();
    self.collect_entries(root, &mut seen, &mut entries);
    seen.fill(false);
    let mut walk = Walk {
      analysis: self,
      required,
      seen,
      position: vec![usize::MAX; self.nodes.len()],
      assets: Vec::new(),
      ranges: Vec::new(),
    };
    for entry in entries.into_iter().rev() {
      walk.visit(entry);
    }
    // The reverse walk keeps the last occurrence of each asset. Convert its
    // intervals to positions in the forward application order as well.
    let len = walk.assets.len();
    walk.assets.reverse();
    OrderedContent {
      assets: walk.assets,
      keep_together: walk
        .ranges
        .into_iter()
        .filter(|range| range.len() > 1)
        .map(|range| len - range.end..len - range.start)
        .collect(),
    }
  }

  fn collect_entries(&self, asset: AssetIndex, seen: &mut [bool], entries: &mut Vec<AssetIndex>) {
    if std::mem::replace(&mut seen[asset.index()], true) {
      return;
    }
    let node = &self.nodes[asset.index()];
    if node.is_css {
      entries.push(asset);
      return;
    }
    for &child in &node.dependencies {
      if self.nodes[child.index()].has_css {
        self.collect_entries(child, seen, entries);
      }
    }
  }
}

struct Walk<'a, F> {
  analysis: &'a OrderAnalysis,
  required: F,
  seen: Vec<bool>,
  position: Vec<usize>,
  assets: Vec<AssetIndex>,
  ranges: Vec<Range<usize>>,
}

impl<F: Fn(AssetIndex) -> bool> Walk<'_, F> {
  fn visit(&mut self, asset: AssetIndex) {
    if std::mem::replace(&mut self.seen[asset.index()], true) {
      return;
    }
    let analysis = self.analysis;
    let node = &analysis.nodes[asset.index()];
    let start = self.assets.len();
    let pushed = (self.required)(asset);
    if pushed {
      self.position[asset.index()] = start;
      self.assets.push(asset);
    }
    for &target in node.dependencies.iter().rev() {
      let child = &analysis.nodes[target.index()];
      if !child.is_css {
        continue;
      }
      if self.seen[target.index()] {
        // An earlier repeated import still declares layers. If intervening
        // content declares layers, keep the span through this importer in
        // one file so the packager can preserve that first declaration.
        if child.declares_layers || child.layer_count > node.layer_count {
          let kept = self.position[target.index()];
          if kept != usize::MAX
            && self.assets[kept + 1..].iter().any(|a| {
              let node = &analysis.nodes[a.index()];
              node.declares_layers || node.layer_count > 0
            })
          {
            self
              .ranges
              .push(kept.min(self.position[asset.index()])..self.assets.len());
          }
        }
        continue;
      }
      self.visit(target);
    }
    // A pre-import statement governs this sheet's whole retained subtree.
    if pushed && node.pre_import_layers {
      self.ranges.push(start..self.assets.len());
    }
  }
}

fn summarize(rules: &[CssRule]) -> (bool, bool) {
  let mut statement_seen = false;
  let mut pre_import_layers = false;
  for rule in rules {
    match rule {
      CssRule::Import(_) if statement_seen => {
        pre_import_layers = true;
        break;
      }
      CssRule::Import(_) | CssRule::Ignored => {}
      CssRule::LayerStatement(_) => statement_seen = true,
      _ => break,
    }
  }
  (pre_import_layers, declares_layers(rules))
}

fn declares_layers(rules: &[CssRule]) -> bool {
  rules.iter().any(|rule| match rule {
    CssRule::LayerStatement(_) | CssRule::LayerBlock(_) => true,
    CssRule::Media(media) => declares_layers(&media.rules.0),
    CssRule::Supports(supports) => declares_layers(&supports.rules.0),
    _ => false,
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use lightningcss::stylesheet::{ParserOptions, StyleSheet};

  fn css(dependencies: &[u32]) -> Node {
    Node {
      dependencies: dependencies.iter().copied().map(AssetIndex).collect(),
      is_css: true,
      has_css: true,
      ..Node::default()
    }
  }

  #[test]
  fn summaries_come_from_the_ast() {
    for (source, expected) in [
      ("@layer base; @import 'a.css';", (true, true)),
      ("@import 'a.css' layer(base);", (false, false)),
      ("@import 'a.css'; @layer base;", (false, true)),
      (
        "@media print { @supports (display: grid) { @layer base {} } }",
        (false, true),
      ),
    ] {
      let sheet = StyleSheet::parse(source, ParserOptions::default()).unwrap();
      assert_eq!(summarize(&sheet.rules.0), expected, "{source}");
    }
  }

  #[test]
  fn repeated_layer_span_is_local_to_its_context() {
    let mut nodes = vec![css(&[1, 2, 1]), css(&[]), css(&[]), css(&[1])];
    nodes[1].layer_count = 1;
    nodes[2].layer_count = 1;
    let analysis = OrderAnalysis { nodes };
    assert_eq!(
      analysis.for_context(AssetIndex(0), |_| true),
      OrderedContent {
        assets: vec![AssetIndex(2), AssetIndex(1), AssetIndex(0)],
        keep_together: vec![0..3],
      }
    );
    assert_eq!(
      analysis.for_context(AssetIndex(3), |_| true),
      OrderedContent {
        assets: vec![AssetIndex(1), AssetIndex(3)],
        keep_together: vec![],
      }
    );
  }

  #[test]
  fn prelude_interval_uses_forward_positions() {
    let mut nodes = vec![css(&[1, 2]), css(&[3]), css(&[]), css(&[])];
    nodes[1].pre_import_layers = true;
    let analysis = OrderAnalysis { nodes };
    assert_eq!(
      analysis.for_context(AssetIndex(0), |_| true),
      OrderedContent {
        assets: vec![AssetIndex(3), AssetIndex(1), AssetIndex(2), AssetIndex(0)],
        keep_together: vec![0..2],
      }
    );
  }

  #[test]
  fn entry_order_and_availability_remain_separate() {
    let mut nodes = vec![css(&[1, 2, 1]), css(&[3]), css(&[3]), css(&[])];
    nodes[0].is_css = false;
    let analysis = OrderAnalysis { nodes };
    assert_eq!(
      analysis.for_context(AssetIndex(0), |_| true).assets,
      vec![AssetIndex(1), AssetIndex(3), AssetIndex(2)],
    );
    assert_eq!(
      analysis
        .for_context(AssetIndex(0), |a| a != AssetIndex(3))
        .assets,
      vec![AssetIndex(1), AssetIndex(2)],
    );
    // Filtering an importer does not prune its required dependencies.
    assert_eq!(
      analysis
        .for_context(AssetIndex(0), |a| a == AssetIndex(3))
        .assets,
      vec![AssetIndex(3)],
    );
  }

  #[test]
  fn cycles_terminate_without_repeating_assets() {
    let analysis = OrderAnalysis {
      nodes: vec![css(&[1]), css(&[0])],
    };
    assert_eq!(
      analysis.for_context(AssetIndex(0), |_| true).assets,
      vec![AssetIndex(1), AssetIndex(0)],
    );
  }
}
