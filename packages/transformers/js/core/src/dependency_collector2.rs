use std::{
  collections::hash_map::DefaultHasher,
  fmt,
  hash::{Hash, Hasher},
  path::Path,
  rc::Rc,
};

use bitflags::bitflags;
use parcel_core::impl_bitflags_serde;
use parcel_evaluator::{Evaluate, Evaluator, JsConstructor, JsObject, JsValue, Object};
use path_slash::PathBufExt;
use serde::{Deserialize, Serialize};
use swc_core::{
  common::{DUMMY_SP, Mark, SourceMap, Span, SyntaxContext, sync::Lrc},
  ecma::{
    ast::{self, CallExpr, Callee, Expr, Ident, MemberProp, Module},
    atoms::Atom as JsWord,
    utils::{member_expr, stack_size::maybe_grow_default},
    visit::{Fold, FoldWith, VisitMut, VisitMutWith},
  },
};

use crate::{Config, fold_member_expr_skip_prop, utils::*};

macro_rules! hash {
  ($str:expr) => {{
    let mut hasher = DefaultHasher::new();
    $str.hash(&mut hasher);
    hasher.finish()
  }};
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum DependencyKind {
  /// Corresponds to ESM import statements
  /// ```skip
  /// import {x} from './dependency';
  /// ```
  Import,
  /// Corresponds to ESM re-export statements
  /// ```skip
  /// export {x} from './dependency';
  /// ```
  Export,
  /// Corresponds to dynamic import statements
  /// ```skip
  /// import('./dependency').then(({x}) => {/* ... */});
  /// ```
  DynamicImport,
  /// Corresponds to CJS require statements
  /// ```skip
  /// const {x} = require('./dependency');
  /// ```
  Require,
  /// Corresponds to Worker URL statements
  /// ```skip
  /// const worker = new Worker(
  ///     new URL('./dependency', import.meta.url),
  ///     {type: 'module'}
  /// );
  /// ```
  WebWorker,
  /// Corresponds to ServiceWorker URL statements
  /// ```skip
  /// navigator.serviceWorker.register(
  ///     new URL('./dependency', import.meta.url),
  ///     {type: 'module'}
  /// );
  /// ```
  ServiceWorker,
  /// CSS / WebAudio worklets
  /// ```skip
  /// CSS.paintWorklet.addModule(
  ///   new URL('./dependency', import.meta.url)
  /// );
  /// ```
  Worklet,
  /// URL statements
  /// ```skip
  /// let img = document.createElement('img');
  /// img.src = new URL('hero.jpg', import.meta.url);
  /// document.body.appendChild(img);
  /// ```
  Url,
  /// `fs.readFileSync` statements
  ///
  /// > Calls to fs.readFileSync are replaced with the file's contents if the filepath is statically
  /// > determinable and inside the project root.
  ///
  /// ```skip
  /// import fs from "fs";
  /// import path from "path";
  ///
  /// const data = fs.readFileSync(path.join(__dirname, "data.json"), "utf8");
  /// ```
  ///
  /// * https://parceljs.org/features/node-emulation/#inlining-fs.readfilesync
  File,
  /// `parcelRequire` call.
  Id,
}

bitflags! {
  #[derive(Clone, Copy, Default)]
  pub struct Helpers: u8 {
    /// `import.meta.distDir` – a relative path from the current bundle to the distDir
    const DIST_DIR = 1 << 0;
    /// `import.meta.publicUrl` - absolute public URL
    const PUBLIC_URL = 1 << 1;
    /// `parcelRequire.load`
    const LOAD = 1 << 2;
    /// `parcelRequire.resolve`
    const RESOLVE = 1 << 3;
    /// `parcelRequire.extendImportMap`
    const EXTEND_IMPORT_MAP = 1 << 4;
    /// `import.meta.devServer` – URL of Parcel HMR server
    const DEV_SERVER = 1 << 5;
  }
}

impl_bitflags_serde!(Helpers);

impl fmt::Display for DependencyKind {
  fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
    write!(f, "{:?}", self)
  }
}

bitflags! {
  #[derive(Clone, Default, Debug, PartialEq)]
  pub struct DependencyFlags: u8 {
    const OPTIONAL = 1 << 0;
    const HELPER = 1 << 1;
    const NEEDS_STABLE_NAME = 1 << 2;
    const REACT_LAZY = 1 << 3;
  }
}

