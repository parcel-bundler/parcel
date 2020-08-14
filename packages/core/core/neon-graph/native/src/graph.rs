use petgraph::graph::{EdgeIndex, NodeIndex};
use petgraph::stable_graph::StableGraph;
use petgraph::visit::{depth_first_search, Control, DfsEvent};
use std::collections::HashMap;
use std::io::{Error, ErrorKind};

#[derive(Clone)]
pub enum Value {
  F64(f64),
  Array(Vec<Value>),
  String(String),
  Object(HashMap<String, Value>),
  // _Map(HashMap<Value, Value>),
  // _Set(HashSet<Value>),
  Null,
  Undefined,
  Bool(bool),
}

pub struct Graph {
  graph: StableGraph<HashMap<String, Value>, Option<String>>,
  id_to_index: HashMap<String, NodeIndex>,
  root_node_id: Option<String>,
}

impl Graph {
  pub fn new() -> Graph {
    Graph {
      graph: StableGraph::new(),
      id_to_index: HashMap::new(),
      root_node_id: None,
    }
  }

  pub fn add_node(&mut self, value: &HashMap<String, Value>) -> Result<(), Error> {
    let idx = self.graph.add_node(value.clone());
    let id = get_node_id(value)?;
    self.id_to_index.insert(String::from(id), idx);
    Ok(())
  }

  pub fn get_node(&mut self, id: &str) -> Option<&HashMap<String, Value>> {
    let idx = self.id_to_index.get(id)?;
    self.graph.node_weight(idx.clone())
  }

  pub fn remove_node(&mut self, value: &HashMap<String, Value>) -> Option<HashMap<String, Value>> {
    let id = match get_node_id(value) {
      Ok(id) => id,
      Err(_) => return None,
    };

    let idx = self.id_to_index.get(id)?.clone();
    self.id_to_index.remove(id);
    self.graph.remove_node(idx)
  }

  pub fn remove_by_id(&mut self, id: &str) -> Option<HashMap<String, Value>> {
    let idx = self.id_to_index.get(id)?.clone();
    self.id_to_index.remove(id);
    self.graph.remove_node(idx)
  }

  pub fn add_edge(&mut self, id_a: &str, id_b: &str, weight: Option<&str>) -> Option<EdgeIndex> {
    let idx_a = self.id_to_index.get(id_a)?.clone();
    let idx_b = self.id_to_index.get(id_b)?.clone();

    let weight = match weight {
      Some(weight) => Some(weight.to_owned()),
      None => None,
    };

    Some(self.graph.add_edge(idx_a, idx_b, weight))
  }

  pub fn set_root_node(&mut self, value: &HashMap<String, Value>) -> Result<(), Error> {
    let id = get_node_id(value)?;
    self.add_node(value)?;
    self.root_node_id = Some(id.to_string());
    Ok(())
  }

  pub fn traverse<F>(
    &mut self,
    start_node: Option<&HashMap<String, Value>>,
    edge_type: Option<&str>,
    on_enter: F,
  ) -> Result<(), Error>
  where
    F: Fn(&HashMap<String, Value>),
  {
    let start_node = match start_node {
      Some(node) => get_node_id(node)?,
      None => self.root_node_id.as_ref().unwrap(),
    };

    let idx = self.id_to_index.get(start_node).unwrap().clone();

    depth_first_search(&self.graph, Some(idx), |event| match event {
      DfsEvent::Discover(discovered, _) => {
        on_enter(self.graph.node_weight(discovered).unwrap());
        Control::<()>::Continue
      }
      DfsEvent::TreeEdge(u, v) => {
        let eidx = self.graph.find_edge(u, v).unwrap();
        let found_edge_type = self
          .graph
          .edge_weight(eidx)
          .unwrap()
          .as_ref()
          .map(|string| &string[..]);

        if found_edge_type != edge_type {
          Control::Prune
        } else {
          Control::Continue
        }
      }
      DfsEvent::BackEdge(_, _) => Control::Continue,
      DfsEvent::CrossForwardEdge(_, _) => Control::Continue,
      DfsEvent::Finish(_, _) => Control::Continue,
    });

    Ok(())
  }
}

fn get_node_id(value: &HashMap<String, Value>) -> Result<&str, Error> {
  let id_value = value.get("id");

  match id_value {
    Some(x) => match x {
      Value::String(string) => {
        return Ok(string);
      }
      _ => Err(Error::new(
        ErrorKind::InvalidData,
        "Node id value was not a string",
      )),
    },
    None => Err(Error::new(
      ErrorKind::InvalidData,
      "Node does not have an id",
    )),
  }
}
