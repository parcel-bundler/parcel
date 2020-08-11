use neon::prelude::*;
use petgraph::graph::NodeIndex;
use petgraph::Graph as PetGraph;

pub struct Graph {
  graph: PetGraph<String, i32>,
}

impl Graph {
  pub fn new() -> Graph {
    Graph {
      graph: PetGraph::new(),
    }
  }
}

declare_types! {
  pub class JsGraph for Graph {
    init(mut _cx) {
      Ok(Graph::new())
    }

    method addNode(mut cx) {
      let mut this = cx.this();
      let value = cx.argument::<JsString>(0)?.value();
      let guard = cx.lock();
      let idx = this.borrow_mut(&guard).graph.add_node(value);
      Ok(cx.number(idx.index() as f64).upcast())
    }

    method getNodeValue(mut cx) {
      let idx = cx.argument::<JsNumber>(0)?.value();
      let this = cx.this();
      let weight = {
        let guard = cx.lock();
        let graph = this.borrow(&guard);
        let value = graph.graph.node_weight(NodeIndex::new(idx as usize));
        value.unwrap().clone()
      };

      Ok(cx.string(weight).upcast())
    }
  }
}

register_module!(mut cx, {
  cx.export_class::<JsGraph>("Graph")?;
  Ok(())
});