impl_bitflags_serde!(DependencyFlags);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DependencyDescriptor {
  pub kind: DependencyKind,
  pub loc: SourceLocation,
  /// The text specifier associated with the import/export statement.
  pub specifier: JsWord,
  // pub attributes: Option<JsValue>,
  pub flags: DependencyFlags,
  pub source_type: Option<SourceType>,
  pub placeholder: Option<String>,
}

/// This pass collects dependencies in a module and compiles references as needed to work with Parcel's JSRuntime.
pub fn dependency_collector<'a>(
  mut module: Module,
  source_map: Lrc<SourceMap>,
  items: &'a mut Vec<DependencyDescriptor>,
  ignore_mark: swc_core::common::Mark,
  unresolved_mark: swc_core::common::Mark,
  config: &'a Config,
  diagnostics: &'a mut Vec<Diagnostic>,
) -> (Module, Helpers) {
  let mut collector = DependencyCollector::new(
    source_map,
    items,
    ignore_mark,
    unresolved_mark,
    config,
    diagnostics,
  );

  module.visit_mut_with(&mut collector);
  (module, collector.helpers)
}

struct DependencyCollector<'a> {
  source_map: Lrc<SourceMap>,
  items: &'a mut Vec<DependencyDescriptor>,
  in_try: bool,
  in_promise: bool,
  require_node: Option<ast::CallExpr>,
  ignore_mark: swc_core::common::Mark,
  unresolved_mark: swc_core::common::Mark,
  config: &'a Config,
  diagnostics: &'a mut Vec<Diagnostic>,
  import_meta: Option<ast::VarDecl>,
  helpers: Helpers,
  evaluator: Evaluator,
}

impl<'a> DependencyCollector<'a> {
  pub fn new(
    source_map: Lrc<SourceMap>,
    items: &'a mut Vec<DependencyDescriptor>,
    ignore_mark: swc_core::common::Mark,
    unresolved_mark: swc_core::common::Mark,
    config: &'a Config,
    diagnostics: &'a mut Vec<Diagnostic>,
  ) -> Self {
    let mut evaluator = Evaluator::new();
    let ctxt = SyntaxContext::empty().apply_mark(unresolved_mark);

    evaluator.add_value(
      ("require".into(), ctxt),
      JsValue::Function(Rc::new(require)),
    );

    evaluator.add_value(
      ("module".into(), ctxt),
      JsValue::Object(Rc::new(JsObject(indexmap::indexmap! {
        "require".into() => JsValue::Function(Rc::new(require)),
      }))),
    );

    evaluator.add_value(
      ("URL".into(), ctxt),
      JsValue::Function(Rc::new(JsConstructor(url_constructor))),
    );

    // __parcel__require__
    // __parcel__import__
    // __parcel__importScripts__
    // __parcel__URL__
    // parcelRequire
    // parcelRequire.load
    // parcelRequire.resolve
    // parcelRequire.extendImportMap
    // parcelRequire.meta
    // __parcel__url_dep

    if config.is_worker() {
      evaluator.add_value(
        ("importScripts".into(), ctxt),
        JsValue::Function(Rc::new(import_scripts)),
      );
    }

    if config.is_browser() {
      evaluator.add_value(
        ("navigator".into(), ctxt),
        JsValue::Object(Rc::new(JsObject(indexmap::indexmap! {
          "serviceWorker".into() => JsValue::Object(Rc::new(JsObject(indexmap::indexmap! {
            "register".into() => JsValue::Function(Rc::new(service_worker_register)),
          }))),
        }))),
      );

      evaluator.add_value(
        ("CSS".into(), ctxt),
        JsValue::Object(Rc::new(JsObject(indexmap::indexmap! {
          "paintWorklet".into() => JsValue::Object(Rc::new(JsObject(indexmap::indexmap! {
            "addModule".into() => JsValue::Function(Rc::new(paint_worklet)),
          }))),
        }))),
      );

      evaluator.add_value(
        ("Worker".into(), ctxt),
        JsValue::Function(Rc::new(JsConstructor(worker_constructor))),
      );

      evaluator.add_value(
        ("SharedWorker".into(), ctxt),
        JsValue::Function(Rc::new(JsConstructor(shared_worker_constructor))),
      );
    }

    let filename =
      if let Some(relative) = pathdiff::diff_paths(&config.filename, &config.project_root) {
        relative.to_slash_lossy()
      } else if let Some(filename) = Path::new(&config.filename).file_name() {
        String::from(filename.to_string_lossy())
      } else {
        String::from("unknown.js")
      };

    if config.source_type == SourceType::Module {
      // TODO: error if accessed in scripts
      // TODO: should have no prototype: Object.assign(Object.create(null), {url: 'file:///src/foo.js'});
      evaluator.import_meta = JsValue::Object(Rc::new(JsObject(indexmap::indexmap! {
        "url".into() => JsValue::String(format!("file:///{}", filename).into()),
        // distDir, publicUrl, devServer
      })));
    }

    evaluator.dynamic_import = JsValue::Function(Rc::new(import));

    DependencyCollector {
      source_map,
      items,
      in_try: false,
      in_promise: false,
      require_node: None,
      ignore_mark,
      unresolved_mark,
      config,
      diagnostics,
      import_meta: None,
      helpers: Helpers::empty(),
      evaluator,
    }
  }
}

