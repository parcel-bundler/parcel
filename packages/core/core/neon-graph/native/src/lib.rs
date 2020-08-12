use neon::prelude::*;
use petgraph::graph::NodeIndex;
use petgraph::Graph as PetGraph;
use std::collections::HashMap;

#[derive(Clone)]
enum Value {
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

fn js_value_to_value(cx: &mut CallContext<JsGraph>, js: &Handle<JsValue>) -> NeonResult<Value> {
  match js.downcast::<JsArray>() {
    Ok(array) => {
      let js_value_vec = array.to_vec(cx)?;
      let mut value_vec = Vec::new();
      for js_value in js_value_vec {
        value_vec.push(js_value_to_value(cx, &js_value)?)
      }
      return Ok(Value::Array(value_vec));
    }
    Err(_) => {}
  };
  match js.downcast::<JsObject>() {
    Ok(object) => {
      let mut obj_map: HashMap<String, Value> = HashMap::new();
      for name in object.get_own_property_names(cx)?.to_vec(cx)? {
        let name_str = name.downcast::<JsString>().or_throw(cx)?.value();
        let value = object.get(cx, &name_str[..])?;
        obj_map.insert(name_str.clone(), js_value_to_value(cx, &value)?);
      }
      return Ok(Value::Object(obj_map));
    }
    Err(_) => {}
  };
  match js.downcast::<JsNumber>() {
    Ok(num) => return Ok(Value::F64(num.value())),
    Err(_) => {}
  };
  match js.downcast::<JsBoolean>() {
    Ok(boolean) => return Ok(Value::Bool(boolean.value())),
    Err(_) => {}
  };
  match js.downcast::<JsString>() {
    Ok(string) => return Ok(Value::String(string.value())),
    Err(_) => {}
  };
  match js.downcast::<JsNull>() {
    Ok(_) => return Ok(Value::Null),
    Err(_) => {}
  };
  match js.downcast::<JsUndefined>() {
    Ok(_) => return Ok(Value::Undefined),
    Err(_) => {}
  };
  unreachable!();
}

fn value_to_js_value<'a>(
  cx: &mut CallContext<'a, JsGraph>,
  value: &Value,
) -> JsResult<'a, JsValue> {
  Ok(match value {
    Value::F64(num) => cx.number(num.clone()).upcast(),
    Value::String(string) => cx.string(string).upcast(),
    Value::Null => cx.null().upcast(),
    Value::Undefined => cx.undefined().upcast(),
    Value::Bool(boolean) => cx.boolean(boolean.clone()).upcast(),
    Value::Array(vector) => {
      // Adapted from https://neon-bindings.com/docs/arrays
      let js_array = JsArray::new(cx, vector.len() as u32);
      for (i, value) in vector.iter().enumerate() {
        let js_value = value_to_js_value(cx, value)?;
        js_array.set(cx, i as u32, js_value)?;
      }
      js_array.upcast()
    }
    Value::Object(obj_map) => {
      let obj = JsObject::new(cx);
      for (key, value) in obj_map {
        let js_value = value_to_js_value(cx, value)?;
        obj.set(cx, &key[..], js_value)?;
      }
      obj.upcast()
    }
  })
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
      let js_value = cx.argument::<JsObject>(0)?;
      let value = js_value_to_value(&mut cx, &js_value.upcast())?;
      let idx = {
        let guard = cx.lock();
        let mut graph = this.borrow_mut(&guard);
        graph.graph.add_node(value)
      };

      let id = {
        js_value.get(&mut cx, "id").unwrap().downcast::<JsString>().or_throw(&mut cx).unwrap().value()
      };

      {
        let guard = cx.lock();
        let mut graph = this.borrow_mut(&guard);
        graph.id_to_index.insert(
          id,
          idx
        );
      }
      Ok(js_value.upcast())
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
