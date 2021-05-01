use inflector::Inflector;
use std::collections::{HashMap, HashSet};
use swc_atoms::JsWord;
use swc_common::{Mark, Span, SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast::*;
use swc_ecmascript::visit::{Fold, FoldWith};

type IdentId = (JsWord, SyntaxContext);
macro_rules! id {
  ($ident: expr) => {
    ($ident.sym.clone(), $ident.span.ctxt)
  };
}

pub fn esm2cjs(node: Module) -> (Module, bool) {
  let mut fold = ESMFold {
    imports: HashMap::new(),
    require_names: HashMap::new(),
    interops: HashSet::new(),
    requires: vec![],
    exports: vec![],
    needs_helpers: false,
    in_export_decl: false,
    in_function_scope: false,
    mark: Mark::fresh(Mark::root()),
  };

  let module = node.fold_with(&mut fold);
  (module, fold.needs_helpers)
}

struct ESMFold {
  // Map of imported identifier to (source, specifier)
  imports: HashMap<IdentId, (JsWord, JsWord)>,
  // Map of source to (require identifier, mark)
  require_names: HashMap<JsWord, (JsWord, Mark)>,
  // Set of declared default interops, by source.
  interops: HashSet<JsWord>,
  // List of requires to insert at the top of the module.
  requires: Vec<ModuleItem>,
  // List of exports to add.
  exports: Vec<ModuleItem>,
  needs_helpers: bool,
  in_export_decl: bool,
  in_function_scope: bool,
  mark: Mark,
}

fn local_name_for_src(src: &JsWord) -> JsWord {
  if !src.contains('/') {
    return format!("_{}", src.to_camel_case()).into();
  }

  format!("_{}", src.split('/').last().unwrap().to_camel_case()).into()
}

impl ESMFold {
  fn get_require_name(&mut self, src: &JsWord, span: Span) -> Ident {
    if let Some((name, mark)) = self.require_names.get(src) {
      return Ident::new(
        name.clone(),
        span.with_ctxt(SyntaxContext::empty()).apply_mark(*mark),
      );
    }

    let name = local_name_for_src(src);
    let mark = Mark::fresh(Mark::root());
    self.require_names.insert(src.clone(), (name.clone(), mark));
    Ident::new(
      name,
      span.with_ctxt(SyntaxContext::empty()).apply_mark(mark),
    )
  }

  fn get_interop_default_name(&mut self, src: &JsWord) -> Ident {
    self.get_require_name(src, DUMMY_SP);
    let (name, mark) = self.require_names.get(src).unwrap();
    Ident::new(
      format!("{}Default", name).into(),
      DUMMY_SP.apply_mark(*mark),
    )
  }

  fn create_require(&mut self, src: JsWord, span: Span) {
    if self.require_names.contains_key(&src) {
      return;
    }

    let ident = self.get_require_name(&src, DUMMY_SP);
    let require = ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
      span: span,
      kind: VarDeclKind::Var,
      decls: vec![VarDeclarator {
        span: DUMMY_SP,
        name: Pat::Ident(ident.into()),
        init: Some(Box::new(Expr::Call(crate::utils::create_require(src)))),
        definite: false,
      }],
      declare: false,
    })));

    self.requires.push(require)
  }

  fn create_interop_default(&mut self, src: JsWord) {
    if self.interops.contains(&src) {
      return;
    }

    let local = self.get_require_name(&src, DUMMY_SP);
    let ident = self.get_interop_default_name(&src);
    let interop = ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
      span: DUMMY_SP,
      kind: VarDeclKind::Var,
      decls: vec![VarDeclarator {
        span: DUMMY_SP,
        name: Pat::Ident(ident.into()),
        init: Some(Box::new(self.create_helper_call(
          "interopDefault".into(),
          vec![Expr::Ident(local)],
          DUMMY_SP,
        ))),
        definite: false,
      }],
      declare: false,
    })));

    self.requires.push(interop);
    self.interops.insert(src);
  }

  fn create_helper_call(&mut self, name: JsWord, args: Vec<Expr>, span: Span) -> Expr {
    self.needs_helpers = true;
    let ident = Ident::new("parcelHelpers".into(), DUMMY_SP.apply_mark(self.mark));
    Expr::Call(CallExpr {
      callee: ExprOrSuper::Expr(Box::new(Expr::Member(MemberExpr {
        obj: ExprOrSuper::Expr(Box::new(Expr::Ident(ident))),
        prop: Box::new(Expr::Ident(Ident::new(name, DUMMY_SP))),
        computed: false,
        span: DUMMY_SP,
      }))),
      args: args
        .iter()
        .map(|arg| ExprOrSpread {
          expr: Box::new(arg.clone()),
          spread: None,
        })
        .collect(),
      span,
      type_args: None,
    })
  }

  fn call_helper(&mut self, name: JsWord, args: Vec<Expr>, span: Span) -> ModuleItem {
    ModuleItem::Stmt(Stmt::Expr(ExprStmt {
      expr: Box::new(self.create_helper_call(name, args, span)),
      span,
    }))
  }

  fn create_export(&mut self, exported: JsWord, local: Expr, span: Span) {
    let export = self.call_helper(
      js_word!("export"),
      vec![
        Expr::Ident(Ident::new("exports".into(), DUMMY_SP)),
        Expr::Lit(Lit::Str(Str {
          value: exported,
          has_escape: false,
          kind: StrKind::Synthesized,
          span: DUMMY_SP,
        })),
        Expr::Arrow(ArrowExpr {
          body: BlockStmtOrExpr::Expr(Box::new(local)),
          is_async: false,
          is_generator: false,
          params: vec![],
          span: DUMMY_SP,
          return_type: None,
          type_params: None,
        }),
      ],
      span,
    );
    self.exports.push(export)
  }

  fn create_exports_assign(&mut self, name: JsWord, right: Expr, span: Span) -> ModuleItem {
    ModuleItem::Stmt(Stmt::Expr(ExprStmt {
      expr: Box::new(Expr::Assign(AssignExpr {
        op: AssignOp::Assign,
        left: PatOrExpr::Expr(Box::new(Expr::Member(MemberExpr {
          obj: ExprOrSuper::Expr(Box::new(Expr::Ident(Ident::new(
            "exports".into(),
            DUMMY_SP,
          )))),
          prop: Box::new(Expr::Ident(Ident::new(name, DUMMY_SP))),
          computed: false,
          span: DUMMY_SP,
        }))),
        right: Box::new(right),
        span: DUMMY_SP,
      })),
      span,
    }))
  }

  fn create_import_access(&mut self, source: &JsWord, imported: &JsWord, span: Span) -> Expr {
    if imported == "*" {
      let name = self.get_require_name(source, span);
      return Expr::Ident(name);
    }

    let obj = if imported == "default" {
      self.get_interop_default_name(source)
    } else {
      self.get_require_name(&source, DUMMY_SP)
    };

    Expr::Member(MemberExpr {
      obj: ExprOrSuper::Expr(Box::new(Expr::Ident(obj))),
      prop: Box::new(Expr::Ident(Ident::new(imported.clone(), DUMMY_SP))),
      computed: false,
      span: span,
    })
  }
}