impl<'a> VisitMut for DependencyCollector<'a> {
  fn visit_mut_expr(&mut self, node: &mut Expr) {
    if matches!(node, Expr::Call(_) | Expr::New(_)) {
      let res = node.evaluate(&self.evaluator);
      if let Ok(res) = res.into_expr() {
        *node = res;
        return;
      }
    }

    node.visit_mut_children_with(self);
  }
}

fn require(this: JsValue, args: Vec<JsValue>, span: Span) -> JsValue {
  if let Some(JsValue::String(src)) = args.get(0) {
    JsValue::Object(Rc::new(DepObject(DependencyDescriptor {
      kind: DependencyKind::Require,
      flags: DependencyFlags::empty(),
      loc: SourceLocation {
        start_line: 0,
        start_col: 0,
        end_line: 0,
        end_col: 0,
      },
      specifier: src.clone(),
      placeholder: None,
      source_type: None,
    })))
  } else {
    JsValue::Unknown(span)
  }
}

fn import(this: JsValue, args: Vec<JsValue>, span: Span) -> JsValue {
  if let Some(JsValue::String(src)) = args.get(0) {
    JsValue::Object(Rc::new(DepObject(DependencyDescriptor {
      kind: DependencyKind::DynamicImport,
      flags: DependencyFlags::empty(),
      loc: SourceLocation {
        start_line: 0,
        start_col: 0,
        end_line: 0,
        end_col: 0,
      },
      specifier: src.clone(),
      placeholder: None,
      source_type: None,
    })))
  } else {
    JsValue::Unknown(span)
  }
}

fn import_scripts(this: JsValue, args: Vec<JsValue>, span: Span) -> JsValue {
  if let Some(JsValue::String(src)) = args.get(0) {
    // JsValue::Object(Rc::new(DepObject(src.clone())))
    todo!()
  } else {
    JsValue::Unknown(span)
  }
}

fn service_worker_register(this: JsValue, args: Vec<JsValue>, span: Span) -> JsValue {
  if let Some(dep) = match_url_dep(&args) {
    let mut source_type = SourceType::Script;
    if let Some(JsValue::Object(obj)) = args.get(1) {
      if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), DUMMY_SP) {
        if ty == "module" {
          source_type = SourceType::Module;
        }
      }
    }

    JsValue::Object(Rc::new(DepObject(DependencyDescriptor {
      kind: DependencyKind::ServiceWorker,
      loc: SourceLocation {
        start_line: 0,
        start_col: 0,
        end_line: 0,
        end_col: 0,
      },
      specifier: dep.specifier.clone(),
      flags: DependencyFlags::empty(),
      source_type: Some(source_type),
      placeholder: None,
    })))
  } else {
    JsValue::Unknown(span)
  }
}

fn match_url_dep(args: &Vec<JsValue>) -> Option<&DependencyDescriptor> {
  // TODO: support self reference, e.g. new Worker(import.meta.url)
  if let Some(JsValue::Object(src)) = args.get(0) {
    if let Some(dep) = src.as_any().downcast_ref::<DepObject>() {
      if dep.0.kind == DependencyKind::Url {
        return Some(&dep.0);
      }
    }
  }

  None
}

