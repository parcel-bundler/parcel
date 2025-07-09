use std::{cell::RefCell, collections::HashMap, rc::Rc, sync::Arc};

use indexmap::indexmap;
use parcel_core::Environment;
use swc_core::{
  common::{sync::Lrc, Globals, Mark, SourceMap, SyntaxContext},
  ecma::{
    ast::*,
    transforms::base::resolver,
    visit::{VisitMut, VisitMutWith},
  },
};

use crate::{
  buffer::BufferConstructor,
  builtin_object,
  collect_constants::collect_constants,
  fs::create_fs_module,
  import::{self, Import},
  import_meta::ImportMeta,
  module::{ImportNamespace, ModuleRecord, Symbol},
  path::create_path_module,
  process::{EnvObject, Process},
  promise::Promise,
  require::Require,
  url::URL,
  worker::{paint_worklet, service_worker_register, SharedWorker, Worker},
  Evaluate, Evaluator, JsValue, StaticOrRc,
};

pub fn transform(module: &mut Module, env: Arc<Environment>, source_map: Lrc<SourceMap>) {
  swc_core::common::GLOBALS.set(&Globals::new(), || {
    let record = Rc::new(RefCell::new(ModuleRecord::new(env.clone(), source_map)));
    let unresolved_mark = Mark::fresh(Mark::root());
    let global_mark = Mark::fresh(Mark::root());
    module.visit_mut_with(&mut resolver(unresolved_mark, global_mark, true));

    let mut evaluator = Evaluator::new();
    setup_environment(&mut evaluator, record.clone(), unresolved_mark);

    record.borrow_mut().parse_module(module, &mut evaluator);
    collect_constants(&module, &mut evaluator);

    let mut transformer = Transform {
      evaluator: &evaluator,
      unresolved_mark,
    };

    module.visit_mut_with(&mut transformer);
  });
}

fn setup_environment(
  evaluator: &mut Evaluator,
  module: Rc<RefCell<ModuleRecord>>,
  unresolved_mark: Mark,
) {
  let record = module.borrow();
  let ctxt = SyntaxContext::empty().apply_mark(unresolved_mark);

  evaluator.add_value(
    ("Promise".into(), ctxt),
    JsValue::Function((&Promise).into()),
  );

  let mut builtin_modules = HashMap::new();
  if !record.env.is_node() {
    let fs = create_fs_module("/".into(), module.clone());
    let path = create_path_module();
    builtin_modules.insert("fs", fs.clone());
    builtin_modules.insert("node:fs", fs);
    builtin_modules.insert("path", path.clone());
    builtin_modules.insert("node:path", path);
  }

  let require = JsValue::Function(
    Rc::new(Require {
      module: module.clone(),
    })
    .into(),
  );

  evaluator.add_value(("require".into(), ctxt), require.clone());

  evaluator.add_value(
    ("module".into(), ctxt),
    JsValue::Object(
      Rc::new(indexmap::indexmap! {
        "require".into() => require.clone(),
      })
      .into(),
    ),
  );

  evaluator.add_value(
    ("URL".into(), ctxt),
    JsValue::Function(
      Rc::new(URL {
        module: module.clone(),
      })
      .into(),
    ),
  );

  if record.env.context.is_browser() {
    evaluator.add_value(("Worker".into(), ctxt), JsValue::Function((&Worker).into()));
    evaluator.add_value(
      ("SharedWorker".into(), ctxt),
      JsValue::Function((&SharedWorker).into()),
    );

    evaluator.add_value(
      ("navigator".into(), ctxt),
      builtin_object! {
        "serviceWorker" => builtin_object! {
          "register" => JsValue::Function(StaticOrRc::Static(&service_worker_register)),
        },
      },
    );

    evaluator.add_value(
      ("CSS".into(), ctxt),
      builtin_object! {
        "paintWorklet" => builtin_object! {
          "addModule" => JsValue::Function(StaticOrRc::Static(&paint_worklet)),
        },
      },
    );
  }

  evaluator.add_value(
    ("process".into(), ctxt),
    JsValue::Object(
      Rc::new(Process {
        module: module.clone(),
        env: Rc::new(EnvObject::new(indexmap! {
          "NODE_ENV".into() => "production".into()
        })),
        browser: true,
      })
      .into(),
    ),
  );

  evaluator.add_value(
    ("Buffer".into(), ctxt),
    JsValue::Function(
      Rc::new(BufferConstructor {
        module: module.clone(),
      })
      .into(),
    ),
  );

  evaluator.import_meta = JsValue::Object(Rc::new(ImportMeta::new("/".into())).into());

  evaluator.dynamic_import = JsValue::Function(
    Rc::new(Import {
      module: module.clone(),
    })
    .into(),
  );
}

