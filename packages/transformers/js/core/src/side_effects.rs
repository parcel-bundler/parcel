use std::collections::HashSet;
#[cfg(test)]
use std::path::PathBuf;
use swc_core::common::comments::SingleThreadedComments;
#[cfg(test)]
use swc_core::common::sync::Lrc;
#[cfg(test)]
use swc_core::common::{FileName, SourceMap};
use swc_core::ecma::ast::*;
use swc_core::ecma::atoms::{js_word, JsWord};
#[cfg(test)]
use swc_core::ecma::parser::lexer::Lexer;
#[cfg(test)]
use swc_core::ecma::parser::{EsConfig, Parser, StringInput, Syntax};
use swc_core::ecma::visit::{Visit, VisitWith};

use crate::hoist::ImportedSymbol;
use crate::id;
use crate::utils::{match_member_expr, match_str};

pub struct SideEffects<'a> {
  pub has_side_effects: bool,
  decls: HashSet<Id>,
  imports: HashSet<JsWord>,
  comments: &'a SingleThreadedComments,
  used_idents: Vec<JsWord>,
}

impl<'a> SideEffects<'a> {
  pub fn new(
    decls: HashSet<Id>,
    imported_symbols: &Vec<ImportedSymbol>,
    comments: &'a SingleThreadedComments,
  ) -> Self {
    let imports = HashSet::from_iter(
      imported_symbols
        .into_iter()
        .map(|symbol| symbol.local.clone()),
    );

    SideEffects {
      has_side_effects: false,
      decls,
      imports,
      comments,
      used_idents: vec![],
    }
  }

