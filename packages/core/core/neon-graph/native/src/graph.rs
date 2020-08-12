use petgraph::graph::NodeIndex;
use petgraph::stable_graph::StableGraph;
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
  graph: StableGraph<HashMap<String, Value>, i32>,
  id_to_index: HashMap<String, NodeIndex>,
}

impl Graph {
  pub fn new() -> Graph {
    Graph {
      graph: StableGraph::new(),
      id_to_index: HashMap::new(),
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