struct Transform<'a> {
  evaluator: &'a Evaluator<'a>,
  unresolved_mark: Mark,
}

impl<'a> VisitMut for Transform<'a> {
  fn visit_mut_expr(&mut self, expr: &mut Expr) {
    if matches!(
      expr,
      Expr::Call(_) | Expr::New(_) | Expr::Member(_) | Expr::MetaProp(_) | Expr::Unary(_)
    ) || matches!(expr, Expr::Ident(id) if id.ctxt.has_mark(self.unresolved_mark))
    {
      let value = expr.evaluate(&self.evaluator);
      if value.update_expr(expr).is_ok() {
        return;
      }
    }

    expr.visit_mut_children_with(self);
  }
}

#[cfg(test)]
mod tests {
  use swc_core::{
    common::FileName,
    ecma::{codegen::to_code, parser::parse_file_as_module},
  };

  use super::*;

  fn test(code: &str) {
    let source_map = Lrc::new(SourceMap::default());
    let source_file = source_map.new_source_file(Lrc::new(FileName::Anon), code.into());

    let mut recovered_errors = Vec::new();
    let mut module = parse_file_as_module(
      &source_file,
      Default::default(),
      Default::default(),
      None,
      &mut recovered_errors,
    )
    .unwrap();

    let env = Arc::new(Environment::default());
    transform(&mut module, env.clone(), source_map.clone());

    println!("{}", to_code(&module));
  }

  #[test]
  fn test_transform() {
    test("const test = 'hi'; console.log(test.toUpperCase());");
    test("const test = {foo: 'hi'}; console.log(test.foo);");
    test("const test = require('foo'); const x = test.foo; test.foo = 3;");
    test("const test = await Promise.resolve().then(() => require('other'))");
    test("const test = await new Promise(resolve => resolve(require('other')))");
    test("import * as test from 'test'; const x = test.foo;");
    test("let url = new URL('test.png', import.meta.url);");
    test("let worker = new Worker(new URL('test.png', import.meta.url));");
    test("let worker = new Worker(new URL('test.png', import.meta.url), {type: 'module'});");
    test("let worker = new SharedWorker(new URL('test.png', import.meta.url));");
    test("let worker = new SharedWorker(new URL('test.png', import.meta.url), {type: 'module'});");
    test("let worker = navigator.serviceWorker.register(new URL('test.png', import.meta.url));");
    test("let worker = navigator.serviceWorker.register(new URL('test.png', import.meta.url), {type: 'module'});");
    test("let worker = CSS.paintWorklet.addModule(new URL('test.png', import.meta.url));");
    test("console.log(import.meta.url)");
    test("console.log(import.meta)");
    test("console.log(process.env.NODE_ENV)");
    test("console.log(process.env)");
    test("console.log(typeof process.env)");
    test("console.log(process.browser)");
    test("console.log(process.test)");
    test("console.log(process)");
    test("console.log(typeof process)");
    test("console.log(Buffer)");
    test("console.log(Buffer.from('hi'))");
    test("console.log(Buffer.from('7468697320697320612074c3a97374', 'hex').toString())");
    test("console.log(Buffer.from('😍').length)");
    test("import {join} from 'path'; console.log(join('foo', 'bar'))");
    test("import * as path from 'path'; console.log(path.join('foo', 'bar'))");
    test("import path from 'path'; console.log(path.join('foo', 'bar'))");
    test("const {join} = require('path'); console.log(join('foo', 'bar'))");
    test("const path = require('path'); console.log(path.join('foo', 'bar'))");
  }
}
