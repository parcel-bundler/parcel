use petgraph::graph::NodeIndex;
use petgraph::Graph as PetGraph;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Graph {
  graph: PetGraph<JsValue, i32>,
}

#[wasm_bindgen]
impl Graph {
  #[wasm_bindgen(constructor)]
  pub fn new() -> Graph {
    Graph {
      graph: PetGraph::new(),
    }
  }

  #[wasm_bindgen(js_name = "addNode")]
  pub fn add_node(&mut self, value: JsValue) -> usize {
    self.graph.add_node(value).index()
  }

  #[wasm_bindgen(js_name = "getNodeValue")]
  pub fn get_node_value(&self, index: usize) -> JsValue {
    match self.graph.node_weight(NodeIndex::new(index)) {
      Some(value) => value.clone(),
      None => JsValue::null(),
    }
  }
}