fn paint_worklet(this: JsValue, args: Vec<JsValue>, span: Span) -> JsValue {
  if let Some(dep) = match_url_dep(&args) {
    let mut source_type = SourceType::Script;
    if let Some(JsValue::Object(obj)) = args.get(1) {
      if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), DUMMY_SP) {
        if ty == "module" {
          source_type = SourceType::Module;
        }
      }
    }

    JsValue::Object(Rc::new(DepObject(DependencyDescriptor {
      kind: DependencyKind::Worklet,
      loc: SourceLocation {
        start_line: 0,
        start_col: 0,
        end_line: 0,
        end_col: 0,
      },
      specifier: dep.specifier.clone(),
      flags: DependencyFlags::empty(),
      source_type: Some(source_type),
      placeholder: None,
    })))
  } else {
    JsValue::Unknown(span)
  }
}

fn url_constructor(args: Vec<JsValue>, span: Span) -> JsValue {
  if let (Some(JsValue::String(url)), Some(_)) = (args.get(0), args.get(1)) {
    JsValue::Object(Rc::new(DepObject(DependencyDescriptor {
      kind: DependencyKind::Url,
      loc: SourceLocation {
        start_line: 0,
        start_col: 0,
        end_line: 0,
        end_col: 0,
      },
      specifier: url.clone(),
      flags: DependencyFlags::empty(),
      source_type: None,
      placeholder: None,
    })))
  } else {
    JsValue::Unknown(span)
  }
}

fn worker_constructor(args: Vec<JsValue>, span: Span) -> JsValue {
  if let Some(dep) = match_url_dep(&args) {
    let mut source_type = SourceType::Script;
    if let Some(JsValue::Object(obj)) = args.get(1) {
      if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), DUMMY_SP) {
        if ty == "module" {
          source_type = SourceType::Module;
        }
      }
    }

    JsValue::Object(Rc::new(DepObject(DependencyDescriptor {
      kind: DependencyKind::WebWorker,
      loc: SourceLocation {
        start_line: 0,
        start_col: 0,
        end_line: 0,
        end_col: 0,
      },
      specifier: dep.specifier.clone(),
      flags: DependencyFlags::empty(),
      source_type: Some(source_type),
      placeholder: None,
    })))
  } else {
    JsValue::Unknown(span)
  }
}

fn shared_worker_constructor(args: Vec<JsValue>, span: Span) -> JsValue {
  if let Some(dep) = match_url_dep(&args) {
    let mut source_type = SourceType::Script;
    if let Some(JsValue::Object(obj)) = args.get(1) {
      if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), DUMMY_SP) {
        if ty == "module" {
          source_type = SourceType::Module;
        }
      }
    }

    JsValue::Object(Rc::new(DepObject(DependencyDescriptor {
      kind: DependencyKind::WebWorker,
      loc: SourceLocation {
        start_line: 0,
        start_col: 0,
        end_line: 0,
        end_col: 0,
      },
      specifier: dep.specifier.clone(),
      flags: DependencyFlags::empty(),
      source_type: Some(source_type),
      placeholder: None,
    })))
  } else {
    JsValue::Unknown(span)
  }
}

struct DepObject(DependencyDescriptor);

impl Object for DepObject {
  fn get(&self, _prop: &parcel_evaluator::JsValue, span: Span) -> parcel_evaluator::JsValue {
    JsValue::Unknown(span)
  }

  fn has(&self, _prop: &parcel_evaluator::JsValue) -> bool {
    false
  }

  fn iter<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, parcel_evaluator::JsValue)> + 'a> {
    Box::new(std::iter::empty())
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    Ok(Expr::Call(CallExpr {
      callee: Callee::Expr(Box::new(Expr::Ident(Ident::new_private(
        "__parcel_dep__".into(),
        DUMMY_SP,
      )))),
      ..Default::default()
    }))
  }
}

// impl<'a> DependencyCollector<'a> {
//   fn fold_new_promise(&mut self, node: ast::NewExpr) -> ast::NewExpr {
//     use ast::Expr::*;

