use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::{Deserialize, Serialize};
use swc_atoms::JsWord;
use swc_common::{Mark, SourceMap, Span, SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast;
use swc_ecmascript::utils::ident::IdentLike;
use swc_ecmascript::visit::{Fold, FoldWith};

use crate::utils::*;
use crate::Config;

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
macro_rules! hash {
  ($str:expr) => {{
    let mut hasher = DefaultHasher::new();
    $str.hash(&mut hasher);
    hasher.finish()
  }};
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum DependencyKind {
  Import,
  Export,
  DynamicImport,
  Require,
  WebWorker,
  ServiceWorker,
  Worklet,
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
  pub placeholder: Option<String>,
}

/// This pass collects dependencies in a module and compiles references as needed to work with Parcel's JSRuntime.
pub fn dependency_collector<'a>(
  source_map: &'a SourceMap,
  items: &'a mut Vec<DependencyDescriptor>,
  decls: &'a HashSet<(JsWord, SyntaxContext)>,
  ignore_mark: swc_common::Mark,
  config: &'a Config,
  diagnostics: &'a mut Vec<Diagnostic>,
) -> impl Fold + 'a {
  DependencyCollector {
    source_map,
    items,
    in_try: false,
    in_promise: false,
    require_node: None,
    decls,
    ignore_mark,
    config,
    diagnostics,
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
  config: &'a Config,
  diagnostics: &'a mut Vec<Diagnostic>,
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
  ) -> Option<JsWord> {
    // For normal imports/requires, the specifier will remain unchanged.
    // For other types of dependencies, the specifier will be changed to a hash
    // that also contains the dependency kind. This way, multiple kinds of dependencies
    // to the same specifier can be used within the same file.
    let placeholder = match kind {
      DependencyKind::Import | DependencyKind::Export | DependencyKind::Require => None,
      _ => Some(format!(
        "{:x}",
        hash!(format!("{}:{}:{}", self.config.filename, specifier, kind))
      )),
    };

    self.items.push(DependencyDescriptor {
      kind,
      loc: SourceLocation::from(self.source_map, span),
      specifier,
      attributes,
      is_optional,
      is_helper: span.is_dummy(),
      source_type: Some(source_type),
      placeholder: placeholder.clone(),
    });

    placeholder.map(|p| p.into())
  }

  fn add_url_dependency(
    &mut self,
    specifier: JsWord,
    span: swc_common::Span,
    kind: DependencyKind,
    source_type: SourceType,
  ) -> ast::Expr {
    // If not a library, replace with a require call pointing to a runtime that will resolve the url dynamically.
    if !self.config.is_library {
      let placeholder =
        self.add_dependency(specifier.clone(), span, kind, None, false, source_type);
      let specifier = if let Some(placeholder) = placeholder {
        placeholder
      } else {
        specifier
      };
      return ast::Expr::Call(self.create_require(specifier));
    }

    // For library builds, we need to create something that can be statically analyzed by another bundler,
    // so rather than replacing with a require call that is resolved by a runtime, replace with a `new URL`
    // call with a placeholder for the relative path to be replaced during packaging.
    let placeholder = format!(
      "{:x}",
      hash!(format!(
        "parcel_url:{}:{}:{}",
        self.config.filename, specifier, kind
      ))
    );
    self.items.push(DependencyDescriptor {
      kind,
      loc: SourceLocation::from(self.source_map, span),
      specifier,
      attributes: None,
      is_optional: false,
      is_helper: span.is_dummy(),
      source_type: Some(source_type),
      placeholder: Some(placeholder.clone()),
    });

    create_url_constructor(
      ast::Expr::Lit(ast::Lit::Str(ast::Str {
        span,
        value: placeholder.into(),
        kind: ast::StrKind::Synthesized,
        has_escape: false,
      })),
      self.config.is_esm_output,
    )
  }

  fn create_require(&mut self, specifier: JsWord) -> ast::CallExpr {
    let mut res = create_require(specifier);

    // For scripts, we replace with __parcel__require__, which is later replaced
    // by a real parcelRequire of the resolved asset in the packager.
    if self.config.source_type == SourceType::Script {
      res.callee = ast::ExprOrSuper::Expr(Box::new(ast::Expr::Ident(ast::Ident::new(
        "__parcel__require__".into(),
        DUMMY_SP,
      ))));
    }
    res
  }

  fn add_script_error(&mut self, span: Span) {
    // Only add the diagnostic for imports/exports in scripts once.
    if self.diagnostics.iter().any(|d| d.message == "SCRIPT_ERROR") {
      return;
    }

    self.diagnostics.push(Diagnostic {
      message: "SCRIPT_ERROR".to_string(),
      code_highlights: Some(vec![CodeHighlight {
        message: None,
        loc: SourceLocation::from(self.source_map, span),
      }]),
      hints: None,
      show_environment: true,
    });
  }
}

