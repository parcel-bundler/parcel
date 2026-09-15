//! CSS application order and the intervals that must be packaged together.
//!
//! The bundler supplies its synchronous edges and per-context availability.
//! CSS semantics stay here; the partitioner only consumes asset positions.

use std::ops::Range;

use bitflags::bitflags;
use fixedbitset::FixedBitSet;
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

bitflags! {
  #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
  pub(crate) struct OrderFlags: u8 {
    const IS_CSS = 1 << 0;
    const HAS_CSS = 1 << 1;
    const DECLARES_LAYERS = 1 << 2;
    const PRE_IMPORT_LAYERS = 1 << 3;
    const QUEUED = 1 << 4;
  }
}

#[derive(Default)]
struct Node {
  dependencies: Range<u32>,
  layer_count: u32,
  flags: OrderFlags,
}

/// Analysis shared by all loading contexts in a build. Local AST summaries
/// live on CssContent; only dependency closures are recomputed from the graph.
/// Edges use CSR storage, preserving duplicates and source order.
pub struct OrderAnalysis {
  nodes: Vec<Node>,
  edges: Box<[AssetIndex]>,
  scratch: Scratch,
}

impl OrderAnalysis {
  /// `dependencies` must preserve source/execution order and use the same
  /// edge selection as the bundler's reachability analysis (including its
  /// handling of lazy, isolated, and inline boundaries).
  pub fn new<I: IntoIterator<Item = AssetIndex>>(
    graph: &AssetGraph,
    mut dependencies: impl FnMut(AssetIndex) -> I,
  ) -> Self {
    let mut nodes: Vec<Node> = (0..graph.assets.len()).map(|_| Node::default()).collect();
    let mut edges = Vec::new();
    for (index, asset, _) in graph.dfs() {
      let mut flags = asset
        .content
        .downcast_ref::<CssContent>()
        .map_or(OrderFlags::empty(), |content| content.order_flags);
      if asset.ty == AssetType::Css {
        flags |= OrderFlags::IS_CSS | OrderFlags::HAS_CSS;
      }
      let start = edge_offset(edges.len());
      edges.extend(dependencies(index));
      nodes[index.index()] = Node {
        dependencies: start..edge_offset(edges.len()),
        flags,
        layer_count: asset
          .target
          .style_condition
          .as_ref()
          .map_or(0, |condition| {
            condition
              .layers
              .len()
              .try_into()
              .expect("too many CSS layers")
          }),
      };
    }

    Self::from_nodes(nodes, edges)
  }

  fn from_nodes(mut nodes: Vec<Node>, edges: Vec<AssetIndex>) -> Self {
    let edges = edges.into_boxed_slice();
    propagate(&mut nodes, &edges);
    Self {
      scratch: Scratch::default(),
      nodes,
      edges,
    }
  }

  /// Determine CSS order for one root. Traverse available assets too, but
  /// include only assets for which `required` is true in this context's output.
  pub fn for_context(
    &mut self,
    root: AssetIndex,
    required: impl Fn(AssetIndex) -> bool,
  ) -> OrderedContent {
    if !self.nodes[root.index()].flags.contains(OrderFlags::HAS_CSS) {
      return OrderedContent::default();
    }
    self.scratch.seen.grow(self.nodes.len());
    self.scratch.position.resize(self.nodes.len(), u32::MAX);
    let mut walk = Walk {
      nodes: &self.nodes,
      edges: &self.edges,
      scratch: &mut self.scratch,
      required,
      last_layer_position: None,
      output: OrderedContent::default(),
    };
    walk.collect_entries(root);
    walk.scratch.clear_seen();
    while let Some(entry) = walk.scratch.entries.pop() {
      walk.visit(entry);
    }
    walk.scratch.clear_seen();

    // The reverse walk keeps the last occurrence of each asset. Convert its
    // intervals in place to positions in the forward application order.
    let mut output = walk.output;
    let len = output.assets.len();
    output.assets.reverse();
    for range in &mut output.keep_together {
      *range = len - range.end..len - range.start;
    }
    output
  }
}

fn edge_offset(len: usize) -> u32 {
  len.try_into().expect("too many CSS ordering edges")
}

