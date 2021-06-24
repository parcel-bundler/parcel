use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::{Deserialize, Serialize};
use swc_atoms::JsWord;
use swc_common::{SourceMap, SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast;
use swc_ecmascript::visit::{Fold, FoldWith};

use crate::utils::*;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum DependencyKind {
  Import,
  Export,
  DynamicImport,
  Require,
  WebWorker,
  ServiceWorker,
  Worklet,
  ImportScripts,
  URL,
  File,
}

impl fmt::Display for DependencyKind {
  fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
    write!(f, "{:?}", self)
  }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DependencyDescriptor {
  pub kind: DependencyKind,
  pub loc: SourceLocation,
  /// The text specifier associated with the import/export statement.
  pub specifier: swc_atoms::JsWord,
  pub attributes: Option<HashMap<swc_atoms::JsWord, bool>>,
  pub is_optional: bool,
  pub is_helper: bool,
  pub source_type: Option<SourceType>,
}

/// This pass collects dependencies in a module and compiles references as needed to work with Parcel's JSRuntime.
pub fn dependency_collector<'a>(
  source_map: &'a SourceMap,
  items: &'a mut Vec<DependencyDescriptor>,
  decls: &'a HashSet<(JsWord, SyntaxContext)>,
  ignore_mark: swc_common::Mark,
  scope_hoist: bool,
  source_type: SourceType,
  supports_module_workers: bool,
  script_error_loc: &'a mut Option<SourceLocation>,
) -> impl Fold + 'a {
  DependencyCollector {
    source_map,
    items,
    in_try: false,
    in_promise: false,
    require_node: None,
    decls,
    ignore_mark,
    scope_hoist,
    source_type,
    supports_module_workers,
    script_error_loc,
  }
}

struct DependencyCollector<'a> {
  source_map: &'a SourceMap,
  items: &'a mut Vec<DependencyDescriptor>,
  in_try: bool,
  in_promise: bool,
  require_node: Option<ast::CallExpr>,
  decls: &'a HashSet<(JsWord, SyntaxContext)>,
  ignore_mark: swc_common::Mark,
  scope_hoist: bool,
  source_type: SourceType,
  supports_module_workers: bool,
  script_error_loc: &'a mut Option<SourceLocation>,
}

impl<'a> DependencyCollector<'a> {
  fn add_dependency(
    &mut self,
    specifier: JsWord,
    span: swc_common::Span,
    kind: DependencyKind,
    attributes: Option<HashMap<swc_atoms::JsWord, bool>>,
    is_optional: bool,
    source_type: SourceType,
  ) {
    self.items.push(DependencyDescriptor {
      kind,
      loc: SourceLocation::from(self.source_map, span),
      specifier,
      attributes,
      is_optional,
      is_helper: span.is_dummy(),
      source_type: Some(source_type),
    });
  }

  fn create_require(&mut self, specifier: JsWord) -> ast::CallExpr {
    let mut res = create_require(specifier);

    // For scripts, we replace with __parcel__require__, which is later replaced
    // by a real parcelRequire of the resolved asset in the packager.
    if self.source_type == SourceType::Script {
      res.callee = ast::ExprOrSuper::Expr(Box::new(ast::Expr::Ident(ast::Ident::new(
        "__parcel__require__".into(),
        DUMMY_SP,
      ))));
    }
    res
  }
}

impl<'a> Fold for DependencyCollector<'a> {
  fn fold_module_decl(&mut self, node: ast::ModuleDecl) -> ast::ModuleDecl {
    // If an import or export is seen within a script, flag it to throw an error from JS.
    if self.source_type == SourceType::Script && self.script_error_loc.is_none() {
      match node {
        ast::ModuleDecl::Import(ast::ImportDecl { span, .. })
        | ast::ModuleDecl::ExportAll(ast::ExportAll { span, .. })
        | ast::ModuleDecl::ExportDecl(ast::ExportDecl { span, .. })
        | ast::ModuleDecl::ExportDefaultDecl(ast::ExportDefaultDecl { span, .. })
        | ast::ModuleDecl::ExportDefaultExpr(ast::ExportDefaultExpr { span, .. })
        | ast::ModuleDecl::ExportNamed(ast::NamedExport { span, .. }) => {
          *self.script_error_loc = Some(SourceLocation::from(self.source_map, span));
        }
        _ => {}
      }
      return node;
    }

    node.fold_children_with(self)
  }