  // TODO use utils::match_require instead
  fn match_require(&self, node: &Expr) -> Option<JsWord> {
    match node {
      Expr::Call(call) => match &call.callee {
        Callee::Expr(expr) => match &**expr {
          Expr::Ident(ident) => {
            if ident.sym == js_word!("require")
              && !self.decls.contains(&(ident.sym.clone(), ident.span.ctxt))
            {
              if let Some(arg) = call.args.get(0) {
                return match_str(&arg.expr).map(|(name, _)| name);
              }
            }

            None
          }
          Expr::Member(member) => {
            if match_member_expr(member, vec!["module", "require"], &self.decls) {
              if let Some(arg) = call.args.get(0) {
                return match_str(&arg.expr).map(|(name, _)| name);
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

  fn is_safe_variable_assignment(&self, node: &PatOrExpr) -> bool {
    if let Some(ident) = node.as_ident() {
      return self.decls.contains(&id!(ident)) && !self.imports.contains(&ident.sym);
    }

    if let Some(expr) = node.as_expr() {
      match expr {
        Expr::Member(member_expr) => {
          if match_member_expr(&member_expr, vec!["module", "exports"], &self.decls)
            || match_member_expr(&member_expr, vec!["module", "hot"], &self.decls)
            || match_member_expr(&member_expr, vec!["module", "require"], &self.decls)
          {
            return true;
          }

          let mut member = Some(member_expr);
          let mut is_safe = false;

          while matches!(member, Some(..)) {
            match member.unwrap().obj.as_ref() {
              Expr::Member(member_expr) => {
                member = Some(&member_expr);
              }
              Expr::Ident(ident) => {
                is_safe = self.decls.contains(&id!(ident)) && !self.imports.contains(&ident.sym);
                member = None;
              }
              _ => {
                member = None;
              }
            }
          }

          return is_safe;
        }
        _ => return false,
      }
    }

    return false;
  }
}

impl<'a> Visit for SideEffects<'a> {
  fn visit_module(&mut self, node: &Module) {
    if node.body.len() == 0 {
      // We currently mark empty files as having side effects to avoid build errors
      // This situation mostly occurs from having types stripped from the file
      self.has_side_effects = true;
      return;
    }

    node.visit_children_with(self);
  }

  fn visit_module_item(&mut self, node: &ModuleItem) {
    match node {
      ModuleItem::Stmt(stmt) => {
        stmt.visit_with(self);
      }
      ModuleItem::ModuleDecl(decl) => match decl {
        ModuleDecl::ExportAll(..)
        | ModuleDecl::ExportDefaultDecl(..)
        | ModuleDecl::Import(..)
        | ModuleDecl::ExportNamed(..) => {}
        ModuleDecl::ExportDecl(export_decl) => {
          export_decl.decl.visit_with(self);
        }
        ModuleDecl::ExportDefaultExpr(export_expr) => {
          export_expr.expr.visit_with(self);
        }
        _ => {
          self.has_side_effects = true;
        }
      },
    }
  }

  fn visit_stmt(&mut self, node: &Stmt) {
    match node {
      Stmt::Empty(..) => {}
      Stmt::Block(block_stmt) => {
        block_stmt.visit_with(self);
      }
      Stmt::If(if_stmt) => {
        if_stmt.test.visit_with(self);
        if_stmt.cons.visit_with(self);
      }
      Stmt::Decl(decl) => {
        decl.visit_with(self);
      }
      Stmt::Expr(expr) => {
        if let Some(_source) = self.match_require(&expr.expr) {
          return;
        }

        expr.expr.visit_with(self);
      }
      _ => {
        self.has_side_effects = true;
      }
    }
  }

  fn visit_decl(&mut self, node: &Decl) {
    match node {
      Decl::Fn(..)
      | Decl::Class(..)
      | Decl::TsInterface(..)
      | Decl::TsEnum(..)
      | Decl::TsTypeAlias(..)
      | Decl::TsModule(..) => {}
      Decl::Var(var_decl) => {
        var_decl.visit_children_with(self);
      }
      _ => {
        self.has_side_effects = true;
      }
    }
  }

  fn visit_var_declarator(&mut self, node: &VarDeclarator) {
    node.name.visit_with(self);

    if self.has_side_effects {
      // If we've already found side effects bail early
      return;
    }

    if let Some(init) = &node.init {
      if let Some(..) = self.match_require(init) {
        return;
      }

      self.used_idents.clear();
      init.visit_with(self);

      if self
        .used_idents
        .iter()
        .any(|ident| self.imports.contains(ident))
      {
        // While this doesn't necessarily mean there are side effects. It means that an imported value
        // is referenced within a locally defined value and could get reassigned.
        // An improvement here could be to track mutation of this value.
        self.has_side_effects = true;
      }
    }
  }

  fn visit_pat(&mut self, node: &Pat) {
    match node {
      Pat::Ident(..) | Pat::Invalid(..) => {}
      Pat::Rest(rest_pat) => {
        rest_pat.arg.visit_with(self);
      }
      Pat::Array(array_pat) => {
        for child in &array_pat.elems {
          if let Some(child_pat) = child {
            child_pat.visit_with(self);
          }
        }
      }
      Pat::Object(object_pat) => {
        for prop in &object_pat.props {
          match prop {
            ObjectPatProp::Rest(rest_pat) => {
              rest_pat.arg.visit_with(self);
            }
            ObjectPatProp::KeyValue(key_value) => {
              key_value.key.visit_with(self);
              key_value.value.visit_with(self);
            }
            ObjectPatProp::Assign(assign) => {
              if let Some(value) = &assign.value {
                value.visit_with(self);
              }
            }
          }
        }
      }
      Pat::Assign(assign_pat) => {
        assign_pat.left.visit_with(self);
        assign_pat.right.visit_with(self);
      }
      Pat::Expr(expr) => {
        expr.visit_with(self);
      }
    }
  }

  fn visit_expr(&mut self, node: &Expr) {
    match node {
      Expr::Lit(..) => {
        // safe from side effects
      }
      Expr::Member(member) => {
        member.visit_with(self);
      }
      Expr::Ident(ident) => {
        self.used_idents.push(ident.sym.clone());
      }
      Expr::Array(array_lit) => {
        for elem in &array_lit.elems {
          if let Some(item) = &elem {
            item.expr.visit_with(self);
          }
        }
      }
      Expr::Object(object_lit) => {
        for prop_or_spread in &object_lit.props {
          match prop_or_spread {
            PropOrSpread::Prop(prop) => {
              match prop.as_ref() {
                Prop::Shorthand(shorthand) => {
                  shorthand.visit_with(self);
                }
                Prop::KeyValue(key_value) => {
                  key_value.key.visit_with(self);
                  key_value.value.visit_with(self);
                }
                Prop::Method(method) => {
                  method.key.visit_with(self);
                }
                Prop::Getter(getter) => {
                  getter.key.visit_with(self);

                  // We currenly have to assume this getter is called as we don't track
                  // their usage through the rest of the file
                  getter.body.visit_children_with(self);
                }
                Prop::Setter(setter) => {
                  setter.key.visit_with(self);

                  // We currenly have to assume this setter is called as we don't track
                  // their usage through the rest of the file
                  setter.body.visit_children_with(self);
                }
                Prop::Assign(..) => {
                  // Not sure this can actually occur
                  self.has_side_effects = true;
                }
              }
            }
            PropOrSpread::Spread(spread) => spread.expr.visit_with(self),
          }
        }
      }
      Expr::Assign(assign_expr) => {
        if !self.is_safe_variable_assignment(&assign_expr.left) {
          self.has_side_effects = true;
          return;
        }

        assign_expr.right.visit_with(self);
      }
      Expr::Call(call_expr) => {
        let mut is_pure_function = false;

        self.comments.with_leading(call_expr.span.lo, |comments| {
          is_pure_function = comments
            .into_iter()
            .any(|comment| comment.text == "#__PURE__");
        });

        if !is_pure_function {
          self.has_side_effects = true;
        }
      }
      Expr::Arrow(arrow) => {
        arrow.params.visit_with(self);
      }
      _ => {
        self.has_side_effects = true;
      }
    }
  }

  fn visit_prop_name(&mut self, node: &PropName) {
    match &node {
      PropName::Computed(computed) => {
        computed.expr.visit_with(self);
      }
      _ => {
        // All other key nodes are safe
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn empty_file() {
    let code = r#""#;

    assert_eq!(check_side_effects(code, vec![]), true);
  }

  #[test]
  fn barrel_file() {
    let code = r#"
    export * from './something';
    export { a, b as c } from './something-else';
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn function() {
    let code = r#"
      function a() {
        console.log();
      }
    "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn class() {
    let code = r#"
     class A {
        constructor() {}
     }
    "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn if_stmt_assignment() {
    let code = r#"
     let x = true;

     if (x) {
      x = false;
     }
    "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn if_stmt_effect() {
    let code = r#"
     if (!x) {
      window.something = true;
     }
    "#;

    assert_eq!(check_side_effects(code, vec![]), true);
  }

  #[test]
  fn while_loop_with_effect() {
    let code = r#"
    let i = 5;

    while (i > 0) {
      console.log(i--);
    }
    "#;

    assert_eq!(check_side_effects(code, vec![]), true);
  }

  #[test]
  fn export_function() {
    let code = r#"
     export function a() {
        console.log();
     }
    "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn export_default_function() {
    let code = r#"
     export default function a() {
        console.log();
     }
    "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn export_default_local() {
    let code = r#"
    const thing = '';
    export default thing;
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn export_class() {
    let code = r#"
     export class A {
        constructor() {}
     }
    "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn export_default_class() {
    let code = r#"
     export default class A {
        constructor() {}
     }
    "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn export_named() {
    let code = r#"
     export {
        a,
        b as c
     }
    "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn export_const_decalation() {
    let code = r#"
     export const a = '';
    "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn side_effect_import() {
    let code = r#"
     import './some-file';
    "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn destructure_array_with_spread() {
    let code = r#"
    const [a, b, ...{ a: b }] = [];
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn destructure_object_with_spread() {
    let code = r#"
    const {a, b} = {a: '', b: ''};
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn computed_obj_key_literal() {
    let code = r#"
    const obj = {
      ['safe']: 'phew'
    }
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn computed_obj_key_call() {
    let code = r#"
    const obj = {
      [fn()]: 'ohh oh'
    }
  "#;

    assert_eq!(check_side_effects(code, vec![]), true);
  }

  #[test]
  fn top_level_require_declarator() {
    let code = r#"
  var one = require('./one');
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn top_level_require() {
    let code = r#"
  require('./one');
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn commonjs() {
    let code = r#"
  const one = require('./one');

  const myOne = () => one();

  module.exports = myOne;
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn pure_function_call() {
    let code = r#"
  import { pureFn } from './pure';

  const myOne = /*#__PURE__*/pureFn();
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn unknown_function_call() {
    let code = r#"
  import { unknownFn } from './pure';

  const myOne = unknownFn();
  "#;

    assert_eq!(check_side_effects(code, vec![]), true);
  }

  #[test]
  fn assignment_to_local() {
    let code = r#"
  let thing = '';

  thing = 'ThingName';

  export default thing;
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn assignment_to_local_member() {
    let code = r#"
  const Thing = {};

  Thing.name = 'ThingName';

  export default Thing;
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn window_set() {
    let code = r#"
    window._someGlobal = a;
    "#;

    assert_eq!(check_side_effects(code, vec![]), true);
  }

  #[test]
  fn set_unknown_var() {
    let code = r#"
    myGlobal = 'test';
    "#;

    assert_eq!(check_side_effects(code, vec![]), true);
  }

  #[test]
  fn top_level_call_expression() {
    let code = r#"
    doGlobalStuff();
    "#;

    assert_eq!(check_side_effects(code, vec![]), true);
  }

  #[test]
  fn assign_to_import() {
    let code = r#"
  import value from './value';

  value = 'something new';
  "#;

    assert_eq!(check_side_effects(code, vec!["value"]), true);
  }

  #[test]
  fn assign_to_import_member() {
    let code = r#"
  import value from './value';

  value.nested = 'something new';
  "#;

    assert_eq!(check_side_effects(code, vec!["value"]), true);
  }

  #[test]
  fn assign_to_reassigned_import_member() {
    let code = r#"
  import value from './value';

  let newValue = value;

  newValue.nested = 'something new';
  "#;

    assert_eq!(check_side_effects(code, vec!["value"]), true);
  }

  #[test]
  fn assign_to_nested_reassigned_import_member() {
    let code = r#"
    import value from './value';

    let newValue = {
      something: value
    };
  
    newValue.something.nested = 'something new';
  "#;

    assert_eq!(check_side_effects(code, vec!["value"]), true);
  }

  #[test]
  fn assign_to_nested_reassigned_member() {
    let code = r#"
    const value = {nested: 'something'};

    let newValue = {
      something: value
    };
  
    newValue.something.nested = 'something new';
  "#;

    assert_eq!(check_side_effects(code, vec![]), false);
  }

  #[test]
  fn assign_to_reassigned_import_in_array() {
    let code = r#"
    import value from './value';

    let newValue = [value];
  
    newValue[0].prop = 'something new';
  "#;

    assert_eq!(check_side_effects(code, vec!["value"]), true);
  }

  #[test]
  fn assign_to_reassigned_import_from_member() {
    let code = r#"
    import value from './value';

    let valueFromImport = value.prop;
    valueFromImport = 'something new';
  "#;

    assert_eq!(check_side_effects(code, vec!["value"]), true);
  }

  #[test]
  fn setter() {
    let code = r#"
    let obj = {
      set value(newValue) {
        window.value = newValue;
      }
    };  
  "#;

    assert_eq!(check_side_effects(code, vec![]), true);
  }

  #[test]
  fn getter() {
    let code = r#"
    let obj = {
      get value() {
        window.value = 'something';

        return window.value;
      }
    };  
  "#;

    assert_eq!(check_side_effects(code, vec![]), true);
  }

  #[test]
  fn generic_react_file() {
    let code = r#"
  import Component from './component';

  const config = {
    stuff: true
  };

  const util = (value) => config[value];

  const MyComponent = ({ prop }) => React.createElement(Component, {
    prop: util(prop)
  });
  MyComponent.displayName = 'MyComponent';

  export default MyComponent;
  "#;

    assert_eq!(check_side_effects(code, vec!["Component"]), false);
  }

  fn check_side_effects(code: &str, imports: Vec<&str>) -> bool {
    use crate::decl_collector::collect_decls;

    let source_file = Lrc::new(SourceMap::default())
      .new_source_file(FileName::Real(PathBuf::from("test.js")), code.into());

    let comments = SingleThreadedComments::default();
    let lexer = Lexer::new(
      Syntax::Es(EsConfig {
        jsx: true,
        export_default_from: true,
        decorators: false,
        ..Default::default()
      }),
      Default::default(),
      StringInput::from(&*source_file),
      Some(&comments),
    );

    let mut parser = Parser::new_from(lexer);
    let module = parser.parse_program().unwrap();

    // If it's a script, convert into module. This needs to happen after
    // the resolver (which behaves differently for non-/strict mode).
    let module = match module {
      Program::Module(module) => module,
      Program::Script(script) => Module {
        span: script.span,
        shebang: None,
        body: script.body.into_iter().map(ModuleItem::Stmt).collect(),
      },
    };

    let mut imports_set = HashSet::new();

    for import in imports {
      imports_set.insert(JsWord::from(import));
    }

    let mut side_effects = SideEffects {
      has_side_effects: false,
      decls: collect_decls(&module),
      imports: imports_set,
      comments: &comments,
      used_idents: vec![],
    };

    module.visit_with(&mut side_effects);

    side_effects.has_side_effects
  }
}
