use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use swc_atoms::JsWord;
use swc_common::{sync::Lrc, Mark, Span, SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast::*;
use swc_ecmascript::visit::{Fold, FoldWith, Node, Visit, VisitWith};

use crate::utils::{match_member_expr, CodeHighlight, Diagnostic, SourceLocation};

type IdentId = (JsWord, SyntaxContext);
macro_rules! id {
  ($ident: expr) => {
    ($ident.sym.clone(), $ident.span.ctxt)
  };
}

macro_rules! hash {
  ($str:expr) => {{
    let mut hasher = DefaultHasher::new();
    $str.hash(&mut hasher);
    hasher.finish()
  }};
}

pub fn hoist(
  module: Module,
  source_map: Lrc<swc_common::SourceMap>,
  module_id: &str,
  decls: HashSet<IdentId>,
  ignore_mark: Mark,
  global_mark: Mark,
) -> Result<(Module, HoistResult), Vec<Diagnostic>> {
  let mut collect = Collect::new(source_map, decls, ignore_mark, global_mark);
  module.visit_with(&Invalid { span: DUMMY_SP } as _, &mut collect);

  let mut hoist = Hoist::new(module_id, &collect);
  let module = module.fold_with(&mut hoist);
  if hoist.diagnostics.len() > 0 {
    return Err(hoist.diagnostics);
  }

  Ok((module, hoist.get_result()))
}

struct Hoist<'a> {
  module_id: &'a str,
  collect: &'a Collect,
  module_items: Vec<ModuleItem>,
  export_decls: HashSet<JsWord>,
  imported_symbols: HashMap<JsWord, (JsWord, JsWord, SourceLocation)>,
  exported_symbols: HashMap<JsWord, (JsWord, SourceLocation)>,
  re_exports: Vec<(JsWord, JsWord, JsWord, SourceLocation)>,
  self_references: HashSet<JsWord>,
  dynamic_imports: HashMap<JsWord, JsWord>,
  in_function_scope: bool,
  diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct HoistResult {
  imported_symbols: HashMap<JsWord, (JsWord, JsWord, SourceLocation)>,
  exported_symbols: HashMap<JsWord, (JsWord, SourceLocation)>,
  re_exports: Vec<(JsWord, JsWord, JsWord, SourceLocation)>,
  self_references: HashSet<JsWord>,
  wrapped_requires: HashSet<JsWord>,
  dynamic_imports: HashMap<JsWord, JsWord>,
  static_cjs_exports: bool,
  has_cjs_exports: bool,
  should_wrap: bool,
}

impl<'a> Hoist<'a> {
  fn new(module_id: &'a str, collect: &'a Collect) -> Self {
    Hoist {
      module_id,
      collect,
      module_items: vec![],
      export_decls: HashSet::new(),
      imported_symbols: HashMap::new(),
      exported_symbols: HashMap::new(),
      re_exports: vec![],
      self_references: HashSet::new(),
      dynamic_imports: HashMap::new(),
      in_function_scope: false,
      diagnostics: vec![],
    }
  }

  fn get_result(self) -> HoistResult {
    HoistResult {
      imported_symbols: self.imported_symbols,
      exported_symbols: self.exported_symbols,
      re_exports: self.re_exports,
      self_references: self.self_references,
      dynamic_imports: self.dynamic_imports,
      wrapped_requires: self.collect.wrapped_requires.clone(),
      static_cjs_exports: self.collect.static_cjs_exports,
      has_cjs_exports: self.collect.has_cjs_exports,
      should_wrap: self.collect.should_wrap,
    }
  }
}

impl<'a> Fold for Hoist<'a> {
  fn fold_module(&mut self, node: Module) -> Module {
    let mut node = node;
    let mut hoisted_imports = vec![];
    for item in node.body {
      match item {
        ModuleItem::ModuleDecl(decl) => {
          match decl {
            ModuleDecl::Import(import) => {
              hoisted_imports.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                specifiers: vec![],
                asserts: None,
                span: DUMMY_SP,
                src: Str {
                  value: format!("{}:{}", self.module_id, import.src.value).into(),
                  span: DUMMY_SP,
                  kind: StrKind::Synthesized,
                  has_escape: false,
                },
                type_only: false,
              })));

              // Ensure that all import specifiers are constant.
              for specifier in &import.specifiers {
                let local = match specifier {
                  ImportSpecifier::Named(named) => &named.local,
                  ImportSpecifier::Default(default) => &default.local,
                  ImportSpecifier::Namespace(ns) => &ns.local,
                };

                if let Some(spans) = self.collect.non_const_bindings.get(&id!(local)) {
                  let mut highlights: Vec<CodeHighlight> = spans
                    .iter()
                    .map(|span| CodeHighlight {
                      loc: SourceLocation::from(&self.collect.source_map, *span),
                      message: None,
                    })
                    .collect();

                  highlights.push(CodeHighlight {
                    loc: SourceLocation::from(&self.collect.source_map, local.span),
                    message: Some("Originally imported here".into()),
                  });

                  self.diagnostics.push(Diagnostic {
                    message: "Assignment to an import specifier is not allowed".into(),
                    code_highlights: Some(highlights),
                    hints: None,
                  })
                }
              }
            }
            ModuleDecl::ExportNamed(export) => {
              if let Some(src) = export.src {
                // TODO: skip if already imported.
                hoisted_imports.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                  specifiers: vec![],
                  asserts: None,
                  span: DUMMY_SP,
                  src: Str {
                    value: format!("{}:{}", self.module_id, src.value).into(),
                    span: DUMMY_SP,
                    kind: StrKind::Synthesized,
                    has_escape: false,
                  },
                  type_only: false,
                })));

                for specifier in export.specifiers {
                  match specifier {
                    ExportSpecifier::Named(named) => {
                      let exported = match named.exported {
                        Some(exported) => exported.sym,
                        None => named.orig.sym.clone(),
                      };
                      self.re_exports.push((
                        exported,
                        src.value.clone(),
                        named.orig.sym,
                        SourceLocation::from(&self.collect.source_map, named.span),
                      ));
                    }
                    ExportSpecifier::Default(default) => {
                      self.re_exports.push((
                        default.exported.sym,
                        src.value.clone(),
                        js_word!("default"),
                        SourceLocation::from(&self.collect.source_map, default.exported.span),
                      ));
                    }
                    ExportSpecifier::Namespace(namespace) => {
                      self.re_exports.push((
                        namespace.name.sym,
                        src.value.clone(),
                        "*".into(),
                        SourceLocation::from(&self.collect.source_map, namespace.span),
                      ));
                    }
                  }
                }
              } else {
                for specifier in export.specifiers {
                  match specifier {
                    ExportSpecifier::Named(named) => {
                      let id = id!(named.orig);
                      let exported = match named.exported {
                        Some(exported) => exported.sym,
                        None => named.orig.sym,
                      };
                      if let Some(Import {
                        source, specifier, ..
                      }) = self.collect.imports.get(&id)
                      {
                        self.re_exports.push((
                          exported,
                          source.clone(),
                          specifier.clone(),
                          SourceLocation::from(&self.collect.source_map, named.span),
                        ));
                      } else {
                        // A variable will appear only once in the `exports` mapping but
                        // could be exported multiple times with different names.
                        // Find the original exported name, and remap.
                        let orig_exported = self.collect.exports.get(&id).unwrap();
                        let id = if self.collect.should_wrap {
                          Ident::new(orig_exported.clone(), DUMMY_SP)
                        } else {
                          self.get_export_ident(DUMMY_SP, orig_exported)
                        };
                        self.exported_symbols.entry(exported).or_insert((
                          id.sym,
                          SourceLocation::from(&self.collect.source_map, named.span),
                        ));
                      }
                    }
                    _ => {}
                  }
                }
              }
            }
            ModuleDecl::ExportAll(export) => {
              hoisted_imports.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                specifiers: vec![],
                asserts: None,
                span: DUMMY_SP,
                src: Str {
                  value: format!("{}:{}", self.module_id, export.src.value).into(),
                  span: DUMMY_SP,
                  kind: StrKind::Synthesized,
                  has_escape: false,
                },
                type_only: false,
              })));
              self.re_exports.push((
                "*".into(),
                export.src.value,
                "*".into(),
                SourceLocation::from(&self.collect.source_map, export.span),
              ));
            }
            ModuleDecl::ExportDefaultExpr(export) => {
              let ident = self.get_export_ident(export.span, &"default".into());
              let init = export.expr.fold_with(self);
              self
                .module_items
                .push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
                  declare: false,
                  kind: VarDeclKind::Var,
                  span: DUMMY_SP,
                  decls: vec![VarDeclarator {
                    definite: false,
                    span: DUMMY_SP,
                    name: Pat::Ident(BindingIdent::from(ident)),
                    init: Some(init),
                  }],
                }))));
            }
            ModuleDecl::ExportDefaultDecl(export) => {
              let decl = match export.decl {
                DefaultDecl::Class(class) => Decl::Class(ClassDecl {
                  ident: self.get_export_ident(DUMMY_SP, &"default".into()),
                  declare: false,
                  class: class.class.fold_with(self),
                }),
                DefaultDecl::Fn(func) => Decl::Fn(FnDecl {
                  ident: self.get_export_ident(DUMMY_SP, &"default".into()),
                  declare: false,
                  function: func.function.fold_with(self),
                }),
                _ => {
                  unreachable!("unsupported export default declaration");
                }
              };

              self.module_items.push(ModuleItem::Stmt(Stmt::Decl(decl)));
            }
            ModuleDecl::ExportDecl(export) => {
              let d = export.decl.fold_with(self);
              self.module_items.push(ModuleItem::Stmt(Stmt::Decl(d)));
            }
            item => {
              let d = item.fold_with(self);
              self.module_items.push(ModuleItem::ModuleDecl(d))
            }
          }
        }
        ModuleItem::Stmt(stmt) => {
          match stmt {
            Stmt::Decl(decl) => {
              match decl {
                Decl::Var(var) => {
                  let mut decls = vec![];
                  for v in &var.decls {
                    if let Some(init) = &v.init {
                      // Match var x = require('foo');
                      if let Some(source) =
                        match_require(init, &self.collect.decls, self.collect.ignore_mark)
                      {
                        // If the require is accessed in a way we cannot analyze, do not replace.
                        // e.g. const {x: {y: z}} = require('x');
                        // The require will be handled in the expression handler, below.
                        if !self.collect.non_static_requires.contains(&source) {
                          // If this is not the first declarator in the variable declaration, we need to
                          // split the declaration into multiple to preserve side effect ordering.
                          // var x = sideEffect(), y = require('foo'), z = 2;
                          //   -> var x = sideEffect(); import 'foo'; var y = $id$import$foo, z = 2;
                          if decls.len() > 0 {
                            let var = VarDecl {
                              span: var.span,
                              kind: var.kind,
                              declare: var.declare,
                              decls: std::mem::take(&mut decls),
                            };
                            self
                              .module_items
                              .push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(var))));
                          }

                          self
                            .module_items
                            .push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                              specifiers: vec![],
                              asserts: None,
                              span: DUMMY_SP,
                              src: Str {
                                value: format!("{}:{}", self.module_id, source).into(),
                                span: DUMMY_SP,
                                kind: StrKind::Synthesized,
                                has_escape: false,
                              },
                              type_only: false,
                            })));

                          // Create variable assignments for any declarations that are not constant.
                          self.handle_non_const_require(&v, &source);
                          continue;
                        }
                      }

                      match &**init {
                        Expr::Member(member) => {
                          match &member.obj {
                            ExprOrSuper::Expr(expr) => {
                              // Match var x = require('foo').bar;
                              if let Some(source) =
                                match_require(&*expr, &self.collect.decls, self.collect.ignore_mark)
                              {
                                if !self.collect.non_static_requires.contains(&source) {
                                  // If this is not the first declarator in the variable declaration, we need to
                                  // split the declaration into multiple to preserve side effect ordering.
                                  // var x = sideEffect(), y = require('foo').bar, z = 2;
                                  //   -> var x = sideEffect(); import 'foo'; var y = $id$import$foo$bar, z = 2;
                                  if decls.len() > 0 {
                                    let var = VarDecl {
                                      span: var.span,
                                      kind: var.kind,
                                      declare: var.declare,
                                      decls: std::mem::take(&mut decls),
                                    };
                                    self
                                      .module_items
                                      .push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(var))));
                                  }

                                  self.module_items.push(ModuleItem::ModuleDecl(
                                    ModuleDecl::Import(ImportDecl {
                                      specifiers: vec![],
                                      asserts: None,
                                      span: DUMMY_SP,
                                      src: Str {
                                        value: format!("{}:{}", self.module_id, source).into(),
                                        span: DUMMY_SP,
                                        kind: StrKind::Synthesized,
                                        has_escape: false,
                                      },
                                      type_only: false,
                                    }),
                                  ));

                                  self.handle_non_const_require(&v, &source);
                                  continue;
                                }
                              }
                            }
                            _ => {}
                          }
                        }
                        _ => {}
                      }
                    }

                    // Otherwise, fold the variable initializer. If requires were found
                    // in the expression, they will be hoisted into module_items. If the
                    // length increases, then we need to split the variable declaration
                    // into multiple to preserve side effect ordering.
                    // var x = 2, y = doSomething(require('foo')), z = 3;
                    //   -> var x = 2; import 'foo'; var y = doSomething($id$import$foo), z = 3;
                    let items_len = self.module_items.len();
                    let d = v.clone().fold_with(self);
                    if self.module_items.len() > items_len {
                      if decls.len() > 0 {
                        let var = VarDecl {
                          span: var.span,
                          kind: var.kind,
                          declare: var.declare,
                          decls: std::mem::take(&mut decls),
                        };
                        self
                          .module_items
                          .insert(items_len, ModuleItem::Stmt(Stmt::Decl(Decl::Var(var))));
                      }
                    }
                    decls.push(d);
                  }

                  // Push whatever declarators are left.
                  if decls.len() > 0 {
                    let var = VarDecl {
                      span: var.span,
                      kind: var.kind,
                      declare: var.declare,
                      decls,
                    };
                    self
                      .module_items
                      .push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(var))))
                  }
                }
                item => {
                  let d = item.fold_with(self);
                  self.module_items.push(ModuleItem::Stmt(Stmt::Decl(d)))
                }
              }
            }
            item => {
              let d = item.fold_with(self);
              self.module_items.push(ModuleItem::Stmt(d))
            }
          }
        }
      }
    }

    for name in self.export_decls.drain() {
      hoisted_imports.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
        declare: false,
        kind: VarDeclKind::Var,
        span: node.span,
        decls: vec![VarDeclarator {
          definite: false,
          span: node.span,
          name: Pat::Ident(BindingIdent::from(Ident::new(name, DUMMY_SP))),
          init: None,
        }],
      }))));
    }

    self.module_items.splice(0..0, hoisted_imports);
    node.body = std::mem::take(&mut self.module_items);
    node
  }

  fn fold_function(&mut self, node: Function) -> Function {
    let in_function_scope = self.in_function_scope;
    self.in_function_scope = true;
    let res = node.fold_children_with(self);
    self.in_function_scope = in_function_scope;
    res
  }

  fn fold_class(&mut self, node: Class) -> Class {
    let in_function_scope = self.in_function_scope;
    self.in_function_scope = true;
    let res = node.fold_children_with(self);
    self.in_function_scope = in_function_scope;
    res
  }

  fn fold_expr(&mut self, node: Expr) -> Expr {
    match node {
      Expr::Member(member) => {
        if !self.collect.should_wrap {
          if match_member_expr(&member, vec!["module", "exports"], &self.collect.decls) {
            self.self_references.insert("*".into());
            return Expr::Ident(self.get_export_ident(member.span, &"*".into()));
          }

          if match_member_expr(&member, vec!["module", "hot"], &self.collect.decls) {
            return Expr::Lit(Lit::Null(Null { span: member.span }));
          }
        }

        let key = match &*member.prop {
          Expr::Ident(ident) => {
            if !member.computed {
              ident.sym.clone()
            } else {
              return Expr::Member(member.fold_children_with(self));
            }
          }
          Expr::Lit(lit) => match lit {
            Lit::Str(str_) => str_.value.clone(),
            _ => return Expr::Member(member.fold_children_with(self)),
          },
          _ => return Expr::Member(member.fold_children_with(self)),
        };

        match member.obj {
          ExprOrSuper::Expr(ref expr) => {
            match &**expr {
              Expr::Ident(ident) => {
                // import * as y from 'x'; OR const y = require('x'); OR const y = await import('x');
                // y.foo -> $id$import$10b1f2ceae7ab64e$y
                if let Some(Import {
                  source,
                  specifier,
                  kind,
                  ..
                }) = self.collect.imports.get(&id!(ident))
                {
                  // If there are any non-static accesses of the namespace, don't perform any replacement.
                  // This will be handled in the Ident visitor below, which replaces y -> $id$import$10b1f2ceae7ab64e.
                  if specifier == "*"
                    && !self.collect.non_static_access.contains(&id!(ident))
                    && !self.collect.non_const_bindings.contains_key(&id!(ident))
                    && !self.collect.non_static_requires.contains(&source)
                  {
                    if *kind == ImportKind::DynamicImport {
                      let name: JsWord = format!(
                        "${}$importAsync${:x}${:x}",
                        self.module_id,
                        hash!(source),
                        hash!(key)
                      )
                      .into();
                      self.imported_symbols.insert(
                        name,
                        (
                          source.clone(),
                          key.clone(),
                          SourceLocation::from(&self.collect.source_map, member.span),
                        ),
                      );
                    } else {
                      return Expr::Ident(self.get_import_ident(
                        member.span,
                        &source,
                        &key,
                        SourceLocation::from(&self.collect.source_map, member.span),
                      ));
                    }
                  }
                }

                // exports.foo -> $id$export$foo
                let exports: JsWord = "exports".into();
                if ident.sym == exports && !self.collect.decls.contains(&id!(ident)) {
                  if self.collect.static_cjs_exports && !self.collect.should_wrap {
                    self.self_references.insert(key.clone());
                    return Expr::Ident(self.get_export_ident(member.span, &key));
                  }
                }
              }
              Expr::Call(_call) => {
                // require('foo').bar -> $id$import$foo$bar
                if let Some(source) =
                  match_require(expr, &self.collect.decls, self.collect.ignore_mark)
                {
                  self.add_require(&source);
                  return Expr::Ident(self.get_import_ident(
                    member.span,
                    &source,
                    &key,
                    SourceLocation::from(&self.collect.source_map, member.span),
                  ));
                }
              }
              Expr::Member(mem) => {
                // module.exports.foo -> $id$export$foo
                if self.collect.static_cjs_exports
                  && !self.collect.should_wrap
                  && match_member_expr(&mem, vec!["module", "exports"], &self.collect.decls)
                {
                  self.self_references.insert(key.clone());
                  return Expr::Ident(self.get_export_ident(member.span, &key));
                }
              }
              Expr::This(_) => {
                // this.foo -> $id$export$foo
                if self.collect.static_cjs_exports
                  && !self.collect.should_wrap
                  && !self.in_function_scope
                  && !self.collect.is_esm
                {
                  self.self_references.insert(key.clone());
                  return Expr::Ident(self.get_export_ident(member.span, &key));
                }
              }
              _ => {}
            }
          }
          _ => {}
        }

        // Don't visit member.prop so we avoid the ident visitor.
        return Expr::Member(MemberExpr {
          span: member.span,
          obj: member.obj.fold_with(self),
          prop: member.prop,
          computed: member.computed,
        });
      }
      Expr::Call(ref call) => {
        // require('foo') -> $id$import$foo
        if let Some(source) = match_require(&node, &self.collect.decls, self.collect.ignore_mark) {
          self.add_require(&source);
          return Expr::Ident(self.get_import_ident(
            call.span,
            &source,
            &("*".into()),
            SourceLocation::from(&self.collect.source_map, call.span),
          ));
        }

        if let Some(source) = match_import(&node, self.collect.ignore_mark) {
          self.add_require(&source);
          let name: JsWord = format!("${}$importAsync${:x}", self.module_id, hash!(source)).into();
          self.dynamic_imports.insert(name.clone(), source.clone());
          if self.collect.non_static_requires.contains(&source) || self.collect.should_wrap {
            self.imported_symbols.insert(
              name.clone(),
              (
                source,
                "*".into(),
                SourceLocation::from(&self.collect.source_map, call.span),
              ),
            );
          }
          return Expr::Ident(Ident::new(name, call.span));
        }
      }
      Expr::This(this) => {
        if !self.in_function_scope {
          // If ESM, replace `this` with `undefined`, otherwise with the CJS exports object.
          if self.collect.is_esm {
            return Expr::Ident(Ident::new("undefined".into(), DUMMY_SP));
          } else if !self.collect.should_wrap {
            self.self_references.insert("*".into());
            return Expr::Ident(self.get_export_ident(this.span, &"*".into()));
          }
        }
      }
      Expr::Unary(ref unary) => {
        // typeof require -> "function"
        // typeof module -> "object"
        if unary.op == UnaryOp::TypeOf {
          match &*unary.arg {
            Expr::Ident(ident) => {
              if ident.sym == js_word!("require") && !self.collect.decls.contains(&id!(ident)) {
                return Expr::Lit(Lit::Str(Str {
                  kind: StrKind::Synthesized,
                  has_escape: false,
                  span: unary.span,
                  value: js_word!("function"),
                }));
              }

              if ident.sym == js_word!("module") && !self.collect.decls.contains(&id!(ident)) {
                return Expr::Lit(Lit::Str(Str {
                  kind: StrKind::Synthesized,
                  has_escape: false,
                  span: unary.span,
                  value: js_word!("object"),
                }));
              }
            }
            _ => {}
          }
        }
      }
      _ => {}
    }

    node.fold_children_with(self)
  }

  fn fold_seq_expr(&mut self, node: SeqExpr) -> SeqExpr {
    // This is a hack to work around the SWC fixer pass removing identifiers in sequence expressions
    // that aren't at the end. In general this makes sense, but we need to preserve these so that they
    // can be replaced with a parcelRequire call in the linker. We just wrap with a unary expression to
    // get around this for now.
    let len = node.exprs.len();
    let exprs = node
      .exprs
      .into_iter()
      .enumerate()
      .map(|(i, expr)| {
        if i != len - 1 {
          if let Some(_) = match_require(&*expr, &self.collect.decls, self.collect.ignore_mark) {
            return Box::new(Expr::Unary(UnaryExpr {
              op: UnaryOp::Bang,
              arg: expr.fold_with(self),
              span: DUMMY_SP,
            }));
          }
        }

        expr.fold_with(self)
      })
      .collect();

    SeqExpr { exprs, ..node }
  }

  fn fold_ident(&mut self, node: Ident) -> Ident {
    // import {x} from 'y'; OR const {x} = require('y');
    // x -> $id$import$y$x
    //
    // import * as x from 'y'; OR const x = require('y');
    // x -> $id$import$y
    if let Some(Import {
      source,
      specifier,
      kind,
      loc,
      ..
    }) = self.collect.imports.get(&id!(node))
    {
      // If the require is accessed in a way we cannot analyze, do not replace.
      // e.g. const {x: {y: z}} = require('x');
      if !self.collect.non_static_requires.contains(source) {
        if *kind == ImportKind::DynamicImport {
          if specifier != "*" {
            let name: JsWord = format!(
              "${}$importAsync${:x}${:x}",
              self.module_id,
              hash!(source),
              hash!(specifier)
            )
            .into();
            self
              .imported_symbols
              .insert(name, (source.clone(), specifier.clone(), loc.clone()));
          } else if self.collect.non_static_access.contains(&id!(node)) {
            let name: JsWord =
              format!("${}$importAsync${:x}", self.module_id, hash!(source)).into();
            self
              .imported_symbols
              .insert(name, (source.clone(), "*".into(), loc.clone()));
          }
        } else {
          // If this identifier is not constant, we cannot directly reference the imported
          // value. Instead, a new local variable is created that originally points to the
          // required value, and we reference that instead. This allows the local variable
          // to be re-assigned without affecting the original exported variable.
          // See handle_non_const_require, below.
          if self.collect.non_const_bindings.contains_key(&id!(node)) {
            return self.get_require_ident(&node.sym);
          }

          return self.get_import_ident(node.span, source, specifier, loc.clone());
        }
      }
    }

    if let Some(exported) = self.collect.exports.get(&id!(node)) {
      // If wrapped, mark the original symbol as exported.
      // Otherwise replace with an export identifier.
      if self.collect.should_wrap {
        self.exported_symbols.entry(exported.clone()).or_insert((
          node.sym.clone(),
          SourceLocation::from(&self.collect.source_map, node.span),
        ));
        return node;
      } else {
        return self.get_export_ident(node.span, exported);
      }
    }

    let exports: JsWord = "exports".into();
    if node.sym == exports && !self.collect.decls.contains(&id!(node)) && !self.collect.should_wrap
    {
      self.self_references.insert("*".into());
      return self.get_export_ident(node.span, &"*".into());
    }

    if node.sym == js_word!("global") && !self.collect.decls.contains(&id!(node)) {
      return Ident::new("$parcel$global".into(), node.span);
    }

    if node.span.ctxt() == self.collect.global_ctxt
      && self.collect.decls.contains(&id!(node))
      && !self.collect.should_wrap
    {
      let new_name: JsWord = format!("${}$var${}", self.module_id, node.sym).into();
      return Ident::new(new_name, node.span);
    }

    node
  }

  fn fold_assign_expr(&mut self, node: AssignExpr) -> AssignExpr {
    if self.collect.should_wrap {
      return node.fold_children_with(self);
    }

    let expr = match &node.left {
      PatOrExpr::Expr(expr) => expr,
      PatOrExpr::Pat(pat) => match &**pat {
        Pat::Expr(expr) => expr,
        _ => return node.fold_children_with(self),
      },
    };

    match &**expr {
      Expr::Member(member) => {
        if match_member_expr(&member, vec!["module", "exports"], &self.collect.decls) {
          let ident = BindingIdent::from(self.get_export_ident(member.span, &"*".into()));
          return AssignExpr {
            span: node.span,
            op: node.op,
            left: PatOrExpr::Pat(Box::new(Pat::Ident(ident))),
            right: node.right.fold_with(self),
          };
        }

        let is_cjs_exports = match &member.obj {
          ExprOrSuper::Expr(expr) => match &**expr {
            Expr::Member(member) => {
              match_member_expr(&member, vec!["module", "exports"], &self.collect.decls)
            }
            Expr::Ident(ident) => {
              let exports: JsWord = "exports".into();
              ident.sym == exports && !self.collect.decls.contains(&id!(ident))
            }
            _ => false,
          },
          _ => false,
        };

        if is_cjs_exports {
          let key: JsWord = if self.collect.static_cjs_exports {
            match &*member.prop {
              Expr::Ident(ident) => {
                if !member.computed {
                  ident.sym.clone()
                } else {
                  unreachable!("Unexpected non-static CJS export");
                }
              }
              Expr::Lit(lit) => match lit {
                Lit::Str(str_) => str_.value.clone(),
                _ => unreachable!("Unexpected non-static CJS export"),
              },
              _ => unreachable!("Unexpected non-static CJS export"),
            }
          } else {
            "*".into()
          };

          let ident = BindingIdent::from(self.get_export_ident(member.span, &key));
          if self.collect.static_cjs_exports {
            self.export_decls.insert(ident.id.sym.clone());
          }

          return AssignExpr {
            span: node.span,
            op: node.op,
            left: if self.collect.static_cjs_exports {
              PatOrExpr::Pat(Box::new(Pat::Ident(ident)))
            } else {
              PatOrExpr::Pat(Box::new(Pat::Expr(Box::new(Expr::Member(MemberExpr {
                span: member.span,
                obj: ExprOrSuper::Expr(Box::new(Expr::Ident(ident.id.clone()))),
                prop: member.prop.clone().fold_with(self),
                computed: member.computed,
              })))))
            },
            right: node.right.fold_with(self),
          };
        }
      }
      _ => {}
    }

    node.fold_children_with(self)
  }

  fn fold_prop(&mut self, node: Prop) -> Prop {
    if self.collect.should_wrap {
      return node.fold_children_with(self);
    }

    match node {
      Prop::Shorthand(ident) => Prop::KeyValue(KeyValueProp {
        key: PropName::Ident(Ident::new(ident.sym.clone(), DUMMY_SP)),
        value: Box::new(Expr::Ident(ident.fold_with(self))),
      }),
      _ => node.fold_children_with(self),
    }
  }

  fn fold_prop_name(&mut self, node: PropName) -> PropName {
    match node {
      PropName::Computed(k) => PropName::Computed(k.fold_with(self)),
      k => k,
    }
  }

  fn fold_object_pat_prop(&mut self, node: ObjectPatProp) -> ObjectPatProp {
    if self.collect.should_wrap {
      return node.fold_children_with(self);
    }

    // var {a, b} = foo; -> var {a: $id$var$a, b: $id$var$b} = foo;
    match node {
      ObjectPatProp::Assign(assign) => ObjectPatProp::KeyValue(KeyValuePatProp {
        key: PropName::Ident(Ident::new(assign.key.sym.clone(), DUMMY_SP)),
        value: Box::new(match assign.value {
          Some(value) => Pat::Assign(AssignPat {
            left: Box::new(Pat::Ident(BindingIdent::from(assign.key.fold_with(self)))),
            right: value.fold_with(self),
            span: DUMMY_SP,
            type_ann: None,
          }),
          None => Pat::Ident(BindingIdent::from(assign.key.fold_with(self))),
        }),
      }),
      _ => node.fold_children_with(self),
    }
  }
}

