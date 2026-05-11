use std::{cell::RefCell, rc::Rc, sync::Arc};

use indexmap::IndexMap;
use parcel_core::{
  AssetRequest, AssetType, BundleBehavior, Dependency, DependencyFlags, DependencyResolution,
  ExportsCondition, FileSystem, Location, Priority, SourceLocation, SourceUrl, SpecifierType,
  Target,
};
use parcel_macros::{JsValue, MacroError};
use rquickjs::{
  Ctx, Function, JsLifetime, Object, Type, Value,
  class::{self, Trace},
  function::{Args, Constructor},
  methods,
};

use crate::{plugin::load_module, with_js_env};

#[derive(JsLifetime)]
#[rquickjs::class]
pub struct MacroContext {
  url: SourceUrl,
  target: Arc<Target>,
  loc: parcel_macros::Location,
  dependencies: Rc<RefCell<Vec<Dependency>>>,
}

impl<'js> Trace<'js> for MacroContext {
  fn trace<'a>(&self, _tracer: class::Tracer<'a, 'js>) {}
}

#[methods]
impl MacroContext {
  #[qjs(rename = "addAsset")]
  fn add_asset<'js>(&mut self, asset: Object<'js>) {
    let ty: String = asset.get("type").unwrap();
    let ty = AssetType::from_extension(&ty);
    let content: String = asset.get("content").unwrap();
    self.dependencies.borrow_mut().push(Dependency {
      specifier: format!("macro"),
      specifier_type: SpecifierType::Esm,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::MACRO,
      target: self.target.clone(),
      loc: Some(SourceLocation {
        url: self.url.clone(),
        start: Location {
          line: self.loc.line,
          column: self.loc.col,
        },
        end: Location {
          line: self.loc.line,
          column: self.loc.col,
        },
      }),
      placeholder: None,
      resolve_from: None,
      range: None,
      conditions: ExportsCondition::empty(),
      resolution: DependencyResolution::Deferred(Arc::new(AssetRequest {
        url: self.url.clone(),
        pipeline: None,
        target: Target::normalize(&self.target, &ty),
        ty,
        code: Some(content.into_bytes()),
        side_effects: true,
      })),
    })
  }

  #[qjs(get)]
  fn loc<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    let res = Object::new(ctx)?;
    res.set("filePath", self.url.as_str())?;
    res.set("line", self.loc.line)?;
    res.set("col", self.loc.col)?;
    Ok(res)
  }

  // TODO: invalidations
}

pub fn call_macro(
  fs: Arc<dyn FileSystem>,
  url: SourceUrl,
  target: Arc<Target>,
  src: String,
  export: String,
  args: Vec<JsValue>,
  loc: parcel_macros::Location,
) -> Result<(JsValue, Vec<Dependency>), MacroError> {
  with_js_env(fs, |ctx| {
    let module = load_module(&ctx, &src)?;
    let f: Function = module.get(&export)?;
    let mut js_args = Args::new(ctx.clone(), args.len());
    let dependencies = Rc::new(RefCell::new(Vec::new()));
    let context = MacroContext {
      url,
      target,
      loc,
      dependencies: dependencies.clone(),
    };
    js_args.this(context)?;
    for arg in args {
      js_args.push_arg(js_value_to_quickjs(arg, ctx.clone())?)?;
    }
    let result: rquickjs::Value = f.call_arg(js_args)?;
    if result.is_promise() {
      // TODO
    }
    let result = quickjs_to_js_value(result, ctx.clone())?;
    Ok((result, std::mem::take(&mut *dependencies.borrow_mut())))
  })
  .map_err(|d| MacroError::ExecutionError(d.0[0].message.clone(), Default::default()))
}

fn js_value_to_quickjs<'a>(value: JsValue, ctx: Ctx<'a>) -> rquickjs::Result<rquickjs::Value<'a>> {
  match value {
    JsValue::Undefined => Ok(rquickjs::Value::new_undefined(ctx)),
    JsValue::Null => Ok(rquickjs::Value::new_null(ctx)),
    JsValue::Bool(b) => Ok(rquickjs::Value::new_bool(ctx, b)),
    JsValue::Number(n) => Ok(rquickjs::Value::new_number(ctx, n)),
    JsValue::String(s) => Ok(rquickjs::String::from_str(ctx, &s)?.into_value()),
    JsValue::Regex { source, flags } => {
      let regexp_class: Constructor = ctx.globals().get("RegExp")?;
      let source = rquickjs::String::from_str(ctx.clone(), &source)?.into_value();
      let flags = rquickjs::String::from_str(ctx, &flags)?.into_value();
      let re: Value = regexp_class.construct((source, flags))?;
      Ok(re)
    }
    JsValue::Array(arr) => {
      let res = rquickjs::Array::new(ctx.clone())?;
      for (i, val) in arr.into_iter().enumerate() {
        res.set(i, js_value_to_quickjs(val, ctx.clone())?)?;
      }
      Ok(res.into_value())
    }
    JsValue::Object(obj) => {
      let res = rquickjs::Object::new(ctx.clone())?;
      for (k, v) in obj {
        res.set(&k, js_value_to_quickjs(v, ctx.clone())?)?;
      }
      Ok(res.into_value())
    }
    JsValue::Function(_) => {
      // Functions can only be returned from macros, not passed in.
      unreachable!()
    }
  }
}

fn quickjs_to_js_value<'a>(value: rquickjs::Value<'a>, ctx: Ctx<'a>) -> rquickjs::Result<JsValue> {
  match value.type_of() {
    Type::Undefined | Type::Uninitialized => Ok(JsValue::Undefined),
    Type::Null => Ok(JsValue::Null),
    Type::Float => Ok(JsValue::Number(value.as_float().unwrap())),
    Type::Int => Ok(JsValue::Number(value.as_int().unwrap() as f64)),
    Type::Bool => Ok(JsValue::Bool(value.as_bool().unwrap())),
    Type::String => Ok(JsValue::String(
      value.get::<rquickjs::String>()?.to_string()?,
    )),
    Type::Array => {
      let js_arr = value.get::<rquickjs::Array>()?;
      let len = js_arr.len();
      let mut arr = Vec::with_capacity(len);
      for i in 0..len {
        let elem = quickjs_to_js_value(js_arr.get(i)?, ctx.clone())?;
        arr.push(elem);
      }
      Ok(JsValue::Array(arr))
    }
    Type::Object => {
      let obj = value.get::<rquickjs::Object>()?;
      let regexp_class: Constructor = ctx.globals().get("RegExp")?;
      if obj.is_instance_of(regexp_class) {
        let source: rquickjs::String = obj.get("source")?;
        let flags: rquickjs::String = obj.get("flags")?;
        return Ok(JsValue::Regex {
          source: source.to_string()?,
          flags: flags.to_string()?,
        });
      }

      let mut props = IndexMap::new();
      for prop in obj.props::<rquickjs::String, rquickjs::Value>() {
        let (key, value) = prop?;
        let value = quickjs_to_js_value(value, ctx.clone())?;
        props.insert(key.to_string()?, value);
      }
      Ok(JsValue::Object(props))
    }
    Type::Function | Type::Constructor => {
      let string: Function = ctx.globals().get("String")?;
      let source: rquickjs::String = string.call((value, ()))?;
      Ok(JsValue::Function(source.to_string()?))
    }
    Type::Symbol
    | Type::Promise
    | Type::Exception
    | Type::Proxy
    | Type::Module
    | Type::Unknown
    | Type::BigInt => Err(rquickjs::Error::Unknown),
  }
}
