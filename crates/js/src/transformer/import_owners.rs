use std::collections::{HashMap, HashSet};

use swc_core::{
  common::SyntaxContext,
  ecma::{
    ast::*,
    atoms::Atom as JsWord,
    visit::{Visit, VisitWith, noop_visit_type},
  },
};

use crate::transformer::id;

/// The exports whose functions use each import that only exported functions use, which the
/// import is only needed for (see `ImportedSymbol::owners`).
///
/// When an export isn't requested, the packager removes it, and the minifier then removes its
/// function if nothing else in the module references it. So only functions referenced from
/// nothing but their own body and exports qualify. They must be function declarations, or function
/// or arrow expressions assigned to a variable, so that nothing in them runs until they are called.
pub fn import_owners(module: &Module) -> HashMap<Id, Vec<JsWord>> {
  let mut imports = HashSet::new();
  // Functions declared at the top level, with the names they are exported as.
  let mut functions: HashMap<Id, Vec<JsWord>> = HashMap::new();
  for item in &module.body {
    match item {
      ModuleItem::ModuleDecl(ModuleDecl::Import(import)) => {
        // Imports with attributes may not be JavaScript evaluated by the importer, e.g. URLs.
        if import.type_only || import.with.is_some() || import.phase != ImportPhase::Evaluation {
          continue;
        }
        for specifier in &import.specifiers {
          imports.insert(id!(specifier.local()));
        }
      }
      ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(export)) => {
        for (local, name) in function_decls(&export.decl) {
          functions.insert(local, vec![name]);
        }
      }
      ModuleItem::Stmt(Stmt::Decl(decl)) => {
        for (local, _) in function_decls(decl) {
          functions.insert(local, Vec::new());
        }
      }
      ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ExportDefaultDecl {
        decl: DefaultDecl::Fn(function),
        ..
      })) => {
        let local = function
          .ident
          .as_ref()
          .map_or_else(anonymous_default_function, |ident| id!(ident));
        functions.insert(local, vec!["default".into()]);
      }
      _ => {}
    }
  }

  // The names functions are exported as in export lists, e.g. `c` in `export {b as c}`.
  for item in &module.body {
    if let ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(NamedExport {
      specifiers,
      src: None,
      type_only: false,
      ..
    })) = item
    {
      for specifier in specifiers {
        if let ExportSpecifier::Named(ExportNamedSpecifier {
          orig: ModuleExportName::Ident(orig),
          exported,
          is_type_only: false,
          ..
        }) = specifier
          && let Some(names) = functions.get_mut(&id!(orig))
        {
          let name = match exported {
            Some(ModuleExportName::Ident(exported)) => exported.sym.clone(),
            Some(ModuleExportName::Str(exported)) => exported.value.to_string_lossy().into(),
            None => orig.sym.clone(),
          };
          names.push(name);
        }
      }
    }
  }

  let mut references = References {
    functions: &functions,
    function: None,
    in_assign_target: false,
    references: HashMap::new(),
    bail: false,
  };
  module.visit_with(&mut references);
  if references.bail {
    return HashMap::new();
  }

  // Exported functions referenced only from their own body.
  let removable = |function: &Id| {
    !functions[function].is_empty()
      && references
        .references
        .get(function)
        .is_none_or(|functions| functions.iter().all(|f| f.as_ref() == Some(function)))
  };

  let mut owners = HashMap::new();
  for import in imports {
    let Some(functions_using) = references.references.get(&import) else {
      continue;
    };
    let mut names = Vec::new();
    let only_removable_functions = functions_using.iter().all(|function| match function {
      Some(function) if removable(function) => {
        names.extend(functions[function].iter().cloned());
        true
      }
      _ => false,
    });
    if only_removable_functions {
      names.sort();
      names.dedup();
      owners.insert(import, names);
    }
  }
  owners
}

/// The bindings of the functions a declaration declares, with their names.
fn function_decls(decl: &Decl) -> Vec<(Id, JsWord)> {
  match decl {
    Decl::Fn(function) => vec![(id!(function.ident), function.ident.sym.clone())],
    Decl::Var(var) => var
      .decls
      .iter()
      .filter_map(
        |decl| match (&decl.name, decl.init.as_deref().map(Expr::unwrap_parens)) {
          (Pat::Ident(name), Some(Expr::Fn(_) | Expr::Arrow(_))) => {
            Some((id!(name.id), name.id.sym.clone()))
          }
          _ => None,
        },
      )
      .collect(),
    _ => Vec::new(),
  }
}

