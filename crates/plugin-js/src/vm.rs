//! Node's `vm` builtin. Each context is a separate QuickJS context with its own
//! intrinsics in the plugin runtime, so values pass between contexts freely.
//!
//! A small engine extension installs the sandbox itself as the global object.
//! Builtin descriptors are copied onto it, preserving existing properties and
//! its prototype. Script declarations and assignments therefore update the
//! sandbox immediately, including from escaped functions and host callbacks.
//!
//! Unlike Node's forwarding global, builtins are visible on the sandbox, deleting
//! one does not reveal an intrinsic fallback, and the global has the sandbox's
//! identity and prototype. Only ordinary objects are supported, not proxies or
//! other exotic objects. Global lexical declarations remain in the realm's
//! separate lexical environment, as in normal QuickJS evaluation.

use std::ptr::NonNull;

use rquickjs::{
  Ctx, Function, JsLifetime, Object, Value, class::Trace, context::EvalOptions, function::Opt, qjs,
};

unsafe extern "C" {
  /// Borrows an ordinary object from the same runtime and installs it as the
  /// context's global. Returns -1 with a pending exception for unsupported objects.
  fn parcel_set_global_object(ctx: *mut qjs::JSContext, global: qjs::JSValue) -> std::ffi::c_int;
}

/// Takes the original global explicitly: the sandbox is already installed when
/// this runs, and may not yet have any builtins (or may override them).
const SETUP: &str = r#"(function (sandbox, intrinsics) {
  const {defineProperty, getOwnPropertyDescriptor} = intrinsics.Object;
  for (const key of intrinsics.Reflect.ownKeys(intrinsics)) {
    if (key in sandbox) {
      continue;
    }
    const descriptor = getOwnPropertyDescriptor(intrinsics, key);
    if (key === 'globalThis') {
      descriptor.value = sandbox;
    }
    defineProperty(sandbox, key, descriptor);
  }
})"#;

/// The `vm` module API, built on the `VmContext` primitive.
const MODULE: &str = r#"(function (VmContext) {
  const contexts = new WeakMap();

  function createContext(sandbox = {}) {
    if (!contexts.has(sandbox)) {
      contexts.set(sandbox, new VmContext(sandbox));
    }
    return sandbox;
  }

  function isContext(sandbox) {
    return contexts.has(sandbox);
  }

  function filenameOf(options) {
    return typeof options === 'string' ? options : options?.filename;
  }

  function runInContext(code, sandbox, options) {
    const context = contexts.get(sandbox);
    if (context === undefined) {
      throw new TypeError('The "contextifiedObject" argument must be an vm.Context');
    }
    return context.eval(String(code), filenameOf(options) ?? 'evalmachine.<anonymous>');
  }

  function runInNewContext(code, sandbox, options) {
    return runInContext(code, createContext(sandbox), options);
  }

  function runInThisContext(code, options) {
    return VmContext.evalInThisContext(String(code), filenameOf(options) ?? 'evalmachine.<anonymous>');
  }

  class Script {
    constructor(code, options) {
      this.code = String(code);
      this.filename = filenameOf(options);
    }
    runInContext(sandbox, options) {
      return runInContext(this.code, sandbox, {filename: this.filename, ...options});
    }
    runInNewContext(sandbox, options) {
      return runInNewContext(this.code, sandbox, {filename: this.filename, ...options});
    }
    runInThisContext(options) {
      return runInThisContext(this.code, {filename: this.filename, ...options});
    }
  }

  return {Script, createContext, isContext, runInContext, runInNewContext, runInThisContext};
})"#;

/// A separate context in the plugin runtime.
///
/// The context is kept alive by `realm`, a function referencing it as its realm,
/// rather than by an owned context reference here. That keeps its lifetime
/// visible to the garbage collector, which frees it along with the sandbox in a
/// single pass. Freeing an owned reference from a finalizer instead takes another
/// pass, which QuickJS doesn't run when the runtime itself is freed.
#[derive(Trace, JsLifetime)]
#[rquickjs::class]
pub struct VmContext<'js> {
  /// The setup function keeps the realm alive even if the sandbox overrides or
  /// deletes all of its builtin functions. This edge is visible to the GC.
  realm: Function<'js>,
  #[qjs(skip_trace)]
  context: RawContext,
}