impl<'a> Hoist<'a> {
  fn add_require(&mut self, source: &JsWord) {
    self
      .module_items
      .push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
        specifiers: vec![],
        asserts: None,
        span: DUMMY_SP,
        src: Str {
          value: format!("{}:{}", self.module_id, source).into(),
          span: DUMMY_SP,
          kind: StrKind::Synthesized,
          has_escape: false,
        },
        type_only: false,
      })));
  }

  fn get_import_name(&self, source: &JsWord, local: &JsWord) -> JsWord {
    if local == "*" {
      format!("${}$import${:x}", self.module_id, hash!(source)).into()
    } else {
      format!(
        "${}$import${:x}${:x}",
        self.module_id,
        hash!(source),
        hash!(local)
      )
      .into()
    }
  }

  fn get_import_ident(
    &mut self,
    span: Span,
    source: &JsWord,
    local: &JsWord,
    loc: SourceLocation,
  ) -> Ident {
    let new_name = self.get_import_name(source, local);
    self
      .imported_symbols
      .insert(new_name.clone(), (source.clone(), local.clone(), loc));
    return Ident::new(new_name, span);
  }

  fn get_require_ident(&self, local: &JsWord) -> Ident {
    return Ident::new(
      format!("${}$require${}", self.module_id, local).into(),
      DUMMY_SP,
    );
  }

  fn get_export_ident(&mut self, span: Span, exported: &JsWord) -> Ident {
    let new_name: JsWord = if exported == "*" {
      format!("${}$exports", self.module_id).into()
    } else {
      format!("${}$export${:x}", self.module_id, hash!(exported)).into()
    };

    self.exported_symbols.entry(exported.clone()).or_insert((
      new_name.clone(),
      SourceLocation::from(&self.collect.source_map, span),
    ));

    let mut span = span;
    span.ctxt = SyntaxContext::empty();
    return Ident::new(new_name, span);
  }

  fn handle_non_const_require(&mut self, v: &VarDeclarator, source: &JsWord) {
    // If any of the bindings in this declarator are not constant, we need to create
    // a local variable referencing them so that we can safely re-assign the local variable
    // without affecting the original export. This is only possible in CommonJS since ESM
    // imports are constant (this is ensured by the diagnostic in fold_module above).
    let mut non_const_bindings = HashSet::new();
    self
      .collect
      .get_non_const_binding_idents(&v.name, &mut non_const_bindings);

    for ident in non_const_bindings {
      if let Some(Import { specifier, .. }) = self.collect.imports.get(&id!(ident)) {
        let require_id = self.get_require_ident(&ident.sym);
        let import_id = self.get_import_ident(
          v.span,
          &source,
          specifier,
          SourceLocation::from(&self.collect.source_map, v.span),
        );
        self
          .module_items
          .push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
            declare: false,
            kind: VarDeclKind::Var,
            span: DUMMY_SP,
            decls: vec![VarDeclarator {
              definite: false,
              span: DUMMY_SP,
              name: Pat::Ident(BindingIdent::from(require_id)),
              init: Some(Box::new(Expr::Ident(import_id))),
            }],
          }))));
      }
    }
  }
}

