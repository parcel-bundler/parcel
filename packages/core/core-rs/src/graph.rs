use crate::atomics::{AtomicBitSet, AtomicVec};
use rayon::prelude::{ParallelBridge, ParallelIterator};

#[derive(Default)]
pub struct Graph<T> {
  nodes: AtomicVec<Node<T>>,
  edges: AtomicVec<Edge>,
}

pub struct Node<T> {
  pub data: T,
  first_in: usize,
  first_out: usize,
  last_in: usize,
  last_out: usize,
}

pub struct Edge {
  pub data: usize,
  from: usize,
  to: usize,
  next_in: usize,
  next_out: usize,
  prev_in: usize,
  prev_out: usize,
}

impl<T> Graph<T> {
  pub fn new() -> Self {
    Self {
      nodes: AtomicVec::new(),
      edges: AtomicVec::new(),
    }
  }

  pub fn add_node(&self, data: T) -> usize {
    self.nodes.push(Node {
      data,
      first_in: usize::MAX,
      first_out: usize::MAX,
      last_in: usize::MAX,
      last_out: usize::MAX,
    })
  }

  pub fn add_edge(&self, data: usize, from: usize, to: usize) -> usize {
    let edge = Edge {
      data,
      from,
      to,
      next_in: usize::MAX,
      next_out: usize::MAX,
      // prev_in: self.nodes.get(to).unwrap().last_in,
      prev_in: usize::MAX,
      // prev_out: self.nodes.get(from).unwrap().last_out,
      prev_out: usize::MAX,
    };

    let idx = self.edges.push(edge);

    // TODO: updating `to` node is not safe because someone else could be accessing it.
    // let to = self.nodes.get_mut(to).unwrap();

    // if to.first_in == usize::MAX {
    //   to.first_in = idx;
    // } else {
    //   self.edges.get_mut(to.last_in).unwrap().next_in = idx;
    // }

    // to.last_in = idx;

    // This is only safe if we are sure no one else is accessing the node concurrently.
    // That is true when using the visit method below, but not necessarily otherwise.
    // We should probably change the API to account for this.
    let from = unsafe { self.nodes.get_mut(from) }.unwrap();

    if from.first_out == usize::MAX {
      from.first_out = idx;
    } else {
      unsafe { self.edges.get_mut(from.last_out) }
        .unwrap()
        .next_out = idx;
    };

    from.last_out = idx;
    idx
  }

  pub fn len(&self) -> usize {
    self.nodes.len()
  }

  pub fn children(&self, node_id: usize) -> ChildIter<T> {
    let node = self.nodes.get(node_id).unwrap();
    ChildIter {
      graph: self,
      edge: node.first_out,
    }
  }

  pub fn visit<V: Fn(usize, &T) + Send + Sync>(&self, start_node: usize, visitor: V) {
    fn process<T, V: Fn(usize, &T) + Send + Sync>(
      node_index: usize,
      visited: &AtomicBitSet,
      visitor: &V,
      graph: &Graph<T>,
    ) {
      if !visited.insert(node_index) {
        return;
      }

      let node = graph.nodes.get(node_index);
      let node = node.unwrap();
      visitor(node_index, &node.data);

      graph
        .children(node_index)
        .par_bridge()
        .for_each(|node_index| process(node_index, visited, visitor, graph));
    }

    let visited = AtomicBitSet::new();
    process(start_node, &visited, &visitor, &self);
  }
}

pub struct ChildIter<'a, T> {
  graph: &'a Graph<T>,
  edge: usize,
}

impl<'a, T> Iterator for ChildIter<'a, T> {
  type Item = usize;

  fn next(&mut self) -> Option<Self::Item> {
    if self.edge == usize::MAX {
      None
    } else {
      let edge = self.graph.edges.get(self.edge).unwrap();
      self.edge = edge.next_out;
      Some(edge.to)
    }
  }
}

#[cfg(test)]
mod tests {
  use super::Graph;

  #[test]
  fn test() {
    let g = Graph::default();
    let root = g.add_node(0);
    let c1 = g.add_node(1);
    let c2 = g.add_node(2);
    g.add_edge(0, root, c1);
    g.add_edge(0, root, c2);
    g.add_edge(0, c2, root);

    println!("{:?}", g.children(root).collect::<Vec<_>>())
  }
}
