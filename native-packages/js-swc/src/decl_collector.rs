use std::collections::{HashSet};

use swc_atoms::JsWord;
use swc_common::{DUMMY_SP, SyntaxContext};
use swc_ecmascript::ast;
use swc_ecmascript::visit::{Visit, VisitWith, Node};
use swc_ecmascript::utils::var::VarCollector;

/// This pass collects all declarations in a module into a single HashSet of tuples
/// containing identifier names and their associated syntax context (scope).
/// This is used later to determine whether an identifier references a declared variable.
pub fn collect_decls(module: &ast::Module) -> HashSet<(JsWord, SyntaxContext)> {
  let mut c = DeclCollector {
    decls: HashSet::new()
  };
  module.visit_with(&ast::Invalid { span: DUMMY_SP } as _, &mut c);
  return c.decls
}

struct DeclCollector {
  pub decls: HashSet<(JsWord, SyntaxContext)>,
}

impl Visit for DeclCollector {
  fn visit_decl(&mut self, node: &ast::Decl, _parent: &dyn Node) {
    use ast::Decl::*;
    swc_ecmascript::visit::visit_decl(self, node, _parent);

    match node {
      Class(class) => {
        self.decls.insert((class.ident.sym.clone(), class.ident.span.ctxt()));
      },
      Fn(f) => {
        self.decls.insert((f.ident.sym.clone(), f.ident.span.ctxt()));
      },
      Var(var) => {
        let mut found = vec![];
        let mut finder = VarCollector {
          to: &mut found
        };

        var.visit_with(&ast::Invalid { span: DUMMY_SP } as _, &mut finder);

        for decl in found {
          self.decls.insert(decl);
        }
      },
      _ => {}
    }
  }

  fn visit_function(&mut self, node: &ast::Function, _parent: &dyn Node) {
    swc_ecmascript::visit::visit_function(self, node, _parent);

    for param in &node.params {
      let mut found = vec![];
      let mut finder = VarCollector {
        to: &mut found
      };

      param.visit_with(&ast::Invalid { span: DUMMY_SP } as _, &mut finder);

      for decl in found {
        self.decls.insert(decl);
      }
    }
  }

  fn visit_import_specifier(&mut self, node: &ast::ImportSpecifier, _parent: &dyn Node) {
    use ast::ImportSpecifier::*;
    swc_ecmascript::visit::visit_import_specifier(self, node, _parent);

    match node {
      Default(default) => {
        self.decls.insert((default.local.sym.clone(), default.local.span.ctxt()));
      },
      Named(named) => {
        self.decls.insert((named.local.sym.clone(), named.local.span.ctxt()));
      },
      Namespace(namespace) => {
        self.decls.insert((namespace.local.sym.clone(), namespace.local.span.ctxt()));
      }
    }
  }
}