//     // Match requires inside promises (e.g. Rollup compiled dynamic imports)
//     // new Promise(resolve => resolve(require('foo')))
//     // new Promise(resolve => { resolve(require('foo')) })
//     // new Promise(function (resolve) { resolve(require('foo')) })
//     // new Promise(function (resolve) { return resolve(require('foo')) })
//     if let Some(args) = &node.args {
//       if let Some(arg) = args.first() {
//         let (resolve, expr) = match &*arg.expr {
//           Fn(f) => {
//             let param = f.function.params.first().map(|param| &param.pat);
//             let body = if let Some(body) = &f.function.body {
//               self.match_block_stmt_expr(body)
//             } else {
//               None
//             };
//             (param, body)
//           }
//           Arrow(f) => {
//             let param = f.params.first();
//             let body = match &*f.body {
//               ast::BlockStmtOrExpr::Expr(expr) => Some(&**expr),
//               ast::BlockStmtOrExpr::BlockStmt(block) => self.match_block_stmt_expr(block),
//             };
//             (param, body)
//           }
//           _ => (None, None),
//         };

//         let resolve_id = match resolve {
//           Some(ast::Pat::Ident(id)) => id.to_id(),
//           _ => return node.fold_children_with(self),
//         };

//         if let Some(ast::Expr::Call(call)) = expr {
//           if let ast::Callee::Expr(callee) = &call.callee {
//             if let ast::Expr::Ident(id) = &**callee {
//               if id.to_id() == resolve_id {
//                 if let Some(arg) = call.args.first() {
//                   if match_require(&arg.expr, self.unresolved_mark, Mark::fresh(Mark::root()))
//                     .is_some()
//                   {
//                     let was_in_promise = self.in_promise;
//                     self.in_promise = true;
//                     let node = node.fold_children_with(self);
//                     self.in_promise = was_in_promise;
//                     return node;
//                   }
//                 }
//               }
//             }
//           }
//         }
//       }
//     }

//     node.fold_children_with(self)
//   }

//   fn match_block_stmt_expr<'x>(&self, block: &'x ast::BlockStmt) -> Option<&'x ast::Expr> {
//     match block.stmts.last() {
//       Some(ast::Stmt::Expr(ast::ExprStmt { expr, .. })) => Some(&**expr),
//       Some(ast::Stmt::Return(ast::ReturnStmt { arg, .. })) => {
//         if let Some(arg) = arg {
//           Some(&**arg)
//         } else {
//           None
//         }
//       }
//       _ => None,
//     }
//   }
// }

// If the `require` call is not immediately returned (e.g. wrapped in another function),
// then transform the AST to create a promise chain so that the require is by itself.
// This is because the require will return a promise rather than the module synchronously.
// For example, TypeScript generates the following with the esModuleInterop flag:
//   Promise.resolve().then(() => __importStar(require('./foo')));
// This is transformed into:
//   Promise.resolve().then(() => require('./foo')).then(res => __importStar(res));
fn build_promise_chain(node: ast::CallExpr, require_node: ast::CallExpr) -> ast::CallExpr {
  let mut transformer = PromiseTransformer {
    require_node: Some(require_node),
  };

  let node = node.fold_with(&mut transformer);

  if let Some(require_node) = &transformer.require_node {
    if let Some(f) = node.args.first() {
      // Add `res` as an argument to the original function
      let f = match &*f.expr {
        ast::Expr::Fn(f) => {
          let mut f = f.clone();
          f.function.params.insert(
            0,
            ast::Param {
              pat: ast::Pat::Ident(ast::BindingIdent::from(ast::Ident::new_no_ctxt(
                "res".into(),
                DUMMY_SP,
              ))),
              decorators: vec![],
              span: DUMMY_SP,
            },
          );
          ast::Expr::Fn(f)
        }
        ast::Expr::Arrow(f) => {
          let mut f = f.clone();
          f.params.insert(
            0,
            ast::Pat::Ident(ast::BindingIdent::from(ast::Ident::new_no_ctxt(
              "res".into(),
              DUMMY_SP,
            ))),
          );
          ast::Expr::Arrow(f)
        }
        _ => return node,
      };

      return ast::CallExpr {
        callee: ast::Callee::Expr(Box::new(ast::Expr::Member(ast::MemberExpr {
          span: DUMMY_SP,
          obj: (Box::new(ast::Expr::Call(ast::CallExpr {
            callee: node.callee,
            args: vec![ast::ExprOrSpread {
              expr: Box::new(ast::Expr::Fn(ast::FnExpr {
                ident: None,
                function: Box::new(ast::Function {
                  body: Some(ast::BlockStmt {
                    span: DUMMY_SP,
                    stmts: vec![ast::Stmt::Return(ast::ReturnStmt {
                      span: DUMMY_SP,
                      arg: Some(Box::new(ast::Expr::Call(require_node.clone()))),
                    })],
                    ctxt: SyntaxContext::empty(),
                  }),
                  params: vec![],
                  decorators: vec![],
                  is_async: false,
                  is_generator: false,
                  return_type: None,
                  type_params: None,
                  span: DUMMY_SP,
                  ctxt: SyntaxContext::empty(),
                }),
              })),
              spread: None,
            }],
            span: DUMMY_SP,
            ctxt: SyntaxContext::empty(),
            type_args: None,
          }))),
          prop: MemberProp::Ident(ast::IdentName::new("then".into(), DUMMY_SP)),
        }))),
        args: vec![ast::ExprOrSpread {
          expr: Box::new(f),
          spread: None,
        }],
        span: DUMMY_SP,
        ctxt: SyntaxContext::empty(),
        type_args: None,
      };
    }
  }

  node
}

