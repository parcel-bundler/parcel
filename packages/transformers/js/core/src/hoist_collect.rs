use serde::Serialize;
use std::collections::{HashMap, HashSet};
use swc_atoms::JsWord;
use swc_common::{sync::Lrc, Mark, Span, SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast::*;
use swc_ecmascript::visit::{Node, Visit, VisitWith};

use crate::id;
use crate::utils::{
  match_import, match_member_expr, match_require, Bailout, BailoutReason, IdentId, SourceLocation,
};

#[derive(Debug, PartialEq, Clone, Copy, Serialize)]
pub enum ImportKind {
  Require,
  Import,
  DynamicImport,
}

#[derive(Debug)]
pub struct Import {
  pub source: JsWord,
  pub specifier: JsWord,
  pub kind: ImportKind,
  pub loc: SourceLocation,
}

#[derive(Debug)]
pub struct Export {
  pub source: Option<JsWord>,
  pub specifier: JsWord,
  pub loc: SourceLocation,
}

pub struct HoistCollect {
  pub source_map: Lrc<swc_common::SourceMap>,
  pub decls: HashSet<IdentId>,
  pub ignore_mark: Mark,
  pub global_ctxt: SyntaxContext,
  pub static_cjs_exports: bool,
  pub has_cjs_exports: bool,
  pub is_esm: bool,
  pub should_wrap: bool,
  // local name -> descriptor
  pub imports: HashMap<IdentId, Import>,
  // exported name -> descriptor
  pub exports: HashMap<JsWord, Export>,
  // local name -> exported name
  pub exports_locals: HashMap<JsWord, JsWord>,
  pub exports_all: HashMap<JsWord, SourceLocation>,
  pub non_static_access: HashMap<IdentId, Vec<Span>>,
  pub non_const_bindings: HashMap<IdentId, Vec<Span>>,
  pub non_static_requires: HashSet<JsWord>,
  pub wrapped_requires: HashSet<JsWord>,
  pub bailouts: Option<Vec<Bailout>>,
  in_module_this: bool,
  in_top_level: bool,
  in_export_decl: bool,
  in_function: bool,
  in_assign: bool,
}

#[derive(Debug, Serialize)]
struct ImportedSymbol {
  source: JsWord,
  local: JsWord,
  imported: JsWord,
  loc: SourceLocation,
  kind: ImportKind,
}

#[derive(Debug, Serialize)]
struct ExportedSymbol {
  source: Option<JsWord>,
  local: JsWord,
  exported: JsWord,
  loc: SourceLocation,
}

#[derive(Debug, Serialize)]
struct ExportedAll {
  source: JsWord,
  loc: SourceLocation,
}

#[derive(Serialize, Debug)]
pub struct HoistCollectResult {
  imports: Vec<ImportedSymbol>,
  exports: Vec<ExportedSymbol>,
  exports_all: Vec<ExportedAll>,
}

impl HoistCollect {
  pub fn new(
    source_map: Lrc<swc_common::SourceMap>,
    decls: HashSet<IdentId>,
    ignore_mark: Mark,
    global_mark: Mark,
    trace_bailouts: bool,
  ) -> Self {
    HoistCollect {
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
      exports_locals: HashMap::new(),
      exports_all: HashMap::new(),
      non_static_access: HashMap::new(),
      non_const_bindings: HashMap::new(),
      non_static_requires: HashSet::new(),
      wrapped_requires: HashSet::new(),
      in_module_this: true,
      in_top_level: true,
      in_export_decl: false,
      in_function: false,
      in_assign: false,
      bailouts: if trace_bailouts { Some(vec![]) } else { None },
    }
  }
}

impl From<HoistCollect> for HoistCollectResult {
  fn from(collect: HoistCollect) -> HoistCollectResult {
    HoistCollectResult {
      imports: collect
        .imports
        .into_iter()
        .map(
          |(
            local,
            Import {
              source,
              specifier,
              loc,
              kind,
            },
          )| ImportedSymbol {
            source,
            local: local.0,
            imported: specifier,
            loc,
            kind,
          },
        )
        .collect(),
      exports: collect
        .exports
        .into_iter()
        .map(
          |(
            exported,
            Export {
              source,
              specifier,
              loc,
            },
          )| ExportedSymbol {
            source,
            local: specifier,
            exported,
            loc,
          },
        )
        .collect(),
      exports_all: collect
        .exports_all
        .into_iter()
        .map(|(source, loc)| ExportedAll { source, loc })
        .collect(),
    }
  }
}

macro_rules! collect_visit_fn {
  ($name:ident, $type:ident) => {
    fn $name(&mut self, node: &$type, _parent: &dyn Node) {
      let in_module_this = self.in_module_this;
      let in_function = self.in_function;
      self.in_module_this = false;
      self.in_function = true;
      node.visit_children_with(self);
      self.in_module_this = in_module_this;
      self.in_function = in_function;
    }
  };
}

impl Visit for HoistCollect {
  fn visit_module(&mut self, node: &Module, _parent: &dyn Node) {
    self.in_module_this = true;
    self.in_top_level = true;
    self.in_function = false;
    node.visit_children_with(self);
    self.in_module_this = false;

    if let Some(bailouts) = &mut self.bailouts {
      for key in self.imports.keys() {
        if let Some(spans) = self.non_static_access.get(key) {
          for span in spans {
            bailouts.push(Bailout {
              loc: SourceLocation::from(&self.source_map, *span),
              reason: BailoutReason::NonStaticAccess,
            })
          }
        }
      }

      bailouts.sort_by(|a, b| a.loc.partial_cmp(&b.loc).unwrap());
    }
  }

  collect_visit_fn!(visit_function, Function);
  collect_visit_fn!(visit_class, Class);
  collect_visit_fn!(visit_getter_prop, GetterProp);
  collect_visit_fn!(visit_setter_prop, SetterProp);

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
          Stmt::Decl(decl) => {
            if let Decl::Var(_var) = decl {
              decl.visit_children_with(self);
              return;
            }
          }
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
    for specifier in &node.specifiers {
      let source = node.src.as_ref().map(|s| s.value.clone());
      match specifier {
        ExportSpecifier::Named(named) => {
          let exported = match &named.exported {
            Some(exported) => exported.clone(),
            None => named.orig.clone(),
          };
          self.exports.insert(
            exported.sym.clone(),
            Export {
              specifier: named.orig.sym.clone(),
              loc: SourceLocation::from(&self.source_map, exported.span),
              source,
            },
          );
          self
            .exports_locals
            .entry(named.orig.sym.clone())
            .or_insert_with(|| exported.sym.clone());
        }
        ExportSpecifier::Default(default) => {
          self.exports.insert(
            js_word!("default"),
            Export {
              specifier: default.exported.sym.clone(),
              loc: SourceLocation::from(&self.source_map, default.exported.span),
              source,
            },
          );
          self
            .exports_locals
            .entry(default.exported.sym.clone())
            .or_insert_with(|| js_word!("default"));
        }
        ExportSpecifier::Namespace(namespace) => {
          self.exports.insert(
            namespace.name.sym.clone(),
            Export {
              specifier: "*".into(),
              loc: SourceLocation::from(&self.source_map, namespace.span),
              source,
            },
          );
          // Populating exports_locals with * doesn't make any sense at all
          // and hoist doesn't use this anyway.
        }
      }
    }
  }

  fn visit_export_decl(&mut self, node: &ExportDecl, _parent: &dyn Node) {
    match &node.decl {
      Decl::Class(class) => {
        self.exports.insert(
          class.ident.sym.clone(),
          Export {
            specifier: class.ident.sym.clone(),
            loc: SourceLocation::from(&self.source_map, class.ident.span),
            source: None,
          },
        );
        self
          .exports_locals
          .entry(class.ident.sym.clone())
          .or_insert_with(|| class.ident.sym.clone());
      }
      Decl::Fn(func) => {
        self.exports.insert(
          func.ident.sym.clone(),
          Export {
            specifier: func.ident.sym.clone(),
            loc: SourceLocation::from(&self.source_map, func.ident.span),
            source: None,
          },
        );
        self
          .exports_locals
          .entry(func.ident.sym.clone())
          .or_insert_with(|| func.ident.sym.clone());
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
          self.exports.insert(
            "default".into(),
            Export {
              specifier: ident.sym.clone(),
              loc: SourceLocation::from(&self.source_map, node.span),
              source: None,
            },
          );
          self
            .exports_locals
            .entry(ident.sym.clone())
            .or_insert_with(|| "default".into());
        }
      }
      DefaultDecl::Fn(func) => {
        if let Some(ident) = &func.ident {
          self.exports.insert(
            "default".into(),
            Export {
              specifier: ident.sym.clone(),
              loc: SourceLocation::from(&self.source_map, node.span),
              source: None,
            },
          );
          self
            .exports_locals
            .entry(ident.sym.clone())
            .or_insert_with(|| "default".into());
        }
      }
      _ => {
        unreachable!("unsupported export default declaration");
      }
    };

    node.visit_children_with(self);
  }

  fn visit_export_all(&mut self, node: &ExportAll, _parent: &dyn Node) {
    self.exports_all.insert(
      node.src.value.clone(),
      SourceLocation::from(&self.source_map, node.span),
    );
  }

  fn visit_return_stmt(&mut self, node: &ReturnStmt, _parent: &dyn Node) {
    if !self.in_function {
      self.should_wrap = true;
      self.add_bailout(node.span, BailoutReason::TopLevelReturn);
    }

    node.visit_children_with(self)
  }

  fn visit_binding_ident(&mut self, node: &BindingIdent, _parent: &dyn Node) {
    if self.in_export_decl {
      self.exports.insert(
        node.id.sym.clone(),
        Export {
          specifier: node.id.sym.clone(),
          loc: SourceLocation::from(&self.source_map, node.id.span),
          source: None,
        },
      );
      self
        .exports_locals
        .entry(node.id.sym.clone())
        .or_insert_with(|| node.id.sym.clone());
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
      self.exports.insert(
        node.key.sym.clone(),
        Export {
          specifier: node.key.sym.clone(),
          loc: SourceLocation::from(&self.source_map, node.key.span),
          source: None,
        },
      );
      self
        .exports_locals
        .entry(node.key.sym.clone())
        .or_insert_with(|| node.key.sym.clone());
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

    if match_member_expr(node, vec!["module", "exports"], &self.decls) {
      self.static_cjs_exports = false;
      self.has_cjs_exports = true;
      return;
    }

    if match_member_expr(node, vec!["module", "hot"], &self.decls) {
      return;
    }

    if match_member_expr(node, vec!["module", "require"], &self.decls) {
      return;
    }

    let is_static = match &*node.prop {
      Expr::Ident(_) => !node.computed,
      Expr::Lit(Lit::Str(_)) => true,
      _ => false,
    };

    if let ExprOrSuper::Expr(expr) = &node.obj {
      match &**expr {
        Expr::Member(member) => {
          if match_member_expr(member, vec!["module", "exports"], &self.decls) {
            self.has_cjs_exports = true;
            if !is_static {
              self.static_cjs_exports = false;
              self.add_bailout(node.span, BailoutReason::NonStaticExports);
            }
          }
          return;
        }
        Expr::Ident(ident) => {
          let exports: JsWord = "exports".into();
          if ident.sym == exports && !self.decls.contains(&id!(ident)) {
            self.has_cjs_exports = true;
            if !is_static {
              self.static_cjs_exports = false;
              self.add_bailout(node.span, BailoutReason::NonStaticExports);
            }
          }

          if ident.sym == js_word!("module") && !self.decls.contains(&id!(ident)) {
            self.has_cjs_exports = true;
            self.static_cjs_exports = false;
            self.should_wrap = true;
            self.add_bailout(node.span, BailoutReason::FreeModule);
          }

          // `import` isn't really an identifier...
          if !is_static && ident.sym != js_word!("import") {
            self
              .non_static_access
              .entry(id!(ident))
              .or_default()
              .push(node.span);
          }
          return;
        }
        Expr::This(_this) => {
          if self.in_module_this {
            self.has_cjs_exports = true;
            if !is_static {
              self.static_cjs_exports = false;
              self.add_bailout(node.span, BailoutReason::NonStaticExports);
            }
          }
          return;
        }
        _ => {}
      }
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
    } else {
      node.visit_children_with(self);
    }
  }

  fn visit_expr(&mut self, node: &Expr, _parent: &dyn Node) {
    // If we reached this visitor, this is a non-top-level require that isn't in a variable
    // declaration. We need to wrap the referenced module to preserve side effect ordering.
    if let Some(source) = self.match_require(node) {
      self.wrapped_requires.insert(source);
      let span = match node {
        Expr::Call(c) => c.span,
        _ => unreachable!(),
      };
      self.add_bailout(span, BailoutReason::NonTopLevelRequire);
    }

    if let Some(source) = match_import(node, self.ignore_mark) {
      self.non_static_requires.insert(source.clone());
      self.wrapped_requires.insert(source);
      let span = match node {
        Expr::Call(c) => c.span,
        _ => unreachable!(),
      };
      self.add_bailout(span, BailoutReason::NonStaticDynamicImport);
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
            self.add_bailout(ident.span, BailoutReason::FreeModule);
          } else {
            self.add_bailout(ident.span, BailoutReason::FreeExports);
          }
        }

        // `import` isn't really an identifier...
        if ident.sym != js_word!("import") {
          self
            .non_static_access
            .entry(id!(ident))
            .or_default()
            .push(ident.span);
        }
      }
      _ => {
        node.visit_children_with(self);
      }
    }
  }

  fn visit_this_expr(&mut self, node: &ThisExpr, _parent: &dyn Node) {
    if self.in_module_this {
      self.has_cjs_exports = true;
      self.static_cjs_exports = false;
      self.add_bailout(node.span, BailoutReason::FreeExports);
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

    if let PatOrExpr::Pat(pat) = &node.left {
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
        self.add_bailout(node.span, BailoutReason::ExportsReassignment);
      } else if has_binding_identifier(pat, &"module".into(), &self.decls) {
        // Same for `module`. If it is reassigned we can't correctly statically analyze.
        self.static_cjs_exports = false;
        self.has_cjs_exports = true;
        self.should_wrap = true;
        self.add_bailout(node.span, BailoutReason::ModuleReassignment);
      }
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
          if let ExprOrSuper::Expr(expr) = &member.obj {
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
                Expr::Lit(Lit::Str(str_)) => PropName::Str(str_.clone()),
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
    if let ExprOrSuper::Expr(expr) = &node.callee {
      match &**expr {
        Expr::Ident(ident) => {
          if ident.sym == js_word!("eval") && !self.decls.contains(&id!(ident)) {
            self.should_wrap = true;
            self.add_bailout(node.span, BailoutReason::Eval);
          }
        }
        Expr::Member(member) => {
          // import('foo').then(foo => ...);
          if let ExprOrSuper::Expr(obj) = &member.obj {
            if let Some(source) = match_import(&*obj, self.ignore_mark) {
              let then: JsWord = "then".into();
              let is_then = match &*member.prop {
                Expr::Ident(ident) => !member.computed && ident.sym == then,
                Expr::Lit(Lit::Str(str)) => str.value == then,
                _ => false,
              };

              if is_then {
                if let Some(ExprOrSpread { expr, .. }) = node.args.get(0) {
                  let param = match &**expr {
                    Expr::Fn(func) => func.function.params.get(0).map(|param| &param.pat),
                    Expr::Arrow(arrow) => arrow.params.get(0),
                    _ => None,
                  };

                  if let Some(param) = param {
                    self.add_pat_imports(param, &source, ImportKind::DynamicImport);
                  } else {
                    self.non_static_requires.insert(source.clone());
                    self.wrapped_requires.insert(source);
                    self.add_bailout(node.span, BailoutReason::NonStaticDynamicImport);
                  }

                  expr.visit_with(node, self);
                  return;
                }
              }
            }
          }
        }
        _ => {}
      }
    }

    node.visit_children_with(self);
  }
}

impl HoistCollect {
  pub fn match_require(&self, node: &Expr) -> Option<JsWord> {
    match_require(node, &self.decls, self.ignore_mark)
  }

  fn add_pat_imports(&mut self, node: &Pat, src: &JsWord, kind: ImportKind) {
    if !self.in_top_level {
      self.wrapped_requires.insert(src.clone());
      if kind != ImportKind::DynamicImport {
        self.non_static_requires.insert(src.clone());
        let span = match node {
          Pat::Ident(id) => id.id.span,
          Pat::Array(arr) => arr.span,
          Pat::Object(obj) => obj.span,
          Pat::Rest(rest) => rest.span,
          Pat::Assign(assign) => assign.span,
          Pat::Invalid(i) => i.span,
          Pat::Expr(_) => DUMMY_SP,
        };
        self.add_bailout(span, BailoutReason::NonTopLevelRequire);
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
                  self.add_bailout(object.span, BailoutReason::NonStaticDestructuring);
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
                  self.add_bailout(object.span, BailoutReason::NonStaticDestructuring);
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
              self.add_bailout(object.span, BailoutReason::NonStaticDestructuring);
            }
          }
        }
      }
      _ => {
        // Non-static.
        self.non_static_requires.insert(src.clone());
        let span = match node {
          Pat::Ident(id) => id.id.span,
          Pat::Array(arr) => arr.span,
          Pat::Object(obj) => obj.span,
          Pat::Rest(rest) => rest.span,
          Pat::Assign(assign) => assign.span,
          Pat::Invalid(i) => i.span,
          Pat::Expr(_) => DUMMY_SP,
        };
        self.add_bailout(span, BailoutReason::NonStaticDestructuring);
      }
    }
  }

  pub fn get_non_const_binding_idents(&self, node: &Pat, idents: &mut Vec<Ident>) {
    match node {
      Pat::Ident(ident) => {
        if self.non_const_bindings.contains_key(&id!(ident.id)) {
          idents.push(ident.id.clone());
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
                idents.push(assign.key.clone());
              }
            }
            ObjectPatProp::Rest(rest) => {
              self.get_non_const_binding_idents(&*rest.arg, idents);
            }
          }
        }
      }
      Pat::Array(array) => {
        for el in array.elems.iter().flatten() {
          self.get_non_const_binding_idents(el, idents);
        }
      }
      _ => {}
    }
  }

  fn add_bailout(&mut self, span: Span, reason: BailoutReason) {
    if let Some(bailouts) = &mut self.bailouts {
      bailouts.push(Bailout {
        loc: SourceLocation::from(&self.source_map, span),
        reason,
      })
    }
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
      for el in array.elems.iter().flatten() {
        if has_binding_identifier(el, sym, decls) {
          return true;
        }
      }
    }
    _ => {}
  }

  false
}