macro_rules! visit_fn {
  ($self: ident, $node: ident) => {
    let in_module_this = $self.in_module_this;
    let in_function = $self.in_function;
    $self.in_module_this = false;
    $self.in_function = true;
    $node.visit_children_with($self);
    $self.in_module_this = in_module_this;
    $self.in_function = in_function;
  };
}

#[derive(PartialEq, Clone, Copy)]
pub enum ImportKind {
  Require,
  Import,
  DynamicImport,
}

pub struct Import {
  pub source: JsWord,
  pub specifier: JsWord,
  pub kind: ImportKind,
  pub loc: SourceLocation,
}

pub struct Collect {
  pub source_map: Lrc<swc_common::SourceMap>,
  pub decls: HashSet<IdentId>,
  ignore_mark: Mark,
  global_ctxt: SyntaxContext,
  static_cjs_exports: bool,
  has_cjs_exports: bool,
  is_esm: bool,
  should_wrap: bool,
  pub imports: HashMap<IdentId, Import>,
  exports: HashMap<IdentId, JsWord>,
  non_static_access: HashSet<IdentId>,
  non_const_bindings: HashMap<IdentId, Vec<Span>>,
  non_static_requires: HashSet<JsWord>,
  wrapped_requires: HashSet<JsWord>,
  in_module_this: bool,
  in_top_level: bool,
  in_export_decl: bool,
  in_function: bool,
  in_assign: bool,
}