/// Propagate each monotone flag backwards in O(V + E), including cycles.
/// The reverse CSR exists only during this pass and is dropped before any
/// context traversal storage is allocated.
fn propagate(nodes: &mut [Node], edges: &[AssetIndex]) {
  if !nodes
    .iter()
    .any(|node| node.flags.contains(OrderFlags::HAS_CSS))
  {
    return;
  }
  let mut offsets = vec![0u32; nodes.len() + 1];
  for child in edges {
    offsets[child.index() + 1] += 1;
  }
  for i in 1..offsets.len() {
    offsets[i] += offsets[i - 1];
  }
  let mut parents = vec![AssetIndex(0); edges.len()];
  for index in 0..nodes.len() {
    let mut flags = nodes[index].flags;
    for edge in nodes[index].dependencies.clone() {
      let child = edges[edge as usize];
      parents[offsets[child.index()] as usize] = AssetIndex::from_index(index);
      offsets[child.index()] += 1;
      // An import's layer can declare a layer even if its stylesheet doesn't.
      let child = &nodes[child.index()];
      if child.flags.contains(OrderFlags::IS_CSS) && child.layer_count > nodes[index].layer_count {
        flags |= OrderFlags::DECLARES_LAYERS;
      }
    }
    nodes[index].flags = flags;
  }
  // Filling the CSR advanced starts to ends. Shift once to recover starts,
  // avoiding a separate per-node cursor array.
  offsets.copy_within(..nodes.len(), 1);
  offsets[0] = 0;

  let mut pending = Vec::new();
  for (index, node) in nodes.iter_mut().enumerate() {
    if node
      .flags
      .intersects(OrderFlags::HAS_CSS | OrderFlags::DECLARES_LAYERS)
    {
      pending.push(AssetIndex::from_index(index));
      node.flags.insert(OrderFlags::QUEUED);
    }
  }
  while let Some(index) = pending.pop() {
    nodes[index.index()].flags.remove(OrderFlags::QUEUED);
    let flags = nodes[index.index()].flags;
    let mut inherited = flags & OrderFlags::HAS_CSS;
    if flags.contains(OrderFlags::IS_CSS) {
      inherited |= flags & OrderFlags::DECLARES_LAYERS;
    }
    for &parent in &parents[offsets[index.index()] as usize..offsets[index.index() + 1] as usize] {
      let node = &mut nodes[parent.index()];
      if !node.flags.contains(inherited) {
        node.flags |= inherited;
        if !node.flags.contains(OrderFlags::QUEUED) {
          node.flags.insert(OrderFlags::QUEUED);
          pending.push(parent);
        }
      }
    }
  }
}

// Explicit DFS frames keep stack usage bounded even on deep import graphs.
struct Frame {
  asset: AssetIndex,
  next_edge: u32,
}

#[derive(Default)]
struct Scratch {
  seen: FixedBitSet,
  visited: Vec<AssetIndex>,
  position: Vec<u32>,
  stack: Vec<Frame>,
  entries: Vec<AssetIndex>,
}

impl Scratch {
  fn mark(&mut self, asset: AssetIndex) -> bool {
    if self.seen.put(asset.index()) {
      return false;
    }
    self.visited.push(asset);
    true
  }

  fn clear_seen(&mut self) {
    // Reset only the visited part of the graph, not every asset per context.
    for asset in self.visited.drain(..) {
      self.seen.set(asset.index(), false);
    }
  }
}

struct Walk<'a, F> {
  nodes: &'a [Node],
  edges: &'a [AssetIndex],
  scratch: &'a mut Scratch,
  required: F,
  last_layer_position: Option<u32>,
  output: OrderedContent,
}