fn create_url_constructor(url: ast::Expr, use_import_meta: bool) -> ast::Expr {
  use ast::*;

  let expr = if use_import_meta {
    Expr::Member(MemberExpr {
      span: DUMMY_SP,
      obj: Box::new(Expr::MetaProp(MetaPropExpr {
        kind: MetaPropKind::ImportMeta,
        span: DUMMY_SP,
      })),
      prop: MemberProp::Ident(IdentName::new("url".into(), DUMMY_SP)),
    })
  } else {
    // CJS output: "file:" + __filename
    Expr::Bin(BinExpr {
      span: DUMMY_SP,
      left: Box::new(Expr::Lit(Lit::Str("file:".into()))),
      op: BinaryOp::Add,
      right: Box::new(Expr::Ident(Ident::new_no_ctxt(
        "__filename".into(),
        DUMMY_SP,
      ))),
    })
  };

  Expr::New(NewExpr {
    span: DUMMY_SP,
    ctxt: SyntaxContext::empty(),
    callee: Box::new(Expr::Ident(Ident::new_no_ctxt("URL".into(), DUMMY_SP))),
    args: Some(vec![
      ExprOrSpread {
        expr: Box::new(url),
        spread: None,
      },
      ExprOrSpread {
        expr: Box::new(expr),
        spread: None,
      },
    ]),
    type_args: None,
  })
}

struct PromiseTransformer {
  require_node: Option<ast::CallExpr>,
}

impl Fold for PromiseTransformer {
  fn fold_return_stmt(&mut self, node: ast::ReturnStmt) -> ast::ReturnStmt {
    // If the require node is returned, no need to do any replacement.
    if let Some(arg) = &node.arg {
      if let ast::Expr::Call(call) = &**arg {
        if let Some(require_node) = &self.require_node {
          if require_node == call {
            self.require_node = None
          }
        }
      }
    }

    node.fold_children_with(self)
  }

  fn fold_arrow_expr(&mut self, node: ast::ArrowExpr) -> ast::ArrowExpr {
    if let ast::BlockStmtOrExpr::Expr(expr) = &*node.body {
      if let ast::Expr::Call(call) = &**expr {
        if let Some(require_node) = &self.require_node {
          if require_node == call {
            self.require_node = None
          }
        }
      }
    }

    node.fold_children_with(self)
  }

  fn fold_expr(&mut self, node: ast::Expr) -> ast::Expr {
    let node = node.fold_children_with(self);

    // Replace the original require node with a reference to a variable `res`,
    // which will be added as a parameter to the parent function.
    if let ast::Expr::Call(call) = &node {
      if let Some(require_node) = &self.require_node {
        if require_node == call {
          return ast::Expr::Ident(ast::Ident::new_no_ctxt("res".into(), DUMMY_SP));
        }
      }
    }

    node
  }
}

