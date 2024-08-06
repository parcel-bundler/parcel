use std::path::PathBuf;

use napi::{JsObject, JsUnknown};
use parcel_napi_helpers::js_callable::JsCallable;
use parcel_napi_helpers::{anyhow_from_napi, option_to_napi};

use crate::RpcWorker;

/// RpcConnectionNodejs wraps the communication with a
/// single Nodejs worker thread
pub struct NodejsWorker {
  ping_fn: JsCallable,
  load_resolver: JsCallable,
}

impl NodejsWorker {
  pub fn new(delegate: JsObject) -> napi::Result<Self> {
    Ok(Self {
      ping_fn: JsCallable::new_from_object_prop_bound("ping", &delegate)?,
      load_resolver: JsCallable::new_from_object_prop_bound("loadResolver", &delegate)?,
    })
  }
}

impl RpcWorker for NodejsWorker {
  fn ping(&self) -> anyhow::Result<()> {
    self
      .ping_fn
      .call_with_return(
        |_env| Ok(Vec::<JsUnknown>::new()),
        |_env, _| Ok(Vec::<()>::new()),
      )
      .map_err(anyhow_from_napi)?;
    Ok(())
  }

  fn load_resolver(&self, resolve_from: PathBuf, specifier: String) -> anyhow::Result<()> {
    let resolve_from = resolve_from
      .to_str()
      .ok_or_else(option_to_napi)?
      .to_string();

    self
      .load_resolver
      .call_with_return(
        move |env| {
          let mut options = env.create_object()?;
          options.set_named_property("resolveFrom", resolve_from)?;
          options.set_named_property("specifier", specifier)?;

          Ok(vec![options.into_unknown()])
        },
        |_env, _val| {
          return Ok(());
        },
      )
      .map_err(anyhow_from_napi)
  }
}
