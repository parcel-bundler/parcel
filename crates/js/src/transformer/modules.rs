use std::collections::{HashMap, HashSet};

use swc_core::{
  common::{DUMMY_SP, Mark, Span, SyntaxContext, util::take::Take},
  ecma::{
    ast::*,
    atoms::Atom as JsWord,
    preset_env::{Feature, Versions},
    utils::stack_size::maybe_grow_default,
    visit::{VisitMut, VisitMutWith},
  },
  quote,
};

use crate::{
  runtime_modules::ESM_HELPERS,
  transformer::{
    id,
    utils::{get_undefined_ident, match_export_name, match_export_name_ident},
  },
};

/// Converts `module` from ESM to CommonJS in place, returning whether it needs the ESM helpers and
/// the length of its prologue (see `Esm2Cjs::prologue_len`).
pub fn esm2cjs(
  module: &mut Module,
  unresolved_mark: Mark,
  versions: Option<Versions>,
) -> (bool, usize) {
  let mut visitor = Esm2Cjs {
    imports: HashMap::new(),
    require_names: HashMap::new(),
    interops: HashSet::new(),
    requires: vec![],
    exports: vec![],
    needs_helpers: false,
    in_export_decl: false,
    in_function_scope: false,
    mark: Mark::fresh(Mark::root()),
    unresolved_mark,
    unresolved_ctxt: SyntaxContext::empty().apply_mark(unresolved_mark),
    versions,
    is_esm: false,
    prologue_len: 0,
  };

  module.visit_mut_with(&mut visitor);
  (visitor.needs_helpers, visitor.prologue_len)
}

struct Esm2Cjs {
  // Map of imported identifier to (source, specifier)
  imports: HashMap<Id, (JsWord, JsWord)>,
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
  unresolved_mark: Mark,
  unresolved_ctxt: SyntaxContext,
  versions: Option<Versions>,
  is_esm: bool,
  // The number of statements the module starts with that define its exports and require its
  // imports, before the rest of its body.
  prologue_len: usize,
}

fn local_name_for_src(src: &JsWord) -> JsWord {
  if !src.contains('/') {
    return format!("_{}", to_camel_case(src)).into();
  }

  format!("_{}", to_camel_case(src.split('/').last().unwrap())).into()
}

/// Matches Inflector's `to_camel_case` (which this replaced): words split on
/// non-alphanumeric characters and lower→upper case boundaries, the first word
/// all lowercase, later words capitalized with the rest lowercase.
fn to_camel_case(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  let mut new_word = false;
  let mut prev_is_lower = false;
  for c in s.chars() {
    if !c.is_alphanumeric() {
      new_word = true;
      prev_is_lower = false;
      continue;
    }
    if prev_is_lower && c.is_uppercase() {
      new_word = true;
    }
    if out.is_empty() {
      out.extend(c.to_lowercase());
    } else if new_word {
      out.extend(c.to_uppercase());
    } else {
      out.extend(c.to_lowercase());
    }
    new_word = false;
    prev_is_lower = c.is_lowercase();
  }
  out
}

impl Esm2Cjs {
  fn get_require_name(&mut self, src: &JsWord, span: Span) -> Ident {
    if let Some((name, mark)) = self.require_names.get(src) {
      return Ident::new(name.clone(), span, SyntaxContext::empty().apply_mark(*mark));
    }

    let name = local_name_for_src(src);
    let mark = Mark::fresh(Mark::root());
    self.require_names.insert(src.clone(), (name.clone(), mark));
    Ident::new(name, span, SyntaxContext::empty().apply_mark(mark))
  }

  fn get_interop_default_name(&mut self, src: &JsWord) -> Ident {
    self.get_require_name(src, DUMMY_SP);
    let (name, mark) = self.require_names.get(src).unwrap();
    Ident::new(
      format!("{}Default", name).into(),
      DUMMY_SP,
      SyntaxContext::empty().apply_mark(*mark),
    )
  }