/// An unowned pointer to a context, valid while `VmContext::realm` is alive.
#[derive(Clone, Copy)]
struct RawContext(NonNull<qjs::JSContext>);

impl<'js> VmContext<'js> {
  /// A `Ctx` for this context. It shares `'js` with the caller's context: both
  /// belong to the same runtime, whose lock the caller holds.
  fn ctx(&self) -> Ctx<'js> {
    unsafe { Ctx::from_raw(self.context.0) }
  }
}

#[rquickjs::methods(rename_all = "camelCase")]
impl<'js> VmContext<'js> {
  #[qjs(constructor)]
  pub fn new(ctx: Ctx<'js>, sandbox: Object<'js>) -> rquickjs::Result<Self> {
    let raw = unsafe { qjs::JS_NewContext(qjs::JS_GetRuntime(ctx.as_raw().as_ptr())) };
    let raw = NonNull::new(raw).ok_or(rquickjs::Error::Allocation)?;
    let vm_ctx: Ctx<'js> = unsafe { Ctx::from_raw(raw) };
    // `vm_ctx` owns a reference until `realm` can keep the context alive.
    unsafe { qjs::JS_FreeContext(raw.as_ptr()) };
    let setup: Function = vm_ctx.eval(SETUP).map_err(|e| rethrow(&ctx, &vm_ctx, e))?;
    let intrinsics = vm_ctx.globals();
    // SAFETY: both objects belong to this runtime, whose lock the caller holds.
    // The extension validates the object before mutation and duplicates its
    // reference. No user script has run in this context yet.
    if unsafe { parcel_set_global_object(raw.as_ptr(), sandbox.as_raw()) } < 0 {
      return Err(rethrow(&ctx, &vm_ctx, rquickjs::Error::Exception));
    }
    setup
      .call::<_, ()>((sandbox, intrinsics))
      .map_err(|e| rethrow(&ctx, &vm_ctx, e))?;
    Ok(VmContext {
      realm: setup,
      context: RawContext(raw),
    })
  }

  /// Evaluates a script in this context.
  pub fn eval(
    &self,
    ctx: Ctx<'js>,
    code: String,
    filename: Opt<String>,
  ) -> rquickjs::Result<Value<'js>> {
    let vm_ctx = self.ctx();
    vm_ctx
      .eval_with_options(code, eval_options(filename.0))
      .map_err(|e| rethrow(&ctx, &vm_ctx, e))
  }

  #[qjs(static)]
  pub fn eval_in_this_context(
    ctx: Ctx<'js>,
    code: String,
    filename: Opt<String>,
  ) -> rquickjs::Result<Value<'js>> {
    ctx.eval_with_options(code, eval_options(filename.0))
  }
}

fn eval_options(filename: Option<String>) -> EvalOptions {
  let mut options = EvalOptions::default();
  options.global = true;
  options.strict = false;
  options.filename = filename;
  options
}

/// Moves an exception pending in the vm context to the calling context.
fn rethrow<'js>(ctx: &Ctx<'js>, vm_ctx: &Ctx<'js>, error: rquickjs::Error) -> rquickjs::Error {
  if error.is_exception() {
    ctx.throw(vm_ctx.catch())
  } else {
    error
  }
}

/// Node's `vm` builtin.
pub fn vm_module<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
  let factory: Function = ctx.eval(MODULE)?;
  let constructor = rquickjs::Class::<VmContext>::create_constructor(ctx)?;
  factory.call((constructor,))
}

#[cfg(test)]
mod tests {
  use rquickjs::{Context, Runtime};

  use super::*;

  #[test]
  fn escaped_functions_keep_their_sandbox_alive() {
    let rt = Runtime::new().unwrap();
    let context = Context::full(&rt).unwrap();
    context.with(|ctx| {
      ctx.globals().set("vm", vm_module(&ctx).unwrap()).unwrap();
      ctx
        .eval::<(), _>("globalThis.escaped = vm.runInNewContext('() => ++value', {value: 41})")
        .unwrap();
    });
    rt.run_gc();
    context.with(|ctx| {
      assert_eq!(ctx.eval::<i32, _>("escaped()").unwrap(), 42);
    });
  }