impl Collect {
  pub fn new(
    source_map: Lrc<swc_common::SourceMap>,
    decls: HashSet<IdentId>,
    ignore_mark: Mark,
    global_mark: Mark,
  ) -> Self {
    Collect {
      source_map,
      decls,
      ignore_mark,
      global_ctxt: SyntaxContext::empty().apply_mark(global_mark),
      static_cjs_exports: true,
      has_cjs_exports: false,
      is_esm: false,
      should_wrap: false,
      imports: HashMap::new(),
      exports: HashMap::new(),
      non_static_access: HashSet::new(),
      non_const_bindings: HashMap::new(),
      non_static_requires: HashSet::new(),
      wrapped_requires: HashSet::new(),
      in_module_this: true,
      in_top_level: true,
      in_export_decl: false,
      in_function: false,
      in_assign: false,
    }
  }
}

impl Visit for Collect {
  fn visit_module(&mut self, node: &Module, _parent: &dyn Node) {
    self.in_module_this = true;
    self.in_top_level = true;
    self.in_function = false;
    node.visit_children_with(self);
    self.in_module_this = false;
  }

  fn visit_function(&mut self, node: &Function, _parent: &dyn Node) {
    visit_fn!(self, node);
  }

  fn visit_class(&mut self, node: &Class, _parent: &dyn Node) {
    visit_fn!(self, node);
  }

  fn visit_arrow_expr(&mut self, node: &ArrowExpr, _parent: &dyn Node) {
    let in_function = self.in_function;
    self.in_function = true;
    node.visit_children_with(self);
    self.in_function = in_function;
  }

  fn visit_module_item(&mut self, node: &ModuleItem, _parent: &dyn Node) {
    match node {
      ModuleItem::ModuleDecl(_decl) => {
        self.is_esm = true;
      }
      ModuleItem::Stmt(stmt) => {
        match stmt {
          Stmt::Decl(decl) => match decl {
            Decl::Var(_var) => {
              decl.visit_children_with(self);
              return;
            }
            _ => {}
          },
          Stmt::Expr(expr) => {
            // Top-level require(). Do not traverse further so it is not marked as wrapped.
            if let Some(_source) = self.match_require(&*expr.expr) {
              return;
            }

            // TODO: optimize `require('foo').bar` / `require('foo').bar()` as well
          }
          _ => {}
        }
      }
    }

    self.in_top_level = false;
    node.visit_children_with(self);
    self.in_top_level = true;
  }

  fn visit_import_decl(&mut self, node: &ImportDecl, _parent: &dyn Node) {
    for specifier in &node.specifiers {
      match specifier {
        ImportSpecifier::Named(named) => {
          let imported = match &named.imported {
            Some(imported) => imported.sym.clone(),
            None => named.local.sym.clone(),
          };
          self.imports.insert(
            id!(named.local),
            Import {
              source: node.src.value.clone(),
              specifier: imported,
              kind: ImportKind::Import,
              loc: SourceLocation::from(&self.source_map, named.span),
            },
          );
        }
        ImportSpecifier::Default(default) => {
          self.imports.insert(
            id!(default.local),
            Import {
              source: node.src.value.clone(),
              specifier: js_word!("default"),
              kind: ImportKind::Import,
              loc: SourceLocation::from(&self.source_map, default.span),
            },
          );
        }
        ImportSpecifier::Namespace(namespace) => {
          self.imports.insert(
            id!(namespace.local),
            Import {
              source: node.src.value.clone(),
              specifier: "*".into(),
              kind: ImportKind::Import,
              loc: SourceLocation::from(&self.source_map, namespace.span),
            },
          );
        }
      }
    }
  }

  fn visit_named_export(&mut self, node: &NamedExport, _parent: &dyn Node) {
    if node.src.is_some() {
      return;
    }

    for specifier in &node.specifiers {
      match specifier {
        ExportSpecifier::Named(named) => {
          let exported = match &named.exported {
            Some(exported) => exported.sym.clone(),
            None => named.orig.sym.clone(),
          };
          self.exports.entry(id!(named.orig)).or_insert(exported);
        }
        ExportSpecifier::Default(default) => {
          self
            .exports
            .entry(id!(default.exported))
            .or_insert(js_word!("default"));
        }
        ExportSpecifier::Namespace(namespace) => {
          self
            .exports
            .entry(id!(namespace.name))
            .or_insert("*".into());
        }
      }
    }
  }

  fn visit_export_decl(&mut self, node: &ExportDecl, _parent: &dyn Node) {
    match &node.decl {
      Decl::Class(class) => {
        self
          .exports
          .insert(id!(class.ident), class.ident.sym.clone());
      }
      Decl::Fn(func) => {
        self.exports.insert(id!(func.ident), func.ident.sym.clone());
      }
      Decl::Var(var) => {
        for decl in &var.decls {
          self.in_export_decl = true;
          decl.name.visit_with(decl, self);
          self.in_export_decl = false;

          decl.init.visit_with(decl, self);
        }
      }
      _ => {}
    }

    node.visit_children_with(self);
  }

  fn visit_export_default_decl(&mut self, node: &ExportDefaultDecl, _parent: &dyn Node) {
    match &node.decl {
      DefaultDecl::Class(class) => {
        if let Some(ident) = &class.ident {
          self.exports.insert(id!(ident), "default".into());
        }
      }
      DefaultDecl::Fn(func) => {
        if let Some(ident) = &func.ident {
          self.exports.insert(id!(ident), "default".into());
        }
      }
      _ => {
        unreachable!("unsupported export default declaration");
      }
    };

    node.visit_children_with(self);
  }

  fn visit_return_stmt(&mut self, node: &ReturnStmt, _parent: &dyn Node) {
    if !self.in_function {
      self.should_wrap = true;
    }

    node.visit_children_with(self)
  }

  fn visit_binding_ident(&mut self, node: &BindingIdent, _parent: &dyn Node) {
    if self.in_export_decl {
      self.exports.insert(id!(node.id), node.id.sym.clone());
    }

    if self.in_assign && node.id.span.ctxt() == self.global_ctxt {
      self
        .non_const_bindings
        .entry(id!(node.id))
        .or_default()
        .push(node.id.span);
    }
  }

  fn visit_assign_pat_prop(&mut self, node: &AssignPatProp, _parent: &dyn Node) {
    if self.in_export_decl {
      self.exports.insert(id!(node.key), node.key.sym.clone());
    }

    if self.in_assign && node.key.span.ctxt() == self.global_ctxt {
      self
        .non_const_bindings
        .entry(id!(node.key))
        .or_default()
        .push(node.key.span);
    }
  }

  fn visit_member_expr(&mut self, node: &MemberExpr, _parent: &dyn Node) {
    // if module.exports, ensure only assignment or static member expression
    // if exports, ensure only static member expression
    // if require, could be static access (handle in fold)

    if match_member_expr(&node, vec!["module", "exports"], &self.decls) {
      self.static_cjs_exports = false;
      self.has_cjs_exports = true;
      return;
    }

    if match_member_expr(&node, vec!["module", "hot"], &self.decls) {
      return;
    }

    let is_static = match &*node.prop {
      Expr::Ident(_) => !node.computed,
      Expr::Lit(lit) => match lit {
        Lit::Str(_) => true,
        _ => false,
      },
      _ => false,
    };

    match &node.obj {
      ExprOrSuper::Expr(expr) => {
        match &**expr {
          Expr::Member(member) => {
            if match_member_expr(&member, vec!["module", "exports"], &self.decls) {
              self.has_cjs_exports = true;
              if !is_static {
                self.static_cjs_exports = false;
              }
            }
            return;
          }
          Expr::Ident(ident) => {
            let exports: JsWord = "exports".into();
            if ident.sym == exports && !self.decls.contains(&id!(ident)) {
              self.has_cjs_exports = true;
              if !is_static {
                self.static_cjs_exports = false
              }
            }

            if ident.sym == js_word!("module") && !self.decls.contains(&id!(ident)) {
              self.has_cjs_exports = true;
              self.static_cjs_exports = false;
              self.should_wrap = true;
            }

            // `import` isn't really an identifier...
            if !is_static && ident.sym != js_word!("import") {
              self.non_static_access.insert(id!(ident));
            }
            return;
          }
          Expr::This(_this) => {
            if self.in_module_this {
              self.has_cjs_exports = true;
              if !is_static {
                self.static_cjs_exports = false;
              }
            }
            return;
          }
          _ => {}
        }
      }
      _ => {}
    }

    node.visit_children_with(self);
  }