#[cfg(test)]
mod test {
  use super::DependencyDescriptor;
  use super::*;
  use crate::test_utils::{RunTestContext, RunVisitResult, run_visit};

  fn make_dependency_collector<'a>(
    context: RunTestContext,
    items: &'a mut Vec<DependencyDescriptor>,
    diagnostics: &'a mut Vec<Diagnostic>,
    config: &'a Config,
  ) -> DependencyCollector<'a> {
    DependencyCollector::new(
      context.source_map.clone(),
      items,
      Mark::new(),
      context.unresolved_mark,
      config,
      diagnostics,
    )
  }

  fn make_config() -> Config {
    Config::default()
  }

  fn make_placeholder_hash(specifier: &str, dependency_kind: DependencyKind) -> String {
    format!(
      "{:x}",
      hash!(format!("{}:{}:{}", "", specifier, dependency_kind))
    )
  }

  #[test]
  fn test_dynamic_import_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = Config::default();
    let input_code = r#"
      const { x } = await import('other');
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
      const {{ x }} = await require("{}");
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_import_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = Config::default();
    let input_code = r#"
      import { x } from 'other';
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let expected_code = r#"
      import { x } from 'other';
    "#
    .trim_start()
    .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Import,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: None,
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_export_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = Config::default();
    let input_code = r#"
      export { x } from 'other';
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let expected_code = r#"
      export { x } from 'other';
    "#
    .trim_start()
    .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Export,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: None,
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_export_star_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = Config::default();
    let input_code = r#"
      export * from 'other';
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let expected_code = r#"
      export * from 'other';
    "#
    .trim_start()
    .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Export,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: None,
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_require_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
      const { x } = require('other');
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::Require);
    let expected_code = format!(
      r#"
      const {{ x }} = require("{}");
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Require,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_optional_require_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
try {
    const { x } = require('other');
} catch (err) {}
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::Require);
    let expected_code = format!(
      r#"
try {{
    const {{ x }} = require("{}");
}} catch (err) {{}}
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Require,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::OPTIONAL,
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_compiled_dynamic_imports() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
Promise.resolve().then(() => require('other'));
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
Promise.resolve().then(()=>require("{}"));
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_compiled_dynamic_imports_with_chain() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
Promise.resolve().then(() => doSomething(require('other')));
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
Promise.resolve().then(function() {{
    return require("{}");
}}).then((res)=>doSomething(res));
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_compiled_dynamic_imports_with_function_chain() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
Promise.resolve().then(function() { return doSomething(require('other')); });
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
Promise.resolve().then(function() {{
    return require("{}");
}}).then(function(res) {{
    return doSomething(res);
}});
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_new_promise_require_imports() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
new Promise((resolve) => resolve(require("other")));
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
new Promise((resolve)=>resolve(require("{}")));
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_new_promise_require_imports_with_function_expr() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
new Promise(function(resolve) { return resolve(require("other")) });
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
new Promise(function(resolve) {{
    return resolve(require("{}"));
}});
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_promise_resolve_require_dynamic_import() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
Promise.resolve(require("other"));
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
Promise.resolve(require("{}"));
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_worker_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
      new Worker(new URL('other', import.meta.url), {type: 'module'});
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::WebWorker);
    let expected_code = format!(
      r#"
      new Worker(require("{}"));
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::WebWorker,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_service_worker_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
      navigator.serviceWorker.register(new URL('other', import.meta.url), {type: 'module'});
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::ServiceWorker);
    let expected_code = format!(
      r#"
      navigator.serviceWorker.register(require("{}"));
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::ServiceWorker,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_worklet_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
      CSS.paintWorklet.addModule(new URL('other', import.meta.url));
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::Worklet);
    let expected_code = format!(
      r#"
      CSS.paintWorklet.addModule(require("{}"));
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Worklet,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_url_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
let img = document.createElement('img');
img.src = new URL('hero.jpg', import.meta.url);
document.body.appendChild(img);
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("hero.jpg", DependencyKind::Url);
    let expected_code = format!(
      r#"
let img = document.createElement('img');
img.src = new URL(require("{}"));
document.body.appendChild(img);
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Url,
        specifier: "hero.jpg".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }
}