fn rewrite_require_specifier(node: ast::CallExpr) -> ast::CallExpr {
  if let Some(arg) = node.args.get(0) {
    if let ast::Expr::Lit(lit) = &*arg.expr {
      if let ast::Lit::Str(str_) = lit {
        if str_.value.starts_with("node:") {
          // create_require will take care of replacing the node: prefix...
          return create_require(str_.value.clone());
        }
      }
    }
  }
  node
}

impl<'a> Fold for DependencyCollector<'a> {
  fn fold_module_decl(&mut self, node: ast::ModuleDecl) -> ast::ModuleDecl {
    // If an import or export is seen within a script, flag it to throw an error from JS.
    if self.config.source_type == SourceType::Script {
      match node {
        ast::ModuleDecl::Import(ast::ImportDecl { span, .. })
        | ast::ModuleDecl::ExportAll(ast::ExportAll { span, .. })
        | ast::ModuleDecl::ExportDecl(ast::ExportDecl { span, .. })
        | ast::ModuleDecl::ExportDefaultDecl(ast::ExportDefaultDecl { span, .. })
        | ast::ModuleDecl::ExportDefaultExpr(ast::ExportDefaultExpr { span, .. })
        | ast::ModuleDecl::ExportNamed(ast::NamedExport { span, .. }) => {
          self.add_script_error(span)
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
      self.config.source_type,
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
        self.config.source_type,
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
      self.config.source_type,
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
        if self.decls.contains(&ident.to_id()) {
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
          "importScripts" => {
            if self.config.is_worker {
              let msg = if self.config.source_type == SourceType::Script {
                // Ignore if argument is not a string literal.
                if let Some(ast::ExprOrSpread { expr, .. }) = node.args.get(0) {
                  match &**expr {
                    Lit(ast::Lit::Str(_)) => {}
                    _ => {
                      return node.fold_children_with(self);
                    }
                  }
                }

                "importScripts() is not supported in worker scripts."
              } else {
                "importScripts() is not supported in module workers."
              };
              self.diagnostics.push(Diagnostic {
                message: msg.to_string(),
                code_highlights: Some(vec![CodeHighlight {
                  message: None,
                  loc: SourceLocation::from(self.source_map, node.span),
                }]),
                hints: Some(vec![String::from(
                  "Use a static `import`, or dynamic `import()` instead.",
                )]),
                show_environment: self.config.source_type == SourceType::Script,
              });
            }

            return node.fold_children_with(self);
          }
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
          "__parcel__importScripts__" => {
            let mut call = node.clone().fold_children_with(self);
            call.callee = ast::ExprOrSuper::Expr(Box::new(ast::Expr::Ident(ast::Ident::new(
              "importScripts".into(),
              DUMMY_SP.apply_mark(self.ignore_mark),
            ))));
            return call;
          }
          _ => return node.fold_children_with(self),
        }
      }
      Member(member) => {
        if self.config.is_browser
          && match_member_expr(
            member,
            vec!["navigator", "serviceWorker", "register"],
            self.decls,
          )
        {
          DependencyKind::ServiceWorker
        } else if self.config.is_browser
          && match_member_expr(member, vec!["CSS", "paintWorklet", "addModule"], self.decls)
        {
          DependencyKind::Worklet
        } else {
          let was_in_promise = self.in_promise;

          // Match compiled dynamic imports (Parcel)
          // Promise.resolve(require('foo'))
          if match_member_expr(member, vec!["Promise", "resolve"], self.decls) {
            if let Some(expr) = node.args.get(0) {
              if let Some(_) = match_require(&*expr.expr, self.decls, Mark::fresh(Mark::root())) {
                self.in_promise = true;
                let node = node.fold_children_with(self);
                self.in_promise = was_in_promise;
                return node;
              }
            }
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
    }

    let node = if let Some(arg) = node.args.get(0) {
      if kind == DependencyKind::ServiceWorker || kind == DependencyKind::Worklet {
        let (source_type, opts) = if kind == DependencyKind::ServiceWorker {
          match_worker_type(node.args.get(1))
        } else {
          // Worklets are always modules
          (SourceType::Module, None)
        };
        let mut node = node.clone();

        let (specifier, span) = if let Some(s) = self.match_import_meta_url(&*arg.expr, self.decls)
        {
          s
        } else if let Lit(lit) = &*arg.expr {
          if let ast::Lit::Str(str_) = lit {
            let msg = if kind == DependencyKind::ServiceWorker {
              "Registering service workers with a string literal is not supported."
            } else {
              "Registering worklets with a string literal is not supported."
            };
            self.diagnostics.push(Diagnostic {
              message: msg.to_string(),
              code_highlights: Some(vec![CodeHighlight {
                message: None,
                loc: SourceLocation::from(self.source_map, str_.span),
              }]),
              hints: Some(vec![format!(
                "Replace with: new URL('{}', import.meta.url)",
                str_.value,
              )]),
              show_environment: false,
            });
            return node;
          } else {
            return node;
          }
        } else {
          return node;
        };

        node.args[0].expr =
          Box::new(self.add_url_dependency(specifier.clone(), span, kind.clone(), source_type));

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

      if let Lit(ast::Lit::Str(str_)) = &*arg.expr {
        // require() calls aren't allowed in scripts, flag as an error.
        if kind == DependencyKind::Require && self.config.source_type == SourceType::Script {
          self.add_script_error(node.span);
          return node;
        }

        let placeholder = self.add_dependency(
          str_.value.clone(),
          str_.span,
          kind.clone(),
          attributes,
          kind == DependencyKind::Require && self.in_try,
          self.config.source_type,
        );

        if let Some(placeholder) = placeholder {
          let mut node = node.clone();
          node.args[0].expr = Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str {
            value: placeholder,
            span: str_.span,
            has_escape: false,
            kind: ast::StrKind::Synthesized,
          })));
          node
        } else {
          node
        }
      } else {
        node
      }
    } else {
      node
    };

    // Replace import() with require()
    if kind == DependencyKind::DynamicImport {
      let mut call = node.clone();
      if !self.config.scope_hoist {
        let name = match &self.config.source_type {
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
      let rewritten_call = rewrite_require_specifier(call);
      self.require_node = Some(rewritten_call.clone());
      rewritten_call
    } else if kind == DependencyKind::Require {
      // Don't continue traversing so that the `require` isn't replaced with undefined
      rewrite_require_specifier(node)
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
        match &id.sym {
          &js_word!("Worker") | &js_word!("SharedWorker") => {
            // Bail if defined in scope
            self.config.is_browser && !self.decls.contains(&id.to_id())
          }
          &js_word!("Promise") => {
            // Match requires inside promises (e.g. Rollup compiled dynamic imports)
            // new Promise(resolve => resolve(require('foo')))
            // new Promise(resolve => { resolve(require('foo')) })
            // new Promise(function (resolve) { resolve(require('foo')) })
            return self.fold_new_promise(node);
          }
          sym => {
            if sym.to_string() == "__parcel__URL__" {
              let mut call = node.clone().fold_children_with(self);
              call.callee = Box::new(ast::Expr::Ident(ast::Ident::new(
                "URL".into(),
                DUMMY_SP.apply_mark(self.ignore_mark),
              )));
              return call;
            }
            false
          }
        }
      }
      _ => false,
    };

    if !matched {
      return node.fold_children_with(self);
    }

    if let Some(args) = &node.args {
      if args.len() > 0 {
        let (specifier, span) =
          if let Some(s) = self.match_import_meta_url(&*args[0].expr, self.decls) {
            s
          } else if let Lit(lit) = &*args[0].expr {
            if let ast::Lit::Str(str_) = lit {
              let constructor = match &*node.callee {
                Ident(id) => id.sym.to_string(),
                _ => "Worker".to_string(),
              };
              self.diagnostics.push(Diagnostic {
                message: format!(
                  "Constructing a {} with a string literal is not supported.",
                  constructor
                ),
                code_highlights: Some(vec![CodeHighlight {
                  message: None,
                  loc: SourceLocation::from(self.source_map, str_.span),
                }]),
                hints: Some(vec![format!(
                  "Replace with: new URL('{}', import.meta.url)",
                  str_.value
                )]),
                show_environment: false,
              });
              return node;
            } else {
              return node;
            }
          } else {
            return node;
          };

        let (source_type, opts) = match_worker_type(args.get(1));
        let placeholder = self.add_url_dependency(
          specifier.clone(),
          span,
          DependencyKind::WebWorker,
          source_type,
        );

        // Replace argument with a require call to resolve the URL at runtime.
        let mut node = node.clone();
        if let Some(mut args) = node.args.clone() {
          args[0].expr = Box::new(placeholder);

          // If module workers aren't supported natively, remove the `type: 'module'` option.
          // If no other options are passed, remove the argument entirely.
          if !self.config.supports_module_workers {
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
    use ast::*;

    if let Some((specifier, span)) = self.match_import_meta_url(&node, self.decls) {
      let url = self.add_url_dependency(
        specifier.clone(),
        span,
        DependencyKind::URL,
        self.config.source_type,
      );

      // If this is a library, we will already have a URL object. Otherwise, we need to
      // construct one from the string returned by the JSRuntime.
      if !self.config.is_library {
        return Expr::New(NewExpr {
          span: DUMMY_SP,
          callee: Box::new(Expr::Ident(Ident::new(js_word!("URL"), DUMMY_SP))),
          args: Some(vec![ExprOrSpread {
            expr: Box::new(url),
            spread: None,
          }]),
          type_args: None,
        });
      }

      return url;
    }

    let is_require = match &node {
      Expr::Ident(Ident { sym, span, .. }) => {
        // Free `require` -> undefined
        sym == &js_word!("require") && !self.decls.contains(&(sym.clone(), span.ctxt()))
      }
      Expr::Member(MemberExpr {
        obj: ExprOrSuper::Expr(expr),
        ..
      }) => {
        // e.g. `require.extensions` -> undefined
        if let Expr::Ident(Ident { sym, span, .. }) = &**expr {
          sym == &js_word!("require") && !self.decls.contains(&(sym.clone(), span.ctxt()))
        } else {
          false
        }
      }
      _ => false,
    };

    if is_require {
      return ast::Expr::Ident(ast::Ident::new("undefined".into(), DUMMY_SP));
    }

    node.fold_children_with(self)
  }
}

impl<'a> DependencyCollector<'a> {
  fn fold_new_promise(&mut self, node: ast::NewExpr) -> ast::NewExpr {
    use ast::Expr::*;

    // Match requires inside promises (e.g. Rollup compiled dynamic imports)
    // new Promise(resolve => resolve(require('foo')))
    // new Promise(resolve => { resolve(require('foo')) })
    // new Promise(function (resolve) { resolve(require('foo')) })
    // new Promise(function (resolve) { return resolve(require('foo')) })
    if let Some(args) = &node.args {
      if let Some(arg) = args.get(0) {
        let (resolve, expr) = match &*arg.expr {
          Fn(f) => {
            let param = if let Some(param) = f.function.params.get(0) {
              Some(&param.pat)
            } else {
              None
            };
            let body = if let Some(body) = &f.function.body {
              self.match_block_stmt_expr(body)
            } else {
              None
            };
            (param, body)
          }
          Arrow(f) => {
            let param = f.params.get(0);
            let body = match &f.body {
              ast::BlockStmtOrExpr::Expr(expr) => Some(&**expr),
              ast::BlockStmtOrExpr::BlockStmt(block) => self.match_block_stmt_expr(block),
            };
            (param, body)
          }
          _ => (None, None),
        };

        let resolve_id = match resolve {
          Some(ast::Pat::Ident(id)) => id.to_id(),
          _ => return node.fold_children_with(self),
        };

        match expr {
          Some(ast::Expr::Call(call)) => {
            if let ast::ExprOrSuper::Expr(callee) = &call.callee {
              if let ast::Expr::Ident(id) = &**callee {
                if id.to_id() == resolve_id {
                  if let Some(arg) = call.args.get(0) {
                    if let Some(_) =
                      match_require(&*arg.expr, self.decls, Mark::fresh(Mark::root()))
                    {
                      let was_in_promise = self.in_promise;
                      self.in_promise = true;
                      let node = node.fold_children_with(self);
                      self.in_promise = was_in_promise;
                      return node;
                    }
                  }
                }
              }
            }
          }
          _ => {}
        }
      }
    }

    return node.fold_children_with(self);
  }

  fn match_block_stmt_expr<'x>(&self, block: &'x ast::BlockStmt) -> Option<&'x ast::Expr> {
    match block.stmts.last() {
      Some(ast::Stmt::Expr(ast::ExprStmt { expr, .. })) => Some(&**expr),
      Some(ast::Stmt::Return(ast::ReturnStmt { arg, .. })) => {
        if let Some(arg) = arg {
          Some(&**arg)
        } else {
          None
        }
      }
      _ => None,
    }
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

fn create_url_constructor(url: ast::Expr, use_import_meta: bool) -> ast::Expr {
  use ast::*;

  let expr = if use_import_meta {
    Expr::Member(MemberExpr {
      span: DUMMY_SP,
      obj: ExprOrSuper::Expr(Box::new(Expr::MetaProp(MetaPropExpr {
        meta: Ident::new(js_word!("import"), DUMMY_SP),
        prop: Ident::new(js_word!("meta"), DUMMY_SP),
      }))),
      prop: Box::new(Expr::Ident(Ident::new(js_word!("url"), DUMMY_SP))),
      computed: false,
    })
  } else {
    // CJS output: "file:" + __filename
    Expr::Bin(BinExpr {
      span: DUMMY_SP,
      left: Box::new(Expr::Lit(Lit::Str(Str {
        value: "file:".into(),
        kind: StrKind::Synthesized,
        span: DUMMY_SP,
        has_escape: false,
      }))),
      op: BinaryOp::Add,
      right: Box::new(Expr::Ident(Ident::new("__filename".into(), DUMMY_SP))),
    })
  };

  Expr::New(NewExpr {
    span: DUMMY_SP,
    callee: Box::new(Expr::Ident(Ident::new(js_word!("URL"), DUMMY_SP))),
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

impl<'a> DependencyCollector<'a> {
  fn match_import_meta_url(
    &mut self,
    expr: &ast::Expr,
    decls: &HashSet<(JsWord, SyntaxContext)>,
  ) -> Option<(JsWord, swc_common::Span)> {
    use ast::*;

    match expr {
      Expr::New(new) => {
        let is_url = match &*new.callee {
          Expr::Ident(id) => id.sym == js_word!("URL") && !decls.contains(&id.to_id()),
          _ => false,
        };

        if !is_url {
          return None;
        }

        if let Some(args) = &new.args {
          let specifier = if let Some(arg) = args.get(0) {
            match &*arg.expr {
              Expr::Lit(Lit::Str(s)) => s,
              _ => return None,
            }
          } else {
            return None;
          };

          if let Some(arg) = args.get(1) {
            match &*arg.expr {
              Expr::Member(member) => {
                match &member.obj {
                  ExprOrSuper::Expr(expr) => match &**expr {
                    ast::Expr::MetaProp(MetaPropExpr {
                      meta:
                        Ident {
                          sym: js_word!("import"),
                          ..
                        },
                      prop:
                        Ident {
                          sym: js_word!("meta"),
                          ..
                        },
                    }) => {}
                    _ => return None,
                  },
                  _ => return None,
                }

                let is_url = match &*member.prop {
                  Expr::Ident(id) => id.sym == js_word!("url") && !member.computed,
                  Expr::Lit(Lit::Str(str)) => str.value == js_word!("url"),
                  _ => false,
                };

                if !is_url {
                  return None;
                }

                if self.config.source_type == SourceType::Script {
                  self.diagnostics.push(Diagnostic {
                    message: "`import.meta` is not supported outside a module.".to_string(),
                    code_highlights: Some(vec![CodeHighlight {
                      message: None,
                      loc: SourceLocation::from(self.source_map, member.span),
                    }]),
                    hints: None,
                    show_environment: true,
                  })
                }

                return Some((specifier.value.clone(), specifier.span));
              }
              Expr::Bin(BinExpr {
                op: BinaryOp::Add,
                left,
                right,
                ..
              }) => {
                // Match "file:" + __filename
                match (&**left, &**right) {
                  (
                    Expr::Lit(Lit::Str(Str { value: left, .. })),
                    Expr::Ident(Ident { sym: right, .. }),
                  ) if left == "file:" && right == "__filename" => {
                    return Some((specifier.value.clone(), specifier.span));
                  }
                  _ => return None,
                }
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