  fn visit_unary_expr(&mut self, node: &UnaryExpr, _parent: &dyn Node) {
    if node.op == UnaryOp::TypeOf {
      match &*node.arg {
        Expr::Ident(ident)
          if ident.sym == js_word!("module") && !self.decls.contains(&id!(ident)) =>
        {
          // Do nothing to avoid the ident visitor from marking the module as non-static.
        }
        _ => node.visit_children_with(self),
      }
    }
  }

  fn visit_expr(&mut self, node: &Expr, _parent: &dyn Node) {
    // If we reached this visitor, this is a non-top-level require that isn't in a variable
    // declaration. We need to wrap the referenced module to preserve side effect ordering.
    if let Some(source) = self.match_require(node) {
      self.wrapped_requires.insert(source);
    }

    if let Some(source) = match_import(node, self.ignore_mark) {
      self.non_static_requires.insert(source.clone());
      self.wrapped_requires.insert(source);
    }

    match node {
      Expr::Ident(ident) => {
        // Bail if `module` or `exports` are accessed non-statically.
        let is_module = ident.sym == js_word!("module");
        let exports: JsWord = "exports".into();
        let is_exports = ident.sym == exports;
        if (is_module || is_exports) && !self.decls.contains(&id!(ident)) {
          self.has_cjs_exports = true;
          self.static_cjs_exports = false;
          if is_module {
            self.should_wrap = true;
          }
        }

        // `import` isn't really an identifier...
        if ident.sym != js_word!("import") {
          self.non_static_access.insert(id!(ident));
        }
      }
      _ => {
        node.visit_children_with(self);
      }
    }
  }

  fn visit_this_expr(&mut self, _node: &ThisExpr, _parent: &dyn Node) {
    if self.in_module_this {
      self.has_cjs_exports = true;
      self.static_cjs_exports = false;
    }
  }

  fn visit_assign_expr(&mut self, node: &AssignExpr, _parent: &dyn Node) {
    // if rhs is a require, record static accesses
    // if lhs is `exports`, mark as CJS exports re-assigned
    // if lhs is `module.exports`
    // if lhs is `module.exports.XXX` or `exports.XXX`, record static export

    self.in_assign = true;
    node.left.visit_with(node, self);
    self.in_assign = false;
    node.right.visit_with(node, self);

    match &node.left {
      PatOrExpr::Pat(pat) => {
        if has_binding_identifier(pat, &"exports".into(), &self.decls) {
          // Must wrap for cases like
          // ```
          // function logExports() {
          //   console.log(exports);
          // }
          // exports.test = 2;
          // logExports();
          // exports = {test: 4};
          // logExports();
          // ```
          self.static_cjs_exports = false;
          self.has_cjs_exports = true;
          self.should_wrap = true;
        }
      }
      _ => {}
    }
  }

  fn visit_var_declarator(&mut self, node: &VarDeclarator, _parent: &dyn Node) {
    // if init is a require call, record static accesses
    if let Some(init) = &node.init {
      if let Some(source) = self.match_require(init) {
        self.add_pat_imports(&node.name, &source, ImportKind::Require);
        return;
      }

      match &**init {
        Expr::Member(member) => {
          match &member.obj {
            ExprOrSuper::Expr(expr) => {
              if let Some(source) = self.match_require(&*expr) {
                // Convert member expression on require to a destructuring assignment.
                // const yx = require('y').x; -> const {x: yx} = require('x');
                let key = match &*member.prop {
                  Expr::Ident(ident) => {
                    if !member.computed {
                      PropName::Ident(ident.clone())
                    } else {
                      PropName::Computed(ComputedPropName {
                        span: DUMMY_SP,
                        expr: Box::new(*expr.clone()),
                      })
                    }
                  }
                  Expr::Lit(lit) => match lit {
                    Lit::Str(str_) => PropName::Str(str_.clone()),
                    _ => PropName::Computed(ComputedPropName {
                      span: DUMMY_SP,
                      expr: Box::new(*expr.clone()),
                    }),
                  },
                  _ => PropName::Computed(ComputedPropName {
                    span: DUMMY_SP,
                    expr: Box::new(*expr.clone()),
                  }),
                };

                self.add_pat_imports(
                  &Pat::Object(ObjectPat {
                    optional: false,
                    span: DUMMY_SP,
                    type_ann: None,
                    props: vec![ObjectPatProp::KeyValue(KeyValuePatProp {
                      key,
                      value: Box::new(node.name.clone()),
                    })],
                  }),
                  &source,
                  ImportKind::Require,
                );
                return;
              }
            }
            _ => {}
          }
        }
        Expr::Await(await_exp) => {
          // let x = await import('foo');
          // let {x} = await import('foo');
          if let Some(source) = match_import(&*await_exp.arg, self.ignore_mark) {
            self.add_pat_imports(&node.name, &source, ImportKind::DynamicImport);
            return;
          }
        }
        _ => {}
      }
    }

    // This is visited via visit_module_item with is_top_level == true, it needs to be
    // set to false for called visitors (and restored again).
    let in_top_level = self.in_top_level;
    self.in_top_level = false;
    node.visit_children_with(self);
    self.in_top_level = in_top_level;
  }

  fn visit_call_expr(&mut self, node: &CallExpr, _parent: &dyn Node) {
    match &node.callee {
      ExprOrSuper::Expr(expr) => {
        match &**expr {
          Expr::Ident(ident) => {
            if ident.sym == js_word!("eval") && !self.decls.contains(&id!(ident)) {
              self.should_wrap = true
            }
          }
          Expr::Member(member) => {
            // import('foo').then(foo => ...);
            if let ExprOrSuper::Expr(obj) = &member.obj {
              if let Some(source) = match_import(&*obj, self.ignore_mark) {
                let then: JsWord = "then".into();
                let is_then = match &*member.prop {
                  Expr::Ident(ident) => !member.computed && ident.sym == then,
                  Expr::Lit(lit) => match lit {
                    Lit::Str(str) => str.value == then,
                    _ => false,
                  },
                  _ => false,
                };

                if is_then {
                  match node.args.get(0) {
                    Some(ExprOrSpread { expr, .. }) => {
                      let param = match &**expr {
                        Expr::Fn(func) => match func.function.params.get(0) {
                          Some(param) => Some(&param.pat),
                          None => None,
                        },
                        Expr::Arrow(arrow) => arrow.params.get(0),
                        _ => None,
                      };

                      if let Some(param) = param {
                        self.add_pat_imports(param, &source, ImportKind::DynamicImport);
                      } else {
                        self.non_static_requires.insert(source.clone());
                        self.wrapped_requires.insert(source);
                      }

                      expr.visit_with(node, self);
                      return;
                    }
                    _ => {}
                  }
                }
              }
            }
          }
          _ => {}
        }
      }
      _ => {}
    }

    node.visit_children_with(self);
  }
}

impl Collect {
  pub fn match_require(&self, node: &Expr) -> Option<JsWord> {
    match_require(node, &self.decls, self.ignore_mark)
  }

  fn add_pat_imports(&mut self, node: &Pat, src: &JsWord, kind: ImportKind) {
    if !self.in_top_level {
      self.wrapped_requires.insert(src.clone());
      if kind != ImportKind::DynamicImport {
        self.non_static_requires.insert(src.clone());
      }
    }

    match node {
      Pat::Ident(ident) => {
        // let x = require('y');
        // Need to track member accesses of `x`.
        self.imports.insert(
          id!(ident.id),
          Import {
            source: src.clone(),
            specifier: "*".into(),
            kind,
            loc: SourceLocation::from(&self.source_map, ident.id.span),
          },
        );
      }
      Pat::Object(object) => {
        for prop in &object.props {
          match prop {
            ObjectPatProp::KeyValue(kv) => {
              let imported = match &kv.key {
                PropName::Ident(ident) => ident.sym.clone(),
                PropName::Str(str) => str.value.clone(),
                _ => {
                  // Non-static. E.g. computed property.
                  self.non_static_requires.insert(src.clone());
                  continue;
                }
              };

              match &*kv.value {
                Pat::Ident(ident) => {
                  // let {x: y} = require('y');
                  // Need to track `x` as a used symbol.
                  self.imports.insert(
                    id!(ident.id),
                    Import {
                      source: src.clone(),
                      specifier: imported,
                      kind,
                      loc: SourceLocation::from(&self.source_map, ident.id.span),
                    },
                  );

                  // Mark as non-constant. CJS exports can be mutated by other modules,
                  // so it's not safe to reference them directly.
                  self
                    .non_const_bindings
                    .entry(id!(ident.id))
                    .or_default()
                    .push(ident.id.span);
                }
                _ => {
                  // Non-static.
                  self.non_static_requires.insert(src.clone());
                }
              }
            }
            ObjectPatProp::Assign(assign) => {
              // let {x} = require('y');
              // let {x = 2} = require('y');
              // Need to track `x` as a used symbol.
              self.imports.insert(
                id!(assign.key),
                Import {
                  source: src.clone(),
                  specifier: assign.key.sym.clone(),
                  kind,
                  loc: SourceLocation::from(&self.source_map, assign.key.span),
                },
              );
              self
                .non_const_bindings
                .entry(id!(assign.key))
                .or_default()
                .push(assign.key.span);
            }
            ObjectPatProp::Rest(_rest) => {
              // let {x, ...y} = require('y');
              // Non-static. We don't know what keys are used.
              self.non_static_requires.insert(src.clone());
            }
          }
        }
      }
      _ => {
        // Non-static.
        self.non_static_requires.insert(src.clone());
      }
    }
  }