impl Fold for ESMFold {
  fn fold_module(&mut self, node: Module) -> Module {
    let mut is_esm = false;

    // First pass: collect all imported declarations.
    for item in &node.body {
      match &item {
        ModuleItem::ModuleDecl(decl) => {
          is_esm = true;
          match decl {
            ModuleDecl::Import(import) => {
              self.create_require(import.src.value.clone(), import.span);

              for specifier in &import.specifiers {
                match specifier {
                  ImportSpecifier::Named(named) => {
                    let imported = match &named.imported {
                      Some(imported) => imported.sym.clone(),
                      None => named.local.sym.clone(),
                    };
                    self.imports.insert(
                      id!(named.local),
                      (import.src.value.clone(), imported.clone()),
                    );
                    if imported == js_word!("default") {
                      self.create_interop_default(import.src.value.clone());
                    }
                  }
                  ImportSpecifier::Default(default) => {
                    self.imports.insert(
                      id!(default.local),
                      (import.src.value.clone(), "default".into()),
                    );
                    self.create_interop_default(import.src.value.clone());
                  }
                  ImportSpecifier::Namespace(namespace) => {
                    self
                      .imports
                      .insert(id!(namespace.local), (import.src.value.clone(), "*".into()));
                  }
                }
              }
            }
            _ => {}
          }
        }
        _ => {}
      }
    }

    // If we didn't see any module declarations, nothing to do.
    if !is_esm {
      return node;
    }

    let node = node.fold_children_with(self);
    let mut needs_interop_flag = false;
    let mut items = vec![];

    for item in &node.body {
      match &item {
        ModuleItem::ModuleDecl(decl) => {
          match decl {
            ModuleDecl::Import(_import) => {
              // Handled above
            }
            ModuleDecl::ExportNamed(export) => {
              needs_interop_flag = true;

              if let Some(src) = &export.src {
                self.create_require(src.value.clone(), export.span);

                for specifier in &export.specifiers {
                  match specifier {
                    ExportSpecifier::Named(named) => {
                      let exported = match &named.exported {
                        Some(exported) => exported.clone(),
                        None => named.orig.clone(),
                      };

                      if named.orig.sym == js_word!("default") {
                        self.create_interop_default(src.value.clone());
                      }

                      let specifier =
                        self.create_import_access(&src.value, &named.orig.sym, DUMMY_SP);
                      self.create_export(exported.sym, specifier, export.span);
                    }
                    ExportSpecifier::Default(default) => {
                      self.create_interop_default(src.value.clone());
                      let specifier =
                        self.create_import_access(&src.value, &js_word!("default"), DUMMY_SP);
                      self.create_export(default.exported.sym.clone(), specifier, export.span);
                    }
                    ExportSpecifier::Namespace(namespace) => {
                      let local = self.get_require_name(&src.value, DUMMY_SP);
                      self.create_export(
                        namespace.name.sym.clone(),
                        Expr::Ident(local),
                        export.span,
                      )
                    }
                  }
                }
              } else {
                for specifier in &export.specifiers {
                  match specifier {
                    ExportSpecifier::Named(named) => {
                      let exported = match &named.exported {
                        Some(exported) => exported.clone(),
                        None => named.orig.clone(),
                      };

                      // Handle import {foo} from 'bar'; export {foo};
                      let value = if let Some((source, imported)) =
                        self.imports.get(&id!(named.orig)).cloned()
                      {
                        self.create_import_access(&source, &imported, named.orig.span)
                      } else {
                        Expr::Ident(named.orig.clone())
                      };

                      self.create_export(exported.sym, value, export.span);
                    }
                    _ => {}
                  }
                }
              }
            }
            ModuleDecl::ExportAll(export) => {
              needs_interop_flag = true;
              self.create_require(export.src.value.clone(), export.span);
              let require_name = self.get_require_name(&export.src.value, export.span);
              let export = self.call_helper(
                "exportAll".into(),
                vec![
                  Expr::Ident(require_name),
                  Expr::Ident(Ident::new("exports".into(), DUMMY_SP)),
                ],
                export.span,
              );
              self.requires.push(export);
            }
            ModuleDecl::ExportDefaultExpr(export) => {
              needs_interop_flag = true;
              items.push(self.create_exports_assign(
                "default".into(),
                *export.expr.clone(),
                export.span,
              ))
            }
            ModuleDecl::ExportDefaultDecl(export) => {
              needs_interop_flag = true;

              match &export.decl {
                DefaultDecl::Class(class) => {
                  if let Some(ident) = &class.ident {
                    items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Class(ClassDecl {
                      ident: ident.clone(),
                      declare: false,
                      class: class.class.clone(),
                    }))));
                    items.push(self.create_exports_assign(
                      "default".into(),
                      Expr::Ident(ident.clone()),
                      DUMMY_SP,
                    ));
                  } else {
                    items.push(self.create_exports_assign(
                      "default".into(),
                      Expr::Class(ClassExpr {
                        ident: None,
                        class: class.class.clone(),
                      }),
                      export.span,
                    ));
                  }
                }
                DefaultDecl::Fn(func) => {
                  if let Some(ident) = &func.ident {
                    items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Fn(FnDecl {
                      ident: ident.clone(),
                      declare: false,
                      function: func.function.clone(),
                    }))));
                    items.push(self.create_exports_assign(
                      "default".into(),
                      Expr::Ident(ident.clone()),
                      DUMMY_SP,
                    ));
                  } else {
                    items.push(self.create_exports_assign(
                      "default".into(),
                      Expr::Fn(FnExpr {
                        ident: None,
                        function: func.function.clone(),
                      }),
                      export.span,
                    ));
                  }
                }
                _ => {
                  unreachable!("unsupported export default declaration");
                }
              }
            }
            ModuleDecl::ExportDecl(export) => {
              needs_interop_flag = true;
              match &export.decl {
                Decl::Class(class) => {
                  self.create_export(
                    class.ident.sym.clone(),
                    Expr::Ident(class.ident.clone()),
                    export.span,
                  );
                  items.push(ModuleItem::Stmt(Stmt::Decl(
                    export.decl.clone().fold_with(self),
                  )));
                }
                Decl::Fn(func) => {
                  self.create_export(
                    func.ident.sym.clone(),
                    Expr::Ident(func.ident.clone()),
                    export.span,
                  );
                  items.push(ModuleItem::Stmt(Stmt::Decl(
                    export.decl.clone().fold_with(self),
                  )));
                }
                Decl::Var(var) => {
                  let mut var = var.clone();
                  var.decls = var
                    .decls
                    .iter()
                    .map(|decl| {
                      let mut decl = decl.clone();
                      self.in_export_decl = true;
                      decl.name = decl.name.clone().fold_with(self);
                      self.in_export_decl = false;
                      decl.init = decl.init.clone().fold_with(self);
                      decl
                    })
                    .collect();
                  items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(var))));
                }
                _ => {
                  items.push(ModuleItem::Stmt(Stmt::Decl(
                    export.decl.clone().fold_with(self),
                  )));
                }
              }
            }
            _ => items.push(item.clone()),
          }
        }
        _ => items.push(item.clone()),
      }
    }

    if needs_interop_flag {
      let helper = self.call_helper(
        "defineInteropFlag".into(),
        vec![Expr::Ident(Ident::new("exports".into(), DUMMY_SP))],
        DUMMY_SP,
      );
      self.exports.insert(0, helper);
    }

    let mut node = node;
    items.splice(0..0, self.requires.clone());
    items.splice(0..0, self.exports.clone());

    if self.needs_helpers {
      items.insert(
        0,
        ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
          span: DUMMY_SP,
          kind: VarDeclKind::Var,
          decls: vec![VarDeclarator {
            span: DUMMY_SP,
            name: Pat::Ident(
              Ident::new("parcelHelpers".into(), DUMMY_SP.apply_mark(self.mark)).into(),
            ),
            init: Some(Box::new(Expr::Call(crate::utils::create_require(
              "@parcel/transformer-js/src/esmodule-helpers.js".into(),
            )))),
            definite: false,
          }],
          declare: false,
        }))),
      )
    }

    node.body = items;
    node
  }

  fn fold_binding_ident(&mut self, node: BindingIdent) -> BindingIdent {
    if self.in_export_decl {
      self.create_export(node.id.sym.clone(), Expr::Ident(node.id.clone()), DUMMY_SP);
    }

    node.fold_children_with(self)
  }

  fn fold_assign_pat_prop(&mut self, node: AssignPatProp) -> AssignPatProp {
    if self.in_export_decl {
      self.create_export(
        node.key.sym.clone(),
        Expr::Ident(node.key.clone()),
        DUMMY_SP,
      );
    }

    node.fold_children_with(self)
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
    match &node {
      Expr::Ident(ident) => {
        if let Some((source, imported)) = self.imports.get(&id!(ident)).cloned() {
          self.create_import_access(&source, &imported, ident.span)
        } else {
          node
        }
      }
      Expr::This(_this) => {
        if !self.in_function_scope {
          Expr::Ident(Ident::new(js_word!("undefined"), DUMMY_SP))
        } else {
          node
        }
      }
      _ => node.fold_children_with(self),
    }
  }

  fn fold_prop(&mut self, node: Prop) -> Prop {
    // let obj = {a, b}; -> let obj = {a: imported.a, b: imported.b};
    match &node {
      Prop::Shorthand(ident) => {
        if let Some((source, imported)) = self.imports.get(&id!(ident)).cloned() {
          Prop::KeyValue(KeyValueProp {
            key: PropName::Ident(Ident::new(ident.sym.clone(), DUMMY_SP)),
            value: Box::new(self.create_import_access(&source, &imported, ident.span)),
          })
        } else {
          node.fold_children_with(self)
        }
      }
      _ => node.fold_children_with(self),
    }
  }
}