  fn fold_import_decl(&mut self, node: ast::ImportDecl) -> ast::ImportDecl {
    if node.type_only {
      return node;
    }

    self.add_dependency(
      node.src.value.clone(),
      node.src.span,
      DependencyKind::Import,
      None,
      false,
      self.source_type,
    );

    return node;
  }

  fn fold_named_export(&mut self, node: ast::NamedExport) -> ast::NamedExport {
    if let Some(src) = &node.src {
      if node.type_only {
        return node;
      }

      self.add_dependency(
        src.value.clone(),
        src.span,
        DependencyKind::Export,
        None,
        false,
        self.source_type,
      );
    }

    return node;
  }

  fn fold_export_all(&mut self, node: ast::ExportAll) -> ast::ExportAll {
    self.add_dependency(
      node.src.value.clone(),
      node.src.span,
      DependencyKind::Export,
      None,
      false,
      self.source_type,
    );

    return node;
  }

  fn fold_try_stmt(&mut self, node: ast::TryStmt) -> ast::TryStmt {
    // Track if we're inside a try block to mark dependencies as optional.
    self.in_try = true;
    let block = node.block.fold_with(self);
    self.in_try = false;

    let handler = match node.handler {
      Some(handler) => Some(handler.fold_with(self)),
      None => None,
    };

    let finalizer = match node.finalizer {
      Some(finalizer) => Some(finalizer.fold_with(self)),
      None => None,
    };

    ast::TryStmt {
      span: node.span,
      block,
      handler,
      finalizer,
    }
  }