  fn get_non_const_binding_idents(&self, node: &Pat, idents: &mut HashSet<Ident>) {
    match node {
      Pat::Ident(ident) => {
        if self.non_const_bindings.contains_key(&id!(ident.id)) {
          idents.insert(ident.id.clone());
        }
      }
      Pat::Object(object) => {
        for prop in &object.props {
          match prop {
            ObjectPatProp::KeyValue(kv) => {
              self.get_non_const_binding_idents(&*kv.value, idents);
            }
            ObjectPatProp::Assign(assign) => {
              if self.non_const_bindings.contains_key(&id!(assign.key)) {
                idents.insert(assign.key.clone());
              }
            }
            ObjectPatProp::Rest(rest) => {
              self.get_non_const_binding_idents(&*rest.arg, idents);
            }
          }
        }
      }
      Pat::Array(array) => {
        for el in &array.elems {
          if let Some(el) = el {
            self.get_non_const_binding_idents(&el, idents);
          }
        }
      }
      _ => {}
    }
  }
}

fn is_marked(span: Span, mark: Mark) -> bool {
  let mut ctxt = span.ctxt().clone();

  loop {
    let m = ctxt.remove_mark();
    if m == Mark::root() {
      return false;
    }

    if m == mark {
      return true;
    }
  }
}

fn match_require(node: &Expr, decls: &HashSet<IdentId>, ignore_mark: Mark) -> Option<JsWord> {
  match node {
    Expr::Call(call) => match &call.callee {
      ExprOrSuper::Expr(expr) => match &**expr {
        Expr::Ident(ident) => {
          if ident.sym == js_word!("require")
            && !decls.contains(&id!(ident))
            && !is_marked(ident.span, ignore_mark)
          {
            if let Some(arg) = call.args.get(0) {
              if let Expr::Lit(lit) = &*arg.expr {
                if let Lit::Str(str_) = lit {
                  return Some(str_.value.clone());
                }
              }
            }
          }

          None
        }
        _ => None,
      },
      _ => None,
    },
    _ => None,
  }
}

fn match_import(node: &Expr, ignore_mark: Mark) -> Option<JsWord> {
  match node {
    Expr::Call(call) => match &call.callee {
      ExprOrSuper::Expr(expr) => match &**expr {
        Expr::Ident(ident) => {
          if ident.sym == js_word!("import") && !is_marked(ident.span, ignore_mark) {
            if let Some(arg) = call.args.get(0) {
              if let Expr::Lit(lit) = &*arg.expr {
                if let Lit::Str(str_) = lit {
                  return Some(str_.value.clone());
                }
              }
            }
          }

          None
        }
        _ => None,
      },
      _ => None,
    },
    _ => None,
  }
}