impl<F: Fn(AssetIndex) -> bool> Walk<'_, F> {
  fn collect_entries(&mut self, root: AssetIndex) {
    // JS executes at the first import. Stop at each CSS entry, whose @import
    // closure has its own last-occurrence content order below.
    self.entry(root);
    while let Some(frame) = self.scratch.stack.last_mut() {
      if frame.next_edge == self.nodes[frame.asset.index()].dependencies.end {
        self.scratch.stack.pop();
        continue;
      }
      let child = self.edges[frame.next_edge as usize];
      frame.next_edge += 1;
      if self.nodes[child.index()]
        .flags
        .contains(OrderFlags::HAS_CSS)
      {
        self.entry(child);
      }
    }
  }

  fn entry(&mut self, asset: AssetIndex) {
    if !self.scratch.mark(asset) {
      return;
    }
    let node = &self.nodes[asset.index()];
    if node.flags.contains(OrderFlags::IS_CSS) {
      self.scratch.entries.push(asset);
    } else {
      self.scratch.stack.push(Frame {
        asset,
        next_edge: node.dependencies.start,
      });
    }
  }

  fn enter(&mut self, asset: AssetIndex) {
    self.scratch.mark(asset);
    let node = &self.nodes[asset.index()];
    // Always overwrite positions, including unavailable assets: another
    // context may have retained this asset using the same scratch storage.
    let mut position = u32::MAX;
    if (self.required)(asset) {
      position = self
        .output
        .assets
        .len()
        .try_into()
        .expect("too many CSS assets");
      self.output.assets.push(asset);
      if node.flags.contains(OrderFlags::DECLARES_LAYERS) || node.layer_count > 0 {
        self.last_layer_position = Some(position);
      }
    }
    self.scratch.position[asset.index()] = position;
    self.scratch.stack.push(Frame {
      asset,
      next_edge: node.dependencies.end,
    });
  }

  fn visit(&mut self, asset: AssetIndex) {
    if self.scratch.seen.contains(asset.index()) {
      return;
    }
    self.enter(asset);
    while let Some(frame) = self.scratch.stack.last_mut() {
      let node = &self.nodes[frame.asset.index()];
      if frame.next_edge == node.dependencies.start {
        let position = self.scratch.position[frame.asset.index()];
        // A pre-import statement governs this sheet's retained subtree.
        if position != u32::MAX && node.flags.contains(OrderFlags::PRE_IMPORT_LAYERS) {
          self.keep_together(position as usize);
        }
        self.scratch.stack.pop();
        continue;
      }
      frame.next_edge -= 1;
      let target = self.edges[frame.next_edge as usize];
      let child = &self.nodes[target.index()];
      if !child.flags.contains(OrderFlags::IS_CSS) {
        continue;
      }
      if self.scratch.seen.contains(target.index()) {
        // A repeated import still declares layers. The latest layer position
        // answers whether any intervening content declares layers in O(1).
        if child.flags.contains(OrderFlags::DECLARES_LAYERS) || child.layer_count > node.layer_count
        {
          let kept = self.scratch.position[target.index()];
          if self.last_layer_position.is_some_and(|last| last > kept) {
            let start = kept.min(self.scratch.position[frame.asset.index()]);
            self.keep_together(start as usize);
          }
        }
      } else {
        self.enter(target);
      }
    }
  }

  fn keep_together(&mut self, mut start: usize) {
    let end = self.output.assets.len();
    if end - start <= 1 {
      return;
    }
    // Ends increase with the reverse walk. Merge overlapping constraints
    // with a stack: each interval is pushed/popped at most once. This bounds
    // both interval storage and the partitioner's coverage scans by O(V).
    while let Some(last) = self.output.keep_together.last() {
      if last.end <= start {
        break;
      }
      start = start.min(last.start);
      self.output.keep_together.pop();
    }
    self.output.keep_together.push(start..end);
  }
}

