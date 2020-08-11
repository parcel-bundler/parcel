use neon::prelude::*;
use petgraph::graph::NodeIndex;
use petgraph::Graph as PetGraph;
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
enum Value {
  F64(f64),
  String(String),
  Object(HashMap<String, Value>),
  Map(HashMap<Value, Value>),
  Set(HashSet<Value>),
  Null,
  Undefined,
  Bool(bool),
}

fn js_value_to_value(_js: &Handle<JsValue>) -> Value {
  Value::Null
}

fn value_to_js_value<'a>(
  cx: &mut neon::context::CallContext<'a, JsGraph>,
  _value: &Value,
) -> JsResult<'a, JsValue> {
  Ok(cx.null().upcast())
}

pub struct Graph {
  graph: PetGraph<Value, i32>,
  id_to_index: HashMap<String, NodeIndex>,
}

impl Graph {
  pub fn new() -> Graph {
    Graph {
      graph: PetGraph::new(),
      id_to_index: HashMap::new(),
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
      let value = cx.argument::<JsObject>(0)?;
      let idx = {
        let guard = cx.lock();
        let mut graph = this.borrow_mut(&guard);
        graph.graph.add_node(js_value_to_value(&value.upcast()))
      };

      let id = {
        value.get(&mut cx, "id").unwrap().downcast::<JsString>().or_throw(&mut cx).unwrap().value()
      };

      {
        let guard = cx.lock();
        let mut graph = this.borrow_mut(&guard);
        graph.id_to_index.insert(
          id,
          idx
        );
      }
      // Ok(cx.number(idx.index() as f64).upcast())
      Ok(value.upcast())
    }

    method getNode(mut cx) {
      let id = cx.argument::<JsString>(0)?.value();
      let this = cx.this();
      let idx = {
        let guard = cx.lock();
        let graph = this.borrow(&guard);
        graph.id_to_index.get(&id).unwrap().clone()
      };
      let weight = {
        let guard = cx.lock();
        let graph = this.borrow(&guard);
        graph.graph.node_weight(idx).unwrap().clone()
      };

      value_to_js_value(&mut cx, &weight)
    }
  }
}

register_module!(mut cx, {
  cx.export_class::<JsGraph>("Graph")?;
  Ok(())
});