fn has_binding_identifier(node: &Pat, sym: &JsWord, decls: &HashSet<IdentId>) -> bool {
  match node {
    Pat::Ident(ident) => {
      if ident.id.sym == *sym && !decls.contains(&id!(ident.id)) {
        return true;
      }
    }
    Pat::Object(object) => {
      for prop in &object.props {
        match prop {
          ObjectPatProp::KeyValue(kv) => {
            if has_binding_identifier(&*kv.value, sym, decls) {
              return true;
            }
          }
          ObjectPatProp::Assign(assign) => {
            if assign.key.sym == *sym && !decls.contains(&id!(assign.key)) {
              return true;
            }
          }
          ObjectPatProp::Rest(rest) => {
            if has_binding_identifier(&*rest.arg, sym, decls) {
              return true;
            }
          }
        }
      }
    }
    Pat::Array(array) => {
      for el in &array.elems {
        if let Some(el) = el {
          if has_binding_identifier(&el, sym, decls) {
            return true;
          }
        }
      }
    }
    _ => {}
  }

  false
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::collect_decls;
  use std::iter::FromIterator;
  use swc_common::comments::SingleThreadedComments;
  use swc_common::{sync::Lrc, FileName, Globals, Mark, SourceMap, DUMMY_SP};
  use swc_ecmascript::codegen::text_writer::JsWriter;
  use swc_ecmascript::parser::lexer::Lexer;
  use swc_ecmascript::parser::{EsConfig, Parser, StringInput, Syntax};
  use swc_ecmascript::transforms::resolver_with_mark;
  extern crate indoc;
  use self::indoc::indoc;

  fn parse(code: &str) -> (Collect, String, HoistResult) {
    let source_map = Lrc::new(SourceMap::default());
    let source_file = source_map.new_source_file(FileName::Anon, code.into());

    let comments = SingleThreadedComments::default();
    let mut esconfig = EsConfig::default();
    esconfig.dynamic_import = true;
    let lexer = Lexer::new(
      Syntax::Es(esconfig),
      Default::default(),
      StringInput::from(&*source_file),
      Some(&comments),
    );

    let mut parser = Parser::new_from(lexer);
    match parser.parse_module() {
      Ok(module) => swc_common::GLOBALS.set(&Globals::new(), || {
        swc_ecmascript::transforms::helpers::HELPERS.set(
          &swc_ecmascript::transforms::helpers::Helpers::new(false),
          || {
            let global_mark = Mark::fresh(Mark::root());
            let module = module.fold_with(&mut resolver_with_mark(global_mark));

            let mut collect = Collect::new(
              source_map.clone(),
              collect_decls(&module),
              Mark::fresh(Mark::root()),
              global_mark,
            );
            module.visit_with(&Invalid { span: DUMMY_SP } as _, &mut collect);

            let (module, res) = {
              let mut hoist = Hoist::new("abc", &collect);
              let module = module.fold_with(&mut hoist);
              (module, hoist.get_result())
            };
            let code = emit(source_map, comments, &module);
            (collect, code, res)
          },
        )
      }),
      Err(err) => {
        panic!("{:?}", err);
      }
    }
  }

  fn emit(
    source_map: Lrc<SourceMap>,
    comments: SingleThreadedComments,
    program: &Module,
  ) -> String {
    let mut src_map_buf = vec![];
    let mut buf = vec![];
    {
      let writer = Box::new(JsWriter::new(
        source_map.clone(),
        "\n",
        &mut buf,
        Some(&mut src_map_buf),
      ));
      let config = swc_ecmascript::codegen::Config { minify: false };
      let mut emitter = swc_ecmascript::codegen::Emitter {
        cfg: config,
        comments: Some(&comments),
        cm: source_map.clone(),
        wr: writer,
      };

      emitter.emit_module(&program).unwrap();
    }

    return String::from_utf8(buf).unwrap();
  }

  macro_rules! map(
    { $($key:expr => $value:expr),* } => {
      {
        #[allow(unused_mut)]
        let mut m = HashMap::new();
        $(
          m.insert($key, $value);
        )*
        m
      }
    };
  );

  macro_rules! set(
    { $($key:expr),* } => {
      {
        #[allow(unused_mut)]
        let mut m = HashSet::new();
        $(
          m.insert($key);
        )*
        m
      }
    };
  );

  macro_rules! w {
    ($s: expr) => {{
      let w: JsWord = $s.into();
      w
    }};
  }

  macro_rules! assert_eq_imports {
    ($m: expr, $match: expr) => {{
      let mut map = HashMap::new();
      for (key, val) in $m {
        map.insert(
          key.0,
          (
            val.source,
            val.specifier,
            val.kind == ImportKind::DynamicImport,
          ),
        );
      }
      assert_eq!(map, $match);
    }};
  }

  macro_rules! assert_eq_imported_symbols {
    ($m: expr, $match: expr) => {{
      let mut map = HashMap::new();
      for (key, val) in $m {
        map.insert(key, (val.0, val.1));
      }
      assert_eq!(map, $match);
    }};
  }

  macro_rules! assert_eq_set {
    ($m: expr, $match: expr) => {{
      let mut map = HashSet::new();
      for item in $m {
        map.insert(item.0);
      }
      assert_eq!(map, $match);
    }};
  }

  #[test]
  fn esm() {
    let (collect, _code, _hoist) = parse(
      r#"
    import {foo as bar} from 'other';
    export {bar as test};
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("bar") => (w!("other"), w!("foo"), false) }
    );
  }

  #[test]
  fn cjs_namespace() {
    let (collect, _code, _hoist) = parse(
      r#"
    const x = require('other');
    console.log(x.foo);
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("x") => (w!("other"), w!("*"), false) }
    );
    assert_eq!(collect.non_static_access, set! {});
  }

  #[test]
  fn cjs_namespace_non_static() {
    let (collect, _code, _hoist) = parse(
      r#"
    const x = require('other');
    console.log(x[foo]);
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("x") => (w!("other"), w!("*"), false) }
    );
    assert_eq_set!(collect.non_static_access, set! { w!("x") });

    let (collect, _code, _hoist) = parse(
      r#"
    const x = require('other');
    console.log(x);
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("x") => (w!("other"), w!("*"), false) }
    );
    assert_eq_set!(collect.non_static_access, set! { w!("x") });
  }

  #[test]
  fn cjs_destructure() {
    let (collect, _code, _hoist) = parse(
      r#"
    const {foo: bar} = require('other');
    exports.test = bar;
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("bar") => (w!("other"), w!("foo"), false) }
    );
    assert_eq!(collect.static_cjs_exports, true);
  }

  #[test]
  fn cjs_reassign() {
    let (collect, _code, _hoist) = parse(
      r#"
    exports = 2;
    "#,
    );
    assert_eq!(collect.should_wrap, true);
  }

  #[test]
  fn should_wrap() {
    let (collect, _code, _hoist) = parse(
      r#"
    eval('');
    "#,
    );
    assert_eq!(collect.should_wrap, true);

    let (collect, _code, _hoist) = parse(
      r#"
    doSomething(module);
    "#,
    );
    assert_eq!(collect.should_wrap, true);

    let (collect, _code, _hoist) = parse(
      r#"
    console.log(module.id);
    "#,
    );
    assert_eq!(collect.should_wrap, true);

    let (collect, _code, _hoist) = parse(
      r#"
    console.log(typeof module);
    console.log(module.hot);
    "#,
    );
    assert_eq!(collect.should_wrap, false);

    let (collect, _code, _hoist) = parse(
      r#"
    exports.foo = 2;
    return;
    exports.bar = 3;
    "#,
    );
    assert_eq!(collect.should_wrap, true);
  }

  #[test]
  fn cjs_non_static_exports() {
    let (collect, _code, _hoist) = parse(
      r#"
    exports[test] = 2;
    "#,
    );
    assert_eq!(collect.static_cjs_exports, false);

    let (collect, _code, _hoist) = parse(
      r#"
    module.exports[test] = 2;
    "#,
    );
    assert_eq!(collect.static_cjs_exports, false);

    let (collect, _code, _hoist) = parse(
      r#"
    this[test] = 2;
    "#,
    );
    assert_eq!(collect.static_cjs_exports, false);

    let (collect, _code, _hoist) = parse(
      r#"
    module.exports[test] = 2;
    "#,
    );
    assert_eq!(collect.static_cjs_exports, false);

    let (collect, _code, _hoist) = parse(
      r#"
    alert(exports)
    "#,
    );
    assert_eq!(collect.static_cjs_exports, false);

    let (collect, _code, _hoist) = parse(
      r#"
    alert(module.exports)
    "#,
    );
    assert_eq!(collect.static_cjs_exports, false);

    let (collect, _code, _hoist) = parse(
      r#"
    alert(this)
    "#,
    );
    assert_eq!(collect.static_cjs_exports, false);

    let (collect, _code, _hoist) = parse(
      r#"
    exports.foo = 2;
    "#,
    );
    assert_eq!(collect.static_cjs_exports, true);

    let (collect, _code, _hoist) = parse(
      r#"
    module.exports.foo = 2;
    "#,
    );
    assert_eq!(collect.static_cjs_exports, true);

    let (collect, _code, _hoist) = parse(
      r#"
    this.foo = 2;
    "#,
    );
    assert_eq!(collect.static_cjs_exports, true);

    let (collect, _code, _hoist) = parse(
      r#"
    var exports = {};
    exports[foo] = 2;
    "#,
    );
    assert_eq!(collect.static_cjs_exports, true);

    let (collect, _code, _hoist) = parse(
      r#"
    var module = {exports: {}};
    module.exports[foo] = 2;
    "#,
    );
    assert_eq!(collect.static_cjs_exports, true);

    let (collect, _code, _hoist) = parse(
      r#"
    test(function(exports) { return Object.keys(exports) })
    "#,
    );
    assert_eq!(collect.static_cjs_exports, true);

    let (collect, _code, _hoist) = parse(
      r#"
    test(exports => Object.keys(exports))
    "#,
    );
    assert_eq!(collect.static_cjs_exports, true);
  }

  #[test]
  fn dynamic_import() {
    let (collect, _code, _hoist) = parse(
      r#"
    async function test() {
      const x = await import('other');
      x.foo;
    }
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("x") => (w!("other"), w!("*"), true) }
    );
    assert_eq_set!(collect.non_static_access, set! {});
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    async function test() {
      const x = await import('other');
      x[foo];
    }
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("x") => (w!("other"), w!("*"), true) }
    );
    assert_eq_set!(collect.non_static_access, set! { w!("x") });
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    async function test() {
      const {foo} = await import('other');
    }
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("foo") => (w!("other"), w!("foo"), true) }
    );
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    async function test() {
      const {foo: bar} = await import('other');
    }
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("bar") => (w!("other"), w!("foo"), true) }
    );
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    import('other').then(x => x.foo);
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("x") => (w!("other"), w!("*"), true) }
    );
    assert_eq_set!(collect.non_static_access, set! {});
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    import('other').then(x => x);
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("x") => (w!("other"), w!("*"), true) }
    );
    assert_eq_set!(collect.non_static_access, set! { w!("x") });
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    import('other').then(({foo}) => foo);
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("foo") => (w!("other"), w!("foo"), true) }
    );
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    import('other').then(({foo: bar}) => bar);
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("bar") => (w!("other"), w!("foo"), true) }
    );
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    import('other').then(function (x) { return x.foo });
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("x") => (w!("other"), w!("*"), true) }
    );
    assert_eq_set!(collect.non_static_access, set! {});
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    import('other').then(function (x) { return x });
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("x") => (w!("other"), w!("*"), true) }
    );
    assert_eq_set!(collect.non_static_access, set! { w!("x") });
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    import('other').then(function ({foo}) {});
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("foo") => (w!("other"), w!("foo"), true) }
    );
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    import('other').then(function ({foo: bar}) {});
    "#,
    );
    assert_eq_imports!(
      collect.imports,
      map! { w!("bar") => (w!("other"), w!("foo"), true) }
    );
    assert_eq!(collect.non_static_requires, set! {});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    import('other');
    "#,
    );
    assert_eq_imports!(collect.imports, map! {});
    assert_eq!(collect.non_static_requires, set! {w!("other")});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    let other = import('other');
    "#,
    );
    assert_eq_imports!(collect.imports, map! {});
    assert_eq!(collect.non_static_requires, set! {w!("other")});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});

    let (collect, _code, _hoist) = parse(
      r#"
    async function test() {
      let {...other} = await import('other');
    }
    "#,
    );
    assert_eq_imports!(collect.imports, map! {});
    assert_eq!(collect.non_static_requires, set! {w!("other")});
    assert_eq!(collect.wrapped_requires, set! {w!("other")});
  }

  #[test]
  fn fold_import() {
    let (_collect, code, _hoist) = parse(
      r#"
    import {foo as bar} from 'other';
    let test = {bar: 3};
    console.log(bar, test.bar);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    let $abc$var$test = {
        bar: 3
    };
    console.log($abc$import$558d6cfb8af8a010$ba02ad2230917043, $abc$var$test.bar);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    import * as foo from 'other';
    console.log(foo.bar);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    console.log($abc$import$558d6cfb8af8a010$3705fc5f2281438d);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    import other from 'other';
    console.log(other, other.bar);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    console.log($abc$import$558d6cfb8af8a010$9099ad97b570f7c, $abc$import$558d6cfb8af8a010$9099ad97b570f7c.bar);
    "#}
    );
  }

  #[test]
  fn fold_import_hoist() {
    let (_collect, code, _hoist) = parse(
      r#"
    import foo from 'other';
    console.log(foo);
    import bar from 'bar';
    console.log(bar);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    import   "abc:bar";
    console.log($abc$import$558d6cfb8af8a010$9099ad97b570f7c);
    console.log($abc$import$3705fc5f2281438d$9099ad97b570f7c);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    import foo from 'other';
    console.log(foo);
    const x = require('x');
    console.log(x);
    import bar from 'bar';
    console.log(bar);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    import   "abc:bar";
    console.log($abc$import$558d6cfb8af8a010$9099ad97b570f7c);
    import   "abc:x";
    console.log($abc$import$10b1f2ceae7ab64e);
    console.log($abc$import$3705fc5f2281438d$9099ad97b570f7c);
    "#}
    );
  }

  #[test]
  fn fold_static_require() {
    let (_collect, code, _hoist) = parse(
      r#"
    const x = 4, {bar} = require('other'), baz = 3;
    console.log(bar);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    const $abc$var$x = 4;
    import   "abc:other";
    var $abc$require$bar = $abc$import$558d6cfb8af8a010$3705fc5f2281438d;
    const $abc$var$baz = 3;
    console.log($abc$require$bar);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    const x = 3, foo = require('other'), bar = 2;
    console.log(foo.bar);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    const $abc$var$x = 3;
    import   "abc:other";
    const $abc$var$bar = 2;
    console.log($abc$import$558d6cfb8af8a010$3705fc5f2281438d);
    "#}
    );
  }

  #[test]
  fn fold_non_static_require() {
    let (_collect, code, _hoist) = parse(
      r#"
    const {foo, ...bar} = require('other');
    console.log(foo, bar);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    const { foo: $abc$var$foo , ...$abc$var$bar } = $abc$import$558d6cfb8af8a010;
    console.log($abc$var$foo, $abc$var$bar);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    const {x: {y: z}} = require('x');
    console.log(z);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:x";
    const { x: { y: $abc$var$z  }  } = $abc$import$10b1f2ceae7ab64e;
    console.log($abc$var$z);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    const foo = require('other');
    console.log(foo[bar]);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    console.log($abc$import$558d6cfb8af8a010[bar]);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    const foo = require('other');
    console.log(foo[bar], foo.baz);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    console.log($abc$import$558d6cfb8af8a010[bar], $abc$import$558d6cfb8af8a010.baz);
    "#}
    );
  }

  #[test]
  fn fold_require_member() {
    // let (_collect, code, _hoist) = parse(r#"
    // let foo;
    // ({foo} = require('other'));
    // console.log(foo);
    // "#);

    // println!("{}", code);

    let (_collect, code, _hoist) = parse(
      r#"
    const foo = require('other').foo;
    console.log(foo);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    var $abc$require$foo = $abc$import$558d6cfb8af8a010$ba02ad2230917043;
    console.log($abc$require$foo);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    const foo = require('other')[bar];
    console.log(foo);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    const $abc$var$foo = $abc$import$558d6cfb8af8a010[bar];
    console.log($abc$var$foo);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    const {foo} = require('other').foo;
    console.log(foo);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    const { foo: $abc$var$foo  } = $abc$import$558d6cfb8af8a010$ba02ad2230917043;
    console.log($abc$var$foo);
    "#}
    );
  }

  #[test]
  fn fold_require_wrapped() {
    let (_collect, code, hoist) = parse(
      r#"
    function x() {
      const foo = require('other');
      console.log(foo.bar);
    }
    require('bar');
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    function $abc$var$x() {
        const foo = $abc$import$558d6cfb8af8a010;
        console.log(foo.bar);
    }
    import   "abc:bar";
    $abc$import$3705fc5f2281438d;
    "#}
    );
    assert_eq!(
      hoist.wrapped_requires,
      HashSet::<JsWord>::from_iter(vec![JsWord::from("other")])
    );

    let (_collect, code, hoist) = parse(
      r#"
    var foo = (function () {
      if (Date.now() < 0) {
        var bar = require("other");
      }
    })();
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    var $abc$var$foo = (function() {
        if (Date.now() < 0) {
            var bar = $abc$import$558d6cfb8af8a010;
        }
    })();
    "#}
    );
    assert_eq!(
      hoist.wrapped_requires,
      HashSet::<JsWord>::from_iter(vec![JsWord::from("other")])
    );

    let (_collect, code, _hoist) = parse(
      r#"
    function x() {
      const foo = require('other').foo;
      console.log(foo);
    }
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    function $abc$var$x() {
        const foo = $abc$import$558d6cfb8af8a010$ba02ad2230917043;
        console.log(foo);
    }
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    function x() {
      console.log(require('other').foo);
    }
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    function $abc$var$x() {
        console.log($abc$import$558d6cfb8af8a010$ba02ad2230917043);
    }
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    function x() {
      const foo = require('other')[test];
      console.log(foo);
    }
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    function $abc$var$x() {
        const foo = $abc$import$558d6cfb8af8a010[test];
        console.log(foo);
    }
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    function x() {
      const {foo} = require('other');
      console.log(foo);
    }
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    function $abc$var$x() {
        const { foo: foo  } = $abc$import$558d6cfb8af8a010;
        console.log(foo);
    }
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    let x = require('a') + require('b');
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:a";
    import   "abc:b";
    let $abc$var$x = $abc$import$7ac649919d1c80a6 + $abc$import$a91ade93898ecc38;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    let x = (require('a'), require('b'));
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:a";
    import   "abc:b";
    let $abc$var$x = (!$abc$import$7ac649919d1c80a6, $abc$import$a91ade93898ecc38);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    let x = require('a') || require('b');
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:a";
    import   "abc:b";
    let $abc$var$x = $abc$import$7ac649919d1c80a6 || $abc$import$a91ade93898ecc38;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    let x = condition ? require('a') : require('b');
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:a";
    import   "abc:b";
    let $abc$var$x = condition ? $abc$import$7ac649919d1c80a6 : $abc$import$a91ade93898ecc38;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    if (condition) require('a');
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:a";
    if (condition) $abc$import$7ac649919d1c80a6;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    for (let x = require('y'); x < 5; x++) {}
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:y";
    for(let x = $abc$import$57bbd0ca114c72e; x < 5; x++){
    }
    "#}
    );
  }

  #[test]
  fn fold_export() {
    let (_collect, code, _hoist) = parse(
      r#"
    let x = 3;
    let y = 4;
    let z = 6;
    export {x, y};
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    let $abc$export$10b1f2ceae7ab64e = 3;
    let $abc$export$57bbd0ca114c72e = 4;
    let $abc$var$z = 6;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    export default 3;
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    var $abc$export$9099ad97b570f7c = 3;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    let x = 3;
    export default x;
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    let $abc$var$x = 3;
    var $abc$export$9099ad97b570f7c = $abc$var$x;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    export default function () {}
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    function $abc$export$9099ad97b570f7c() {
    }
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    export default class {}
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    class $abc$export$9099ad97b570f7c {
    }
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    export var x = 2, y = 3;
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    var $abc$export$10b1f2ceae7ab64e = 2, $abc$export$57bbd0ca114c72e = 3;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    export var {x, ...y} = something;
    export var [p, ...q] = something;
    export var {x = 3} = something;
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    var { x: $abc$export$10b1f2ceae7ab64e , ...$abc$export$57bbd0ca114c72e } = something;
    var [$abc$export$e809c7c5e035fc81, ...$abc$export$51cf687b896afa97] = something;
    var { x: $abc$export$10b1f2ceae7ab64e = 3  } = something;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    export function test() {}
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    function $abc$export$fdd70aeca3bc8cbb() {
    }
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    export class Test {}
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    class $abc$export$785fc6237f113e49 {
    }
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    export {foo} from 'bar';
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:bar";
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    export * from 'bar';
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:bar";
    "#}
    );
  }

  #[test]
  fn fold_cjs_export() {
    let (_collect, code, _hoist) = parse(
      r#"
    exports.foo = 2;
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    var $abc$export$ba02ad2230917043;
    $abc$export$ba02ad2230917043 = 2;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    exports['foo'] = 2;
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    var $abc$export$ba02ad2230917043;
    $abc$export$ba02ad2230917043 = 2;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    function init() {
      exports.foo = 2;
    }
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    var $abc$export$ba02ad2230917043;
    function $abc$var$init() {
        $abc$export$ba02ad2230917043 = 2;
    }
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    module.exports.foo = 2;
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    var $abc$export$ba02ad2230917043;
    $abc$export$ba02ad2230917043 = 2;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    module.exports['foo'] = 2;
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    var $abc$export$ba02ad2230917043;
    $abc$export$ba02ad2230917043 = 2;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    exports.foo = 2;
    console.log(exports.foo)
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    var $abc$export$ba02ad2230917043;
    $abc$export$ba02ad2230917043 = 2;
    console.log($abc$export$ba02ad2230917043);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    module.exports.foo = 2;
    console.log(module.exports.foo)
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    var $abc$export$ba02ad2230917043;
    $abc$export$ba02ad2230917043 = 2;
    console.log($abc$export$ba02ad2230917043);
    "#}
    );
  }

  #[test]
  fn fold_cjs_export_non_static() {
    let (_collect, code, _hoist) = parse(
      r#"
    exports[foo] = 2;
    exports.bar = 3;
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    $abc$exports[foo] = 2;
    $abc$exports.bar = 3;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    module.exports[foo] = 2;
    module.exports.bar = 3;
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    $abc$exports[foo] = 2;
    $abc$exports.bar = 3;
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    exports.foo = 2;
    sideEffects(exports);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    $abc$exports.foo = 2;
    sideEffects($abc$exports);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    exports.foo = 2;
    sideEffects(module.exports);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    $abc$exports.foo = 2;
    sideEffects($abc$exports);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    exports[foo] = 2;
    console.log(exports[foo]);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    $abc$exports[foo] = 2;
    console.log($abc$exports[foo]);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    exports[foo] = 2;
    console.log(exports.foo);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    $abc$exports[foo] = 2;
    console.log($abc$exports.foo);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    module.exports[foo] = 2;
    console.log(module.exports[foo]);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    $abc$exports[foo] = 2;
    console.log($abc$exports[foo]);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    module.exports[foo] = 2;
    console.log(module.exports.foo);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    $abc$exports[foo] = 2;
    console.log($abc$exports.foo);
    "#}
    );

    let (_collect, code, _hoist) = parse(
      r#"
    var module = {exports: {}};
    module.exports.foo = 2;
    console.log(module.exports.foo);
    "#,
    );

    assert_eq!(
      code,
      indoc! {r#"
    var $abc$var$module = {
        exports: {
        }
    };
    $abc$var$module.exports.foo = 2;
    console.log($abc$var$module.exports.foo);
    "#}
    );
  }

  #[test]
  fn fold_dynamic_import() {
    let (_collect, code, hoist) = parse(
      r#"
    async function test() {
      const x = await import('other');
      console.log(x.foo);
    }
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010$ba02ad2230917043") => (w!("other"), w!("foo"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    async function $abc$var$test() {
        const x = await $abc$importAsync$558d6cfb8af8a010;
        console.log(x.foo);
    }
    "#}
    );

    let (_collect, code, hoist) = parse(
      r#"
    async function test() {
      const x = await import('other');
      console.log(x[foo]);
    }
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => (w!("other"), w!("*"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    async function $abc$var$test() {
        const x = await $abc$importAsync$558d6cfb8af8a010;
        console.log(x[foo]);
    }
    "#}
    );

    let (_collect, code, hoist) = parse(
      r#"
    async function test() {
      const {foo} = await import('other');
      console.log(foo);
    }
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010$ba02ad2230917043") => (w!("other"), w!("foo"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    async function $abc$var$test() {
        const { foo: foo  } = await $abc$importAsync$558d6cfb8af8a010;
        console.log(foo);
    }
    "#}
    );

    let (_collect, code, hoist) = parse(
      r#"
    async function test() {
      const {foo: bar} = await import('other');
      console.log(bar);
    }
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010$ba02ad2230917043") => (w!("other"), w!("foo"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    async function $abc$var$test() {
        const { foo: bar  } = await $abc$importAsync$558d6cfb8af8a010;
        console.log(bar);
    }
    "#}
    );

    let (_collect, code, hoist) = parse(
      r#"
    import('other').then(x => x.foo);
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010$ba02ad2230917043") => (w!("other"), w!("foo"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    $abc$importAsync$558d6cfb8af8a010.then((x)=>x.foo
    );
    "#}
    );

    let (_collect, code, hoist) = parse(
      r#"
    import('other').then(x => x);
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => (w!("other"), w!("*"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    $abc$importAsync$558d6cfb8af8a010.then((x)=>x
    );
    "#}
    );

    let (_collect, code, hoist) = parse(
      r#"
    import('other').then(({foo}) => foo);
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010$ba02ad2230917043") => (w!("other"), w!("foo"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    $abc$importAsync$558d6cfb8af8a010.then(({ foo: foo  })=>foo
    );
    "#}
    );

    let (_collect, code, hoist) = parse(
      r#"
    import('other').then(({foo: bar}) => bar);
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010$ba02ad2230917043") => (w!("other"), w!("foo"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    $abc$importAsync$558d6cfb8af8a010.then(({ foo: bar  })=>bar
    );
    "#}
    );

    let (_collect, code, hoist) = parse(
      r#"
    import('other').then(function (x) { return x.foo });
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010$ba02ad2230917043") => (w!("other"), w!("foo"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    $abc$importAsync$558d6cfb8af8a010.then(function(x) {
        return x.foo;
    });
    "#}
    );

    let (_collect, code, hoist) = parse(
      r#"
    import('other').then(function (x) { return x });
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => (w!("other"), w!("*"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    $abc$importAsync$558d6cfb8af8a010.then(function(x) {
        return x;
    });
    "#}
    );

    let (_collect, code, hoist) = parse(
      r#"
    import('other').then(function ({foo}) {});
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010$ba02ad2230917043") => (w!("other"), w!("foo"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    $abc$importAsync$558d6cfb8af8a010.then(function({ foo: foo  }) {
    });
    "#}
    );

    let (_collect, code, hoist) = parse(
      r#"
    import('other').then(function ({foo: bar}) {});
    "#,
    );
    assert_eq_imported_symbols!(
      hoist.imported_symbols,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010$ba02ad2230917043") => (w!("other"), w!("foo"))
      }
    );
    assert_eq!(
      hoist.dynamic_imports,
      map! {
        w!("$abc$importAsync$558d6cfb8af8a010") => w!("other")
      }
    );
    assert_eq!(
      code,
      indoc! {r#"
    import   "abc:other";
    $abc$importAsync$558d6cfb8af8a010.then(function({ foo: bar  }) {
    });
    "#}
    );
  }

  #[test]
  fn fold_hoist_vars() {
    let (_collect, code, _hoist) = parse(
      r#"
    var x = 2;
    var y = {x};
    var z = {x: 3};
    var w = {[x]: 4};

    function test() {
      var x = 3;
    }
    "#,
    );
    assert_eq!(
      code,
      indoc! {r#"
    var $abc$var$x = 2;
    var $abc$var$y = {
        x: $abc$var$x
    };
    var $abc$var$z = {
        x: 3
    };
    var $abc$var$w = {
        [$abc$var$x]: 4
    };
    function $abc$var$test() {
        var x = 3;
    }
    "#}
    );
  }

  #[test]
  fn fold_cjs_objects() {
    let (_collect, code, _hoist) = parse(
      r#"
    console.log(typeof module);
    console.log(typeof require);
    console.log(module.hot);
    "#,
    );
    assert_eq!(
      code,
      indoc! {r#"
    console.log("object");
    console.log("function");
    console.log(null);
    "#}
    );
  }
}