  #[test]
  fn realm_survives_removing_builtin_functions() {
    let rt = Runtime::new().unwrap();
    let context = Context::full(&rt).unwrap();
    context.with(|ctx| {
      ctx.globals().set("vm", vm_module(&ctx).unwrap()).unwrap();
      ctx
        .eval::<(), _>(
          "globalThis.sandbox = vm.createContext({});
           for (const key of Reflect.ownKeys(sandbox)) {
             if (Object.getOwnPropertyDescriptor(sandbox, key).configurable) delete sandbox[key];
           }",
        )
        .unwrap();
    });
    rt.run_gc();
    context.with(|ctx| {
      assert_eq!(
        ctx
          .eval::<i32, _>("vm.runInContext('var answer = 42', sandbox); sandbox.answer")
          .unwrap(),
        42
      );
    });
  }

  #[test]
  fn unsupported_sandboxes_fail_without_running_proxy_traps() {
    let rt = Runtime::new().unwrap();
    let context = Context::full(&rt).unwrap();
    context.with(|ctx| {
      ctx.globals().set("vm", vm_module(&ctx).unwrap()).unwrap();
      assert!(
        ctx
          .eval::<bool, _>(
            "(() => {
              let traps = 0;
              const proxy = new Proxy({}, {
                has() { traps++; return false; },
                defineProperty() { traps++; return true; }
              });
              for (const sandbox of [proxy, [], new Date(), Object.freeze({})]) {
                let error;
                try { vm.createContext(sandbox); } catch (e) { error = e; }
                if (error?.name !== 'TypeError' || vm.isContext(sandbox)) return false;
              }
              return traps === 0 && vm.runInNewContext('1 + 1') === 2;
            })()",
          )
          .unwrap()
      );
    });
    rt.run_gc();
  }

  /// Bytes allocated by the runtime after running `script` with `vm` in scope, then collecting garbage.
  fn memory_after(rt: &Runtime, context: &Context, script: &str) -> i64 {
    context.with(|ctx| {
      let vm = vm_module(&ctx).unwrap();
      let run: Function = ctx.eval(format!("(function (vm) {{ {script} }})")).unwrap();
      run.call::<_, ()>((vm,)).unwrap();
    });
    rt.run_gc();
    rt.memory_usage().malloc_size
  }

  #[test]
  fn contexts_are_freed_with_their_sandbox() {
    let rt = Runtime::new().unwrap();
    let context = Context::full(&rt).unwrap();
    let script = "
      for (let i = 0; i < 2000; i++) {
        const sandbox = vm.createContext({value: i});
        vm.runInContext('var declared = value; undeclared = value + 1; value', sandbox);
      }";

    let warm = memory_after(&rt, &context, script);
    let after = memory_after(&rt, &context, script);
    // One context is tens of KB, so leaking even a fraction of 2000 would show.
    assert!(
      after - warm < 512 * 1024,
      "memory grew from {warm} to {after} bytes"
    );

    // Contexts kept alive by their sandboxes are retained, so the measurement can see them.
    let retained = memory_after(
      &rt,
      &context,
      "globalThis.kept = [];
       for (let i = 0; i < 200; i++) kept.push(vm.createContext({}));",
    );
    assert!(
      retained - after > 1024 * 1024,
      "200 live contexts only used {} bytes",
      retained - after
    );
  }

  #[test]
  fn plugin_runtime_frees_live_contexts_on_drop() {
    let env = crate::create_runtime(
      std::sync::Arc::new(parcel_core::MemoryFileSystem::new()),
      &std::collections::HashMap::new(),
      parcel_core::PathId::root(),
      parcel_core::Environment::Node,
    )
    .unwrap();
    env
      .context
      .with(|ctx| {
        ctx.globals().set("vm", vm_module(&ctx)?)?;
        // Like posthtml-expressions, which creates a context at module scope.
        ctx.eval::<(), _>(
          "globalThis.kept = vm.createContext({}); vm.runInContext('var x = 1', kept);",
        )
      })
      .unwrap();
    // QuickJS aborts if the runtime is freed while objects remain.
    drop(env);
  }
}