/// Cache only local AST facts, after transformation has produced the final
/// stylesheet (including the CSS Modules reparse). Dependency facts must be
/// recomputed when the graph changes, even if this stylesheet is unchanged.
pub(crate) fn summarize(rules: &[CssRule]) -> OrderFlags {
  let mut statement_seen = false;
  let mut flags = OrderFlags::empty();
  for rule in rules {
    match rule {
      CssRule::Import(_) if statement_seen => {
        flags |= OrderFlags::PRE_IMPORT_LAYERS;
        break;
      }
      CssRule::Import(_) | CssRule::Ignored => {}
      CssRule::LayerStatement(_) => statement_seen = true,
      _ => break,
    }
  }
  flags.set(OrderFlags::DECLARES_LAYERS, declares_layers(rules));
  flags
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

  #[derive(Default)]
  struct TestNode {
    dependencies: Vec<AssetIndex>,
    is_css: bool,
    declares_layers: bool,
    pre_import_layers: bool,
    layer_count: u32,
  }

  fn css(dependencies: &[u32]) -> TestNode {
    TestNode {
      dependencies: dependencies.iter().copied().map(AssetIndex).collect(),
      is_css: true,
      ..TestNode::default()
    }
  }

  fn analysis(input: Vec<TestNode>) -> OrderAnalysis {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for node in input {
      let start = edge_offset(edges.len());
      edges.extend(node.dependencies);
      let mut flags = OrderFlags::empty();
      flags.set(OrderFlags::IS_CSS | OrderFlags::HAS_CSS, node.is_css);
      flags.set(OrderFlags::DECLARES_LAYERS, node.declares_layers);
      flags.set(OrderFlags::PRE_IMPORT_LAYERS, node.pre_import_layers);
      nodes.push(Node {
        dependencies: start..edge_offset(edges.len()),
        flags,
        layer_count: node.layer_count,
      });
    }
    OrderAnalysis::from_nodes(nodes, edges)
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
      let flags = summarize(&sheet.rules.0);
      assert_eq!(
        (
          flags.contains(OrderFlags::PRE_IMPORT_LAYERS),
          flags.contains(OrderFlags::DECLARES_LAYERS)
        ),
        expected,
        "{source}"
      );
    }
  }

  #[test]
  fn repeated_layer_span_is_local_to_its_context() {
    let mut nodes = vec![css(&[1, 2, 1]), css(&[]), css(&[]), css(&[1])];
    nodes[1].layer_count = 1;
    nodes[2].layer_count = 1;
    let mut analysis = analysis(nodes);
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
    let mut analysis = analysis(nodes);
    assert_eq!(
      analysis.for_context(AssetIndex(0), |_| true),
      OrderedContent {
        assets: vec![AssetIndex(3), AssetIndex(1), AssetIndex(2), AssetIndex(0)],
        keep_together: vec![0..2],
      }
    );
  }

  #[test]
  fn overlapping_intervals_merge_but_adjacent_intervals_stay_separate() {
    let mut nodes = vec![css(&[1, 2]), css(&[3]), css(&[4]), css(&[]), css(&[])];
    nodes[1].pre_import_layers = true;
    nodes[2].pre_import_layers = true;
    let mut analysis = analysis(nodes);
    assert_eq!(
      analysis.for_context(AssetIndex(0), |_| true),
      OrderedContent {
        assets: vec![
          AssetIndex(3),
          AssetIndex(1),
          AssetIndex(4),
          AssetIndex(2),
          AssetIndex(0)
        ],
        keep_together: vec![2..4, 0..2],
      }
    );
    analysis.nodes[0]
      .flags
      .insert(OrderFlags::PRE_IMPORT_LAYERS);
    assert_eq!(
      analysis.for_context(AssetIndex(0), |_| true).keep_together,
      vec![0..5]
    );
  }

  #[test]
  fn repeated_layers_can_split_across_plain_content() {
    let mut nodes = vec![css(&[1, 2, 1]), css(&[]), css(&[])];
    nodes[1].layer_count = 1;
    let mut analysis = analysis(nodes);
    assert_eq!(
      analysis.for_context(AssetIndex(0), |_| true),
      OrderedContent {
        assets: vec![AssetIndex(2), AssetIndex(1), AssetIndex(0)],
        keep_together: vec![],
      }
    );
  }

  #[test]
  fn entry_order_and_availability_remain_separate() {
    let mut nodes = vec![css(&[1, 2, 1]), css(&[3]), css(&[3]), css(&[])];
    nodes[0].is_css = false;
    let mut analysis = analysis(nodes);
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
    let mut analysis = analysis(vec![css(&[1]), css(&[0])]);
    assert_eq!(
      analysis.for_context(AssetIndex(0), |_| true).assets,
      vec![AssetIndex(1), AssetIndex(0)],
    );
  }

  #[test]
  fn scratch_positions_do_not_leak_between_contexts() {
    let mut nodes = vec![css(&[1, 2, 1]), css(&[]), css(&[])];
    nodes[1].layer_count = 1;
    nodes[2].layer_count = 1;
    let mut analysis = analysis(nodes);
    let full = analysis.for_context(AssetIndex(0), |_| true);
    // The repeated target was retained in the preceding context. Filtering it
    // out must also remove its repeated-import interval, not reuse its position.
    assert_eq!(
      analysis.for_context(AssetIndex(0), |a| a != AssetIndex(1)),
      OrderedContent {
        assets: vec![AssetIndex(2), AssetIndex(0)],
        keep_together: vec![],
      }
    );
    assert_eq!(analysis.for_context(AssetIndex(0), |_| true), full);
  }

  #[test]
  fn closures_cross_cycles_but_layers_stop_at_non_css_edges() {
    // JS cycle -> CSS cycle -> JS -> CSS with a layer declaration.
    let mut nodes = vec![
      css(&[1]),
      css(&[0, 2]),
      css(&[3]),
      css(&[2, 4]),
      css(&[5]),
      css(&[]),
    ];
    for i in [0, 1, 4] {
      nodes[i].is_css = false;
    }
    nodes[3].layer_count = 1;
    nodes[5].declares_layers = true;
    let analysis = analysis(nodes);
    assert!(
      analysis
        .nodes
        .iter()
        .all(|node| node.flags.contains(OrderFlags::HAS_CSS))
    );
    assert_eq!(
      analysis
        .nodes
        .iter()
        .map(|node| node.flags.contains(OrderFlags::DECLARES_LAYERS))
        .collect::<Vec<_>>(),
      vec![false, true, true, true, true, true]
    );
  }

  #[test]
  fn deep_graphs_use_explicit_traversal_stacks() {
    const LEN: u32 = 50_000;
    for css_chain in [false, true] {
      let mut nodes: Vec<_> = (0..LEN - 1).map(|i| css(&[i + 1])).collect();
      for node in &mut nodes {
        node.is_css = css_chain;
      }
      nodes.push(css(&[]));
      let mut analysis = analysis(nodes);
      let output = analysis.for_context(AssetIndex(0), |_| true);
      if css_chain {
        assert_eq!(
          output.assets,
          (0..LEN).rev().map(AssetIndex).collect::<Vec<_>>()
        );
      } else {
        assert_eq!(output.assets, vec![AssetIndex(LEN - 1)]);
      }
      assert!(output.keep_together.is_empty());
    }
  }
}