/// A key for `export default function () {}`, which has no binding.
fn anonymous_default_function() -> Id {
  ("*default*".into(), SyntaxContext::empty())
}

/// Records each reference to a binding, with the top-level function it is in, if any.
struct References<'a> {
  functions: &'a HashMap<Id, Vec<JsWord>>,
  /// The top-level function being visited.
  function: Option<Id>,
  /// Whether an assignment target is being visited, in which bindings are references.
  in_assign_target: bool,
  references: HashMap<Id, Vec<Option<Id>>>,
  /// Whether the module uses `eval` or `with`, so references can't be found statically.
  bail: bool,
}

impl References<'_> {
  fn add(&mut self, ident: &Ident) {
    if &*ident.sym == "eval" {
      self.bail = true;
    }
    self
      .references
      .entry(id!(ident))
      .or_default()
      .push(self.function.clone());
  }

  /// Visits the body of a top-level function, attributing references in it to the function.
  fn visit_function_body<N: VisitWith<Self>>(&mut self, function: Id, node: &N) {
    debug_assert!(self.functions.contains_key(&function));
    let outer = self.function.replace(function);
    node.visit_with(self);
    self.function = outer;
  }

  fn visit_top_level_decl(&mut self, decl: &Decl) {
    match decl {
      Decl::Fn(function) => self.visit_function_body(id!(function.ident), &function.function),
      Decl::Var(var) => {
        for decl in &var.decls {
          match (&decl.name, &decl.init) {
            (Pat::Ident(name), Some(init))
              if matches!(init.unwrap_parens(), Expr::Fn(_) | Expr::Arrow(_)) =>
            {
              self.visit_function_body(id!(name.id), init);
            }
            _ => decl.visit_with(self),
          }
        }
      }
      _ => decl.visit_with(self),
    }
  }
}