  fn create_require(&mut self, src: JsWord, span: Span) {
    if self.require_names.contains_key(&src) {
      return;
    }

    let ident = self.get_require_name(&src, DUMMY_SP);
    let require = ModuleItem::Stmt(Stmt::Decl(Decl::Var(Box::new(VarDecl {
      span,
      ctxt: SyntaxContext::empty(),
      kind: VarDeclKind::Var,
      decls: vec![VarDeclarator {
        span: DUMMY_SP,
        name: Pat::Ident(ident.into()),
        init: Some(Box::new(Expr::Call(
          crate::transformer::utils::create_require(src, self.unresolved_mark),
        ))),
        definite: false,
      }],
      declare: false,
    }))));

    self.requires.push(require)
  }

  fn create_interop_default(&mut self, src: JsWord) {
    if self.interops.contains(&src) {
      return;
    }

    let local = self.get_require_name(&src, DUMMY_SP);
    let ident = self.get_interop_default_name(&src);
    let interop = ModuleItem::Stmt(Stmt::Decl(Decl::Var(Box::new(VarDecl {
      span: DUMMY_SP,
      ctxt: SyntaxContext::empty(),
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
    }))));

    self.requires.push(interop);
    self.interops.insert(src);
  }

  fn create_helper_call(&mut self, name: JsWord, args: Vec<Expr>, span: Span) -> Expr {
    self.needs_helpers = true;
    let ident = Ident::new(
      "parcelHelpers".into(),
      DUMMY_SP,
      SyntaxContext::empty().apply_mark(self.mark),
    );
    Expr::Call(CallExpr {
      callee: Callee::Expr(Box::new(Expr::Member(MemberExpr {
        obj: Box::new(Expr::Ident(ident)),
        prop: MemberProp::Ident(IdentName::new(name, DUMMY_SP)),
        span: DUMMY_SP,
      }))),
      args: args
        .into_iter()
        .map(|arg| ExprOrSpread {
          expr: Box::new(arg),
          spread: None,
        })
        .collect(),
      span,
      ctxt: SyntaxContext::empty(),
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
      "export".into(),
      vec![
        Expr::Ident(Ident::new("exports".into(), DUMMY_SP, self.unresolved_ctxt)),
        Expr::Lit(Lit::Str(exported.into())),
        if matches!(self.versions, Some(versions) if Feature::ArrowFunctions.should_enable(&versions, true, false)) {
          Expr::Fn(FnExpr {
            ident: None,
            function: Box::new(Function {
              body: Some(FunctionBody {
                span: DUMMY_SP,
                stmts: vec![Stmt::Return({
                  ReturnStmt {
                    span: DUMMY_SP,
                    arg: Some(Box::new(local)),
                  }
                })],
              }),
              is_async: false,
              is_generator: false,
              params: vec![],
              decorators: vec![],
              span: DUMMY_SP,
              ctxt: SyntaxContext::empty(),
              return_type: None,
              type_params: None,
              this_param: None
            }),
          })
        } else {
          Expr::Arrow(ArrowExpr {
            body: Box::new(ArrowFunctionBody::Expr(Box::new(local))),
            is_async: false,
            is_generator: false,
            params: vec![],
            span: DUMMY_SP,
            ctxt: SyntaxContext::empty(),
            return_type: None,
            type_params: None,
          })
        },
      ],
      span,
    );
    self.exports.push(export)
  }

  fn create_exports_assign(&mut self, name: JsWord, right: Expr, span: Span) -> ModuleItem {
    ModuleItem::Stmt(Stmt::Expr(ExprStmt {
      expr: Box::new(Expr::Assign(AssignExpr {
        op: AssignOp::Assign,
        left: AssignTarget::Simple(SimpleAssignTarget::Member(MemberExpr {
          obj: Box::new(Expr::Ident(Ident::new(
            "exports".into(),
            DUMMY_SP,
            self.unresolved_ctxt,
          ))),
          prop: MemberProp::Ident(IdentName::new(name, DUMMY_SP)),
          span: DUMMY_SP,
        })),
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
      self.get_require_name(source, DUMMY_SP)
    };

    // import { foo } from "..."; foo();
    // ->
    // import { foo } from "..."; (0, foo)();
    Expr::Seq(SeqExpr {
      exprs: vec![
        0.into(),
        Box::new(Expr::Member(MemberExpr {
          obj: Box::new(Expr::Ident(obj)),
          prop: if Ident::verify_symbol(&imported).is_ok() {
            MemberProp::Ident(IdentName::new(imported.clone(), DUMMY_SP))
          } else {
            MemberProp::Computed(ComputedPropName {
              expr: imported.clone().into(),
              span: DUMMY_SP,
            })
          },
          span,
        })),
      ],
      span,
    })
  }
}

macro_rules! modules_visit_fn {
  ($name:ident, $type:ident) => {
    fn $name(&mut self, node: &mut $type) {
      let in_function_scope = self.in_function_scope;
      self.in_function_scope = true;
      node.visit_mut_children_with(self);
      self.in_function_scope = in_function_scope;
    }
  };
}

impl VisitMut for Esm2Cjs {
  fn visit_mut_module(&mut self, node: &mut Module) {
    let mut needs_interop_flag = false;

    // First pass: collect all imported declarations. On the second pass, exports can be matched to
    // imports (to better handle import/export pairs that are really just reexports).
    //
    // To ensure that all declarations that cause dependencies are kept in the same order, handle
    // export declarations with a source in the first pass as well.
    for item in &node.body {
      if let ModuleItem::ModuleDecl(decl) = &item {
        self.is_esm = true;
        match decl {
          ModuleDecl::Import(import) => {
            let import_src: JsWord = import.src.value.to_string_lossy().into();
            self.create_require(import_src.clone(), import.span);

            for specifier in &import.specifiers {
              match specifier {
                ImportSpecifier::Named(named) => {
                  let imported = match &named.imported {
                    Some(imported) => match_export_name(imported).0.clone(),
                    None => named.local.sym.clone(),
                  };
                  self
                    .imports
                    .insert(id!(named.local), (import_src.clone(), imported.clone()));
                  if imported == "default" {
                    self.create_interop_default(import_src.clone());
                  }
                }
                ImportSpecifier::Default(default) => {
                  self
                    .imports
                    .insert(id!(default.local), (import_src.clone(), "default".into()));
                  self.create_interop_default(import_src.clone());
                }
                ImportSpecifier::Namespace(namespace) => {
                  self
                    .imports
                    .insert(id!(namespace.local), (import_src.clone(), "*".into()));
                }
              }
            }
          }
          ModuleDecl::ExportNamed(export) => {
            needs_interop_flag = true;

            if let Some(src) = &export.src {
              let src_word: JsWord = src.value.to_string_lossy().into();
              self.create_require(src_word.clone(), export.span);

              for specifier in &export.specifiers {
                match specifier {
                  ExportSpecifier::Named(named) => {
                    let exported = match &named.exported {
                      Some(exported) => exported.clone(),
                      None => named.orig.clone(),
                    };

                    if match_export_name(&named.orig).0 == "default" {
                      self.create_interop_default(src_word.clone());
                    }

                    let specifier = self.create_import_access(
                      &src_word,
                      &match_export_name(&named.orig).0,
                      DUMMY_SP,
                    );
                    self.create_export(match_export_name(&exported).0, specifier, export.span);
                  }
                  ExportSpecifier::Default(default) => {
                    self.create_interop_default(src_word.clone());
                    let specifier =
                      self.create_import_access(&src_word, &"default".into(), DUMMY_SP);
                    self.create_export(default.exported.sym.clone(), specifier, export.span);
                  }
                  ExportSpecifier::Namespace(namespace) => {
                    let local = self.get_require_name(&src_word, DUMMY_SP);
                    self.create_export(
                      match_export_name(&namespace.name).0,
                      Expr::Ident(local),
                      export.span,
                    )
                  }
                }
              }
            } else {
              // Handled below
            }
          }
          ModuleDecl::ExportAll(export) => {
            needs_interop_flag = true;
            let export_src: JsWord = export.src.value.to_string_lossy().into();
            self.create_require(export_src.clone(), export.span);
            let require_name = self.get_require_name(&export_src, export.span);
            let export = self.call_helper(
              "exportAll".into(),
              vec![
                Expr::Ident(require_name),
                Expr::Ident(Ident::new("exports".into(), DUMMY_SP, self.unresolved_ctxt)),
              ],
              export.span,
            );
            self.requires.push(export);
          }
          _ => (),
        }
      }
    }

    node.visit_mut_children_with(self);
    let mut items = Vec::with_capacity(node.body.len());

    // Second pass. Declarations were already transformed above, so they're moved out of their
    // exports as they are.
    for item in std::mem::take(&mut node.body) {
      match item {
        ModuleItem::ModuleDecl(decl) => {
          match decl {
            ModuleDecl::Import(_) | ModuleDecl::ExportAll(_) => {
              // Handled above
            }
            ModuleDecl::ExportNamed(export) => {
              needs_interop_flag = true;
              if export.src.is_none() {
                for specifier in &export.specifiers {
                  if let ExportSpecifier::Named(named) = specifier {
                    let exported = match &named.exported {
                      Some(exported) => exported.clone(),
                      None => named.orig.clone(),
                    };
                    let orig = match_export_name_ident(&named.orig);

                    // Handle import {foo} from 'bar'; export {foo};
                    let value =
                      if let Some((source, imported)) = self.imports.get(&id!(orig)).cloned() {
                        self.create_import_access(
                          &source,
                          &imported,
                          match_export_name(&named.orig).1,
                        )
                      } else {
                        Expr::Ident(orig.clone())
                      };

                    self.create_export(match_export_name(&exported).0, value, export.span);
                  }
                }
              } else {
                // Handled above
              }
            }
            ModuleDecl::ExportDefaultExpr(export) => {
              needs_interop_flag = true;
              items.push(self.create_exports_assign("default".into(), *export.expr, export.span))
            }
            ModuleDecl::ExportDefaultDecl(export) => {
              needs_interop_flag = true;

              match export.decl {
                DefaultDecl::Class(class) => {
                  if let Some(ident) = class.ident {
                    self.create_export("default".into(), Expr::Ident(ident.clone()), DUMMY_SP);
                    items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Class(ClassDecl {
                      ident,
                      declare: false,
                      class: class.class,
                    }))));
                  } else {
                    items.push(self.create_exports_assign(
                      "default".into(),
                      Expr::Class(ClassExpr {
                        ident: None,
                        class: class.class,
                      }),
                      export.span,
                    ));
                  }
                }
                DefaultDecl::Fn(func) => {
                  if let Some(ident) = func.ident {
                    self.create_export("default".into(), Expr::Ident(ident.clone()), DUMMY_SP);
                    items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Fn(FnDecl {
                      ident,
                      declare: false,
                      function: func.function,
                    }))));
                  } else {
                    self.create_export(
                      "default".into(),
                      Expr::Fn(FnExpr {
                        ident: None,
                        function: func.function,
                      }),
                      export.span,
                    );
                  }
                }
                _ => {
                  unreachable!("unsupported export default declaration");
                }
              }
            }
            ModuleDecl::ExportDecl(export) => {
              needs_interop_flag = true;
              match export.decl {
                Decl::Class(class) => {
                  self.create_export(
                    class.ident.sym.clone(),
                    Expr::Ident(class.ident.clone()),
                    export.span,
                  );
                  items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Class(class))));
                }
                Decl::Fn(func) => {
                  self.create_export(
                    func.ident.sym.clone(),
                    Expr::Ident(func.ident.clone()),
                    export.span,
                  );
                  items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Fn(func))));
                }
                Decl::Var(mut var) => {
                  // Export each binding (see `visit_mut_binding_ident`).
                  for decl in &mut var.decls {
                    self.in_export_decl = true;
                    decl.name.visit_mut_with(self);
                    self.in_export_decl = false;
                  }
                  items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(var))));
                }
                decl => items.push(ModuleItem::Stmt(Stmt::Decl(decl))),
              }
            }
            decl => items.push(ModuleItem::ModuleDecl(decl)),
          }
        }
        item => items.push(item),
      }
    }

    if needs_interop_flag {
      let helper = self.call_helper(
        "defineInteropFlag".into(),
        vec![Expr::Ident(Ident::new(
          "exports".into(),
          DUMMY_SP,
          self.unresolved_ctxt,
        ))],
        DUMMY_SP,
      );
      self.exports.insert(0, helper);
    }

    self.prologue_len = self.exports.len() + self.requires.len() + self.needs_helpers as usize;
    let mut body = Vec::with_capacity(self.prologue_len + items.len());
    if self.needs_helpers {
      body.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(Box::new(VarDecl {
        span: DUMMY_SP,
        ctxt: SyntaxContext::empty(),
        kind: VarDeclKind::Var,
        decls: vec![VarDeclarator {
          span: DUMMY_SP,
          name: Pat::Ident(
            Ident::new(
              "parcelHelpers".into(),
              DUMMY_SP,
              SyntaxContext::empty().apply_mark(self.mark),
            )
            .into(),
          ),
          init: Some(Box::new(Expr::Call(
            crate::transformer::utils::create_require(ESM_HELPERS.into(), self.unresolved_mark),
          ))),
          definite: false,
        }],
        declare: false,
      })))));
    }
    body.append(&mut self.exports);
    body.append(&mut self.requires);
    body.append(&mut items);
    node.body = body;
  }

  fn visit_mut_binding_ident(&mut self, node: &mut BindingIdent) {
    if self.in_export_decl {
      // export const {foo} = ...;
      self.create_export(node.id.sym.clone(), Expr::Ident(node.id.clone()), DUMMY_SP);
    }

    node.visit_mut_children_with(self);
  }

  modules_visit_fn!(visit_mut_function, Function);
  modules_visit_fn!(visit_mut_class, Class);
  modules_visit_fn!(visit_mut_getter_prop, GetterProp);
  modules_visit_fn!(visit_mut_setter_prop, SetterProp);

  fn visit_mut_expr(&mut self, node: &mut Expr) {
    match node {
      Expr::Ident(ident) => {
        if let Some((source, imported)) = self.imports.get(&id!(ident)).cloned() {
          let span = ident.span;
          *node = self.create_import_access(&source, &imported, span);
        }
      }
      Expr::This(_) => {
        if !self.in_function_scope && self.is_esm {
          *node = Expr::Ident(get_undefined_ident(self.unresolved_mark));
        }
      }
      Expr::Call(call) if call.callee.is_import() => {
        *node = quote!(
          "Promise.resolve($require($specifier))" as Expr,
          require: Ident = Ident::new("require".into(), DUMMY_SP, SyntaxContext::empty().apply_mark(self.unresolved_mark)),
          specifier: Expr = *call.args[0].expr.take()
        );
      }
      Expr::Call(_) => node.visit_mut_children_with(self),
      _ => maybe_grow_default(|| node.visit_mut_children_with(self)),
    }
  }

  fn visit_mut_prop(&mut self, node: &mut Prop) {
    // let obj = {a, b}; -> let obj = {a: imported.a, b: imported.b};
    if let Prop::Shorthand(ident) = node
      && let Some((source, imported)) = self.imports.get(&id!(ident)).cloned()
    {
      let key = PropName::Ident(IdentName::new(ident.sym.clone(), DUMMY_SP));
      let span = ident.span;
      *node = Prop::KeyValue(KeyValueProp {
        key,
        value: Box::new(self.create_import_access(&source, &imported, span)),
      });
    } else {
      node.visit_mut_children_with(self);
    }
  }

  /// A non-computed property name isn't a reference to a binding.
  fn visit_mut_member_expr(&mut self, node: &mut MemberExpr) {
    node.obj.visit_mut_with(self);
    if let MemberProp::Computed(_) = node.prop {
      node.prop.visit_mut_with(self);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::transformer::test_utils::run_with_transformation;

  #[test]
  fn requires_esm_helpers() {
    let (output, needs_helpers) =
      run_with_transformation("export default 42", |context, module| {
        let (needs_helpers, _) = esm2cjs(module, context.unresolved_mark, None);
        needs_helpers
      });

    assert!(needs_helpers);
    assert!(output.contains(r#"require("@parcel/parcel3/src/esmodule-helpers.js")"#));
  }
}