  fn fold_call_expr(&mut self, node: ast::CallExpr) -> ast::CallExpr {
    use ast::{Expr::*, ExprOrSuper::*, Ident};

    let call_expr = match node.callee.clone() {
      Super(_) => return node,
      Expr(boxed) => boxed,
    };

    let kind = match &*call_expr {
      Ident(ident) => {
        // Bail if defined in scope
        if self.decls.contains(&(ident.sym.clone(), ident.span.ctxt())) {
          return node.fold_children_with(self);
        }

        match ident.sym.to_string().as_str() {
          "import" => DependencyKind::DynamicImport,
          "require" => {
            if self.in_promise {
              DependencyKind::DynamicImport
            } else {
              DependencyKind::Require
            }
          }
          "importScripts" => DependencyKind::ImportScripts,
          "__parcel__require__" => {
            let mut call = node.clone().fold_children_with(self);
            call.callee = ast::ExprOrSuper::Expr(Box::new(ast::Expr::Ident(ast::Ident::new(
              "require".into(),
              DUMMY_SP.apply_mark(self.ignore_mark),
            ))));
            return call;
          }
          "__parcel__import__" => {
            let mut call = node.clone().fold_children_with(self);
            call.callee = ast::ExprOrSuper::Expr(Box::new(ast::Expr::Ident(ast::Ident::new(
              "import".into(),
              DUMMY_SP.apply_mark(self.ignore_mark),
            ))));
            return call;
          }
          _ => return node.fold_children_with(self),
        }
      }
      Member(member) => {
        if match_member_expr(
          member,
          vec!["navigator", "serviceWorker", "register"],
          self.decls,
        ) {
          DependencyKind::ServiceWorker
        } else if match_member_expr(member, vec!["CSS", "paintWorklet", "addModule"], self.decls) {
          DependencyKind::Worklet
        } else {
          let was_in_promise = self.in_promise;

          // Match compiled dynamic imports (Parcel)
          // Promise.resolve(require('foo'))
          if match_member_expr(member, vec!["Promise", "resolve"], self.decls) {
            self.in_promise = true;
            let node = node.fold_children_with(self);
            self.in_promise = was_in_promise;
            return node;
          }

          // Match compiled dynamic imports (TypeScript)
          // Promise.resolve().then(() => require('foo'))
          // Promise.resolve().then(() => { return require('foo') })
          // Promise.resolve().then(function () { return require('foo') })
          if let Expr(ref expr) = member.obj {
            if let Call(call) = &**expr {
              if let Expr(e) = &call.callee {
                if let Member(m) = &**e {
                  if match_member_expr(m, vec!["Promise", "resolve"], self.decls) {
                    if let Ident(id) = &*member.prop {
                      if id.sym.to_string().as_str() == "then" {
                        if let Some(arg) = node.args.get(0) {
                          match &*arg.expr {
                            Fn(_) | Arrow(_) => {
                              self.in_promise = true;
                              let node = swc_ecmascript::visit::fold_call_expr(self, node.clone());
                              self.in_promise = was_in_promise;

                              // Transform Promise.resolve().then(() => __importStar(require('foo')))
                              //   => Promise.resolve().then(() => require('foo')).then(res => __importStar(res))
                              if let Some(require_node) = self.require_node.clone() {
                                self.require_node = None;
                                return build_promise_chain(node.clone(), require_node);
                              }
                            }
                            _ => {}
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          return node.fold_children_with(self);
        }
      }
      _ => return node.fold_children_with(self),
    };

    // Convert import attributes for dynamic import
    let mut attributes = None;
    if kind == DependencyKind::DynamicImport {
      if let Some(arg) = node.args.get(1) {
        if let Object(arg) = &*arg.expr {
          let mut attrs = HashMap::new();
          for key in &arg.props {
            let prop = match key {
              ast::PropOrSpread::Prop(prop) => prop,
              _ => continue,
            };

            let kv = match &**prop {
              ast::Prop::KeyValue(kv) => kv,
              _ => continue,
            };

            let k = match &kv.key {
              ast::PropName::Ident(Ident { sym, .. })
              | ast::PropName::Str(ast::Str { value: sym, .. }) => sym.clone(),
              _ => continue,
            };

            let v = match &*kv.value {
              Lit(ast::Lit::Bool(ast::Bool { value, .. })) => *value,
              _ => continue,
            };

            attrs.insert(k, v);
          }

          attributes = Some(attrs);
        }
      }
    } else if kind == DependencyKind::ImportScripts {
      // importScripts() accepts multiple arguments. Add dependencies for each
      // and replace with require calls for each of the specifiers (which will
      // return the resolved URL at runtime).
      let mut node = node.clone();
      node.args = node
        .args
        .iter()
        .map(|arg| {
          if let Lit(lit) = &*arg.expr {
            if let ast::Lit::Str(str_) = lit {
              self.add_dependency(
                str_.value.clone(),
                str_.span,
                kind.clone(),
                None,
                false,
                SourceType::Script,
              );

              return ast::ExprOrSpread {
                spread: None,
                expr: Box::new(Call(self.create_require(str_.value.clone()))),
              };
            }
          }

          return arg.clone();
        })
        .collect();

      return node;
    }

    if let Some(arg) = node.args.get(0) {
      if kind == DependencyKind::ServiceWorker || kind == DependencyKind::Worklet {
        let (source_type, opts) = if kind == DependencyKind::ServiceWorker {
          match_worker_type(node.args.get(1))
        } else {
          // Worklets are always modules
          (SourceType::Module, None)
        };
        let mut node = node.clone();

        let (specifier, span) = if let Some(s) = match_import_meta_url(&*arg.expr, self.decls) {
          s
        } else if let Lit(lit) = &*arg.expr {
          if let ast::Lit::Str(str_) = lit {
            (str_.value.clone(), str_.span)
          } else {
            return node;
          }
        } else {
          return node;
        };

        self.add_dependency(
          specifier.clone(),
          span,
          kind.clone(),
          attributes,
          false,
          source_type,
        );

        node.args[0].expr = Box::new(Call(self.create_require(specifier)));
        match opts {
          Some(opts) => {
            node.args[1] = opts;
          }
          None => {
            node.args.truncate(1);
          }
        }
        return node;
      }

      if let Lit(lit) = &*arg.expr {
        if let ast::Lit::Str(str_) = lit {
          // require() calls aren't allowed in scripts, flag as an error.
          if kind == DependencyKind::Require
            && self.source_type == SourceType::Script
            && self.script_error_loc.is_none()
          {
            *self.script_error_loc = Some(SourceLocation::from(self.source_map, node.span));
            return node;
          }

          self.add_dependency(
            str_.value.clone(),
            str_.span,
            kind.clone(),
            attributes,
            kind == DependencyKind::Require && self.in_try,
            self.source_type,
          );
        }
      }
    }

    // Replace import() with require()
    if kind == DependencyKind::DynamicImport {
      let mut call = node.clone();
      if !self.scope_hoist {
        let name = match &self.source_type {
          SourceType::Module => "require",
          SourceType::Script => "__parcel__require__",
        };
        call.callee = ast::ExprOrSuper::Expr(Box::new(ast::Expr::Ident(ast::Ident::new(
          name.into(),
          DUMMY_SP,
        ))));
      }

      // Drop import attributes
      call.args.truncate(1);

      // Track the returned require call to be replaced with a promise chain.
      self.require_node = Some(call.clone());
      call
    } else if kind == DependencyKind::Require {
      // Don't continue traversing so that the `require` isn't replaced with undefined
      node
    } else {
      node.fold_children_with(self)
    }
  }

  fn fold_unary_expr(&mut self, node: ast::UnaryExpr) -> ast::UnaryExpr {
    // Don't traverse `typeof require` further to not replace `require` with undefined
    if let ast::UnaryExpr {
      op: ast::UnaryOp::TypeOf,
      arg,
      ..
    } = &node
    {
      if let ast::Expr::Ident(ast::Ident { sym, .. }) = &**arg {
        if sym == &js_word!("require") && !self.decls.contains(&(sym.clone(), node.span.ctxt())) {
          return node;
        }
      }
    }

    node.fold_children_with(self)
  }

  fn fold_new_expr(&mut self, node: ast::NewExpr) -> ast::NewExpr {
    use ast::Expr::*;

    let matched = match &*node.callee {
      Ident(id) => {
        match id.sym {
          js_word!("Worker") | js_word!("SharedWorker") => {
            // Bail if defined in scope
            !self.decls.contains(&(id.sym.clone(), id.span.ctxt()))
          }
          js_word!("Promise") => {
            // Match requires inside promises (e.g. Rollup compiled dynamic imports)
            // new Promise(resolve => resolve(require('foo')))
            // new Promise(resolve => { resolve(require('foo')) })
            // new Promise(function (resolve) { resolve(require('foo')) })
            let was_in_promise = self.in_promise;
            self.in_promise = true;
            let node = swc_ecmascript::visit::fold_new_expr(self, node);
            self.in_promise = was_in_promise;
            return node;
          }
          _ => false,
        }
      }
      _ => false,
    };

    if !matched {
      return node.fold_children_with(self);
    }

    if let Some(args) = &node.args {
      if args.len() > 0 {
        let (specifier, span) = if let Some(s) = match_import_meta_url(&*args[0].expr, self.decls) {
          s
        } else if let Lit(lit) = &*args[0].expr {
          if let ast::Lit::Str(str_) = lit {
            (str_.value.clone(), str_.span)
          } else {
            return node;
          }
        } else {
          return node;
        };

        let (source_type, opts) = match_worker_type(args.get(1));
        self.add_dependency(
          specifier.clone(),
          span,
          DependencyKind::WebWorker,
          None,
          false,
          source_type,
        );

        // Replace argument with a require call to resolve the URL at runtime.
        let mut node = node.clone();
        if let Some(mut args) = node.args.clone() {
          args[0].expr = Box::new(Call(self.create_require(specifier)));

          // If module workers aren't supported natively, remove the `type: 'module'` option.
          // If no other options are passed, remove the argument entirely.
          if !self.supports_module_workers {
            match opts {
              None => {
                args.truncate(1);
              }
              Some(opts) => {
                args[1] = opts;
              }
            }
          }
          node.args = Some(args);
        }

        return node;
      }
    }

    return node.fold_children_with(self);
  }

  fn fold_member_expr(&mut self, mut node: ast::MemberExpr) -> ast::MemberExpr {
    node.obj = node.obj.fold_children_with(self);

    // To ensure that fold_expr doesn't replace `require` in non-computed member expressions
    if node.computed {
      node.prop = node.prop.fold_children_with(self);
    }

    node
  }

  fn fold_expr(&mut self, node: ast::Expr) -> ast::Expr {
    if let Some((specifier, span)) = match_import_meta_url(&node, self.decls) {
      self.add_dependency(
        specifier.clone(),
        span,
        DependencyKind::URL,
        None,
        false,
        self.source_type,
      );
      return ast::Expr::Call(self.create_require(specifier));
    }

    if let ast::Expr::Ident(ast::Ident { sym, span, .. }) = &node {
      // Replace free usages of `require` with `undefined`
      if sym == &js_word!("require") && !self.decls.contains(&(sym.clone(), span.ctxt())) {
        return ast::Expr::Ident(ast::Ident::new("undefined".into(), DUMMY_SP));
      }
    }

    node.fold_children_with(self)
  }
}

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
    if let Some(f) = node.args.get(0) {
      // Add `res` as an argument to the original function
      let f = match &*f.expr {
        ast::Expr::Fn(f) => {
          let mut f = f.clone();
          f.function.params.insert(
            0,
            ast::Param {
              pat: ast::Pat::Ident(ast::BindingIdent::from(ast::Ident::new(
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
            ast::Pat::Ident(ast::BindingIdent::from(ast::Ident::new(
              "res".into(),
              DUMMY_SP,
            ))),
          );
          ast::Expr::Arrow(f)
        }
        _ => return node,
      };

      return ast::CallExpr {
        callee: ast::ExprOrSuper::Expr(Box::new(ast::Expr::Member(ast::MemberExpr {
          span: DUMMY_SP,
          computed: false,
          obj: ast::ExprOrSuper::Expr(Box::new(ast::Expr::Call(ast::CallExpr {
            callee: node.callee,
            args: vec![ast::ExprOrSpread {
              expr: Box::new(ast::Expr::Fn(ast::FnExpr {
                ident: None,
                function: ast::Function {
                  body: Some(ast::BlockStmt {
                    span: DUMMY_SP,
                    stmts: vec![ast::Stmt::Return(ast::ReturnStmt {
                      span: DUMMY_SP,
                      arg: Some(Box::new(ast::Expr::Call(require_node.clone()))),
                    })],
                  }),
                  params: vec![],
                  decorators: vec![],
                  is_async: false,
                  is_generator: false,
                  return_type: None,
                  type_params: None,
                  span: DUMMY_SP,
                },
              })),
              spread: None,
            }],
            span: DUMMY_SP,
            type_args: None,
          }))),
          prop: Box::new(ast::Expr::Ident(ast::Ident::new("then".into(), DUMMY_SP))),
        }))),
        args: vec![ast::ExprOrSpread {
          expr: Box::new(f),
          spread: None,
        }],
        span: DUMMY_SP,
        type_args: None,
      };
    }
  }

  return node;
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

    return swc_ecmascript::visit::fold_return_stmt(self, node);
  }

  fn fold_arrow_expr(&mut self, node: ast::ArrowExpr) -> ast::ArrowExpr {
    if let ast::BlockStmtOrExpr::Expr(expr) = &node.body {
      if let ast::Expr::Call(call) = &**expr {
        if let Some(require_node) = &self.require_node {
          if require_node == call {
            self.require_node = None
          }
        }
      }
    }

    return swc_ecmascript::visit::fold_arrow_expr(self, node);
  }

  fn fold_expr(&mut self, node: ast::Expr) -> ast::Expr {
    let node = swc_ecmascript::visit::fold_expr(self, node);

    // Replace the original require node with a reference to a variable `res`,
    // which will be added as a parameter to the parent function.
    if let ast::Expr::Call(call) = &node {
      if let Some(require_node) = &self.require_node {
        if require_node == call {
          return ast::Expr::Ident(ast::Ident::new("res".into(), DUMMY_SP));
        }
      }
    }

    return node;
  }
}

fn match_import_meta_url(
  expr: &ast::Expr,
  decls: &HashSet<(JsWord, SyntaxContext)>,
) -> Option<(JsWord, swc_common::Span)> {
  match expr {
    ast::Expr::New(new) => {
      let is_url = match &*new.callee {
        ast::Expr::Ident(id) => {
          id.sym == js_word!("URL") && !decls.contains(&(id.sym.clone(), id.span.ctxt()))
        }
        _ => false,
      };

      if !is_url {
        return None;
      }

      if let Some(args) = &new.args {
        let specifier = if let Some(arg) = args.get(0) {
          match &*arg.expr {
            ast::Expr::Lit(ast::Lit::Str(s)) => s,
            _ => return None,
          }
        } else {
          return None;
        };

        if let Some(arg) = args.get(1) {
          match &*arg.expr {
            ast::Expr::Member(member) => {
              match &member.obj {
                ast::ExprOrSuper::Expr(expr) => match &**expr {
                  ast::Expr::MetaProp(ast::MetaPropExpr {
                    meta:
                      ast::Ident {
                        sym: js_word!("import"),
                        ..
                      },
                    prop:
                      ast::Ident {
                        sym: js_word!("meta"),
                        ..
                      },
                  }) => {}
                  _ => return None,
                },
                _ => return None,
              }

              let is_url = match &*member.prop {
                ast::Expr::Ident(id) => id.sym == js_word!("url") && !member.computed,
                ast::Expr::Lit(ast::Lit::Str(str)) => str.value == js_word!("url"),
                _ => false,
              };

              if !is_url {
                return None;
              }

              return Some((specifier.value.clone(), specifier.span));
            }
            _ => return None,
          }
        }
      }
    }
    _ => {}
  }

  None
}

// matches the `type: 'module'` option of workers
fn match_worker_type(expr: Option<&ast::ExprOrSpread>) -> (SourceType, Option<ast::ExprOrSpread>) {
  use ast::*;

  if let Some(expr_or_spread) = expr {
    if let Expr::Object(obj) = &*expr_or_spread.expr {
      let mut source_type: Option<SourceType> = None;
      let props: Vec<PropOrSpread> = obj
        .props
        .iter()
        .filter(|key| {
          let prop = match key {
            PropOrSpread::Prop(prop) => prop,
            _ => return true,
          };

          let kv = match &**prop {
            Prop::KeyValue(kv) => kv,
            _ => return true,
          };

          match &kv.key {
            PropName::Ident(Ident {
              sym: js_word!("type"),
              ..
            })
            | PropName::Str(Str {
              value: js_word!("type"),
              ..
            }) => {}
            _ => return true,
          };

          let v = match &*kv.value {
            Expr::Lit(Lit::Str(Str { value, .. })) => value,
            _ => return true,
          };

          source_type = Some(match *v {
            js_word!("module") => SourceType::Module,
            _ => SourceType::Script,
          });

          return false;
        })
        .cloned()
        .collect();

      if let Some(source_type) = source_type {
        let e = if props.len() == 0 {
          None
        } else {
          Some(ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Object(ObjectLit {
              props,
              span: obj.span,
            })),
          })
        };

        return (source_type, e);
      }
    }
  }

  let expr = match expr {
    None => None,
    Some(e) => Some(e.clone()),
  };

  (SourceType::Script, expr)
}