impl Visit for References<'_> {
  noop_visit_type!();

  fn visit_module_item(&mut self, item: &ModuleItem) {
    match item {
      ModuleItem::ModuleDecl(ModuleDecl::Import(_)) => {}
      ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(export)) => {
        self.visit_top_level_decl(&export.decl)
      }
      ModuleItem::Stmt(Stmt::Decl(decl)) => self.visit_top_level_decl(decl),
      ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ExportDefaultDecl {
        decl: DefaultDecl::Fn(function),
        ..
      })) => {
        let local = function
          .ident
          .as_ref()
          .map_or_else(anonymous_default_function, |ident| id!(ident));
        self.visit_function_body(local, &function.function);
      }
      ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(export)) => {
        if export.src.is_some() {
          return;
        }
        // Exporting a function under another name isn't a reference to it, but exporting an
        // import or another binding is.
        for specifier in &export.specifiers {
          if let ExportSpecifier::Named(ExportNamedSpecifier {
            orig: ModuleExportName::Ident(orig),
            ..
          }) = specifier
            && !self.functions.contains_key(&id!(orig))
          {
            self.add(orig);
          }
        }
      }
      _ => item.visit_children_with(self),
    }
  }

  fn visit_ident(&mut self, ident: &Ident) {
    self.add(ident);
  }

  fn visit_binding_ident(&mut self, ident: &BindingIdent) {
    // Declarations aren't references, but assigning to a binding is.
    if self.in_assign_target {
      self.add(&ident.id);
    }
  }

  fn visit_assign_target(&mut self, target: &AssignTarget) {
    let in_assign_target = std::mem::replace(&mut self.in_assign_target, true);
    target.visit_children_with(self);
    self.in_assign_target = in_assign_target;
  }

  fn visit_simple_assign_target(&mut self, target: &SimpleAssignTarget) {
    match target {
      SimpleAssignTarget::Ident(ident) => self.add(&ident.id),
      // Only the binding itself is assigned, not those in a member expression's object.
      _ => {
        let in_assign_target = std::mem::replace(&mut self.in_assign_target, false);
        target.visit_children_with(self);
        self.in_assign_target = in_assign_target;
      }
    }
  }

  fn visit_assign_pat(&mut self, pat: &AssignPat) {
    // The default value is an expression, even in an assignment target.
    pat.left.visit_with(self);
    let in_assign_target = std::mem::replace(&mut self.in_assign_target, false);
    pat.right.visit_with(self);
    self.in_assign_target = in_assign_target;
  }

  fn visit_function(&mut self, function: &Function) {
    let in_assign_target = std::mem::replace(&mut self.in_assign_target, false);
    function.visit_children_with(self);
    self.in_assign_target = in_assign_target;
  }

  // The names of declarations and labels aren't references.
  fn visit_fn_decl(&mut self, decl: &FnDecl) {
    decl.function.visit_with(self);
  }

  fn visit_fn_expr(&mut self, expr: &FnExpr) {
    expr.function.visit_with(self);
  }

  fn visit_class_decl(&mut self, decl: &ClassDecl) {
    decl.class.visit_with(self);
  }

  fn visit_class_expr(&mut self, expr: &ClassExpr) {
    expr.class.visit_with(self);
  }

  fn visit_labeled_stmt(&mut self, stmt: &LabeledStmt) {
    stmt.body.visit_with(self);
  }

  fn visit_break_stmt(&mut self, _: &BreakStmt) {}

  fn visit_continue_stmt(&mut self, _: &ContinueStmt) {}

  fn visit_with_stmt(&mut self, stmt: &WithStmt) {
    self.bail = true;
    stmt.visit_children_with(self);
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::transformer::test_utils::run_with_transformation;

  /// The owners of each owned import, by local name.
  fn owners(code: &str) -> Vec<(String, Vec<String>)> {
    let (_, owners) = run_with_transformation(code, |_, module| import_owners(module));
    let mut owners: Vec<_> = owners
      .into_iter()
      .map(|(local, names)| {
        (
          local.0.to_string(),
          names.iter().map(|name| name.to_string()).collect(),
        )
      })
      .collect();
    owners.sort();
    owners
  }

  fn expected(owners: &[(&str, &[&str])]) -> Vec<(String, Vec<String>)> {
    owners
      .iter()
      .map(|(local, names)| {
        (
          local.to_string(),
          names.iter().map(|name| name.to_string()).collect(),
        )
      })
      .collect()
  }

  #[test]
  fn imports_used_by_exported_functions() {
    assert_eq!(
      owners(
        "import {a, b} from 'x'; import c from 'y'; import * as ns from 'z';
        export function f() { return a() + ns.foo; }
        export const g = () => b;
        export const h = function () { return a(c); };
        export default function () { return c; }"
      ),
      expected(&[
        ("a", &["f", "h"]),
        ("b", &["g"]),
        ("c", &["default", "h"]),
        ("ns", &["f"]),
      ])
    );
  }

  #[test]
  fn imports_used_by_functions_in_export_lists() {
    assert_eq!(
      owners(
        "import {a} from 'x';
        function f() { return a; }
        const g = () => a;
        export {f, f as h, g as default};"
      ),
      expected(&[("a", &["default", "f", "h"])])
    );
  }

  #[test]
  fn functions_calling_themselves() {
    assert_eq!(
      owners("import {a} from 'x'; export function f(n) { return n ? f(n - 1) : a; }"),
      expected(&[("a", &["f"])])
    );
  }

  #[test]
  fn imports_used_otherwise() {
    for code in [
      // Used at the top level, or by something other than a function.
      "import {a} from 'x'; export function f() { return a; } console.log(a);",
      "import {a} from 'x'; export const f = a;",
      "import {a} from 'x'; export class C { m() { return a; } }",
      "import {a} from 'x'; export {a};",
      // The function is referenced elsewhere, so it isn't removed with its export.
      "import {a} from 'x'; export function f() { return a; } export function g() { return f(); }",
      "import {a} from 'x'; export function f() { return a; } f.displayName = 'f';",
      "import {a} from 'x'; export let f = () => a; f = null;",
      "import {a} from 'x'; function f() { return a; } export default f;",
      "import {a} from 'x'; export function f() { return a; } setTimeout(f);",
      // Not exported.
      "import {a} from 'x'; function f() { return a; }",
      // Not JavaScript evaluated by the module.
      "import a from 'x' with {type: 'url'}; export function f() { return a; }",
      // References can't be found statically.
      "import {a} from 'x'; export function f() { return a; } eval('f()');",
      "import {a} from 'x'; export function f() { with (o) { return a; } }",
    ] {
      assert_eq!(owners(code), expected(&[]), "{code}");
    }
  }

  #[test]
  fn shadowed_bindings_are_not_references() {
    assert_eq!(
      owners(
        "import {a} from 'x'; export function f() { return a; }
        function g() { const a = 1; return a; } g();"
      ),
      expected(&[("a", &["f"])])
    );
  }
}
