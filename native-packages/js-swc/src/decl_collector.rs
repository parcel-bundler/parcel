use std::collections::HashSet;

use swc_atoms::JsWord;
use swc_common::{SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast;
use swc_ecmascript::visit::{Node, Visit, VisitWith};

/// This pass collects all declarations in a module into a single HashSet of tuples
/// containing identifier names and their associated syntax context (scope).
/// This is used later to determine whether an identifier references a declared variable.
pub fn collect_decls(module: &ast::Module) -> HashSet<(JsWord, SyntaxContext)> {
  let mut c = DeclCollector {
    decls: HashSet::new(),
    in_var: false,
  };
  module.visit_with(&ast::Invalid { span: DUMMY_SP } as _, &mut c);
  return c.decls;
}

struct DeclCollector {
  decls: HashSet<(JsWord, SyntaxContext)>,
  in_var: bool,
}

impl Visit for DeclCollector {
  fn visit_decl(&mut self, node: &ast::Decl, _parent: &dyn Node) {
    use ast::Decl::*;

    match node {
      Class(class) => {
        self
          .decls
          .insert((class.ident.sym.clone(), class.ident.span.ctxt()));
      }
      Fn(f) => {
        self
          .decls
          .insert((f.ident.sym.clone(), f.ident.span.ctxt()));
      }
      _ => {}
    }

    node.visit_children_with(self);
  }

  fn visit_var_declarator(&mut self, node: &ast::VarDeclarator, _parent: &dyn Node) {
    self.in_var = true;
    node.name.visit_with(node, self);
    self.in_var = false;
    if let Some(init) = &node.init {
      init.visit_with(node, self);
    }
  }

  fn visit_binding_ident(&mut self, node: &ast::BindingIdent, _parent: &dyn Node) {
    if self.in_var {
      self.decls.insert((node.id.sym.clone(), node.id.span.ctxt));
    }
  }

  fn visit_assign_pat_prop(&mut self, node: &ast::AssignPatProp, _parent: &dyn Node) {
    if self.in_var {
      self
        .decls
        .insert((node.key.sym.clone(), node.key.span.ctxt));
    }
  }

  fn visit_function(&mut self, node: &ast::Function, _parent: &dyn Node) {
    self.in_var = true;
    for param in &node.params {
      param.visit_with(node, self);
    }
    self.in_var = false;

    node.body.visit_with(node, self);
  }

  fn visit_arrow_expr(&mut self, node: &ast::ArrowExpr, _parent: &dyn Node) {
    self.in_var = true;
    for param in &node.params {
      param.visit_with(node, self);
    }
    self.in_var = false;

    node.body.visit_with(node, self);
  }

  fn visit_import_specifier(&mut self, node: &ast::ImportSpecifier, _parent: &dyn Node) {
    use ast::ImportSpecifier::*;
    swc_ecmascript::visit::visit_import_specifier(self, node, _parent);

    match node {
      Default(default) => {
        self
          .decls
          .insert((default.local.sym.clone(), default.local.span.ctxt()));
      }
      Named(named) => {
        self
          .decls
          .insert((named.local.sym.clone(), named.local.span.ctxt()));
      }
      Namespace(namespace) => {
        self
          .decls
          .insert((namespace.local.sym.clone(), namespace.local.span.ctxt()));
      }
    }
  }
}
