use swc_core::ecma::{
  ast::{CallExpr, Callee, Expr, MemberProp},
  visit::{Visit, VisitWith},
};

use parcel_core::{Dependency, DependencyFlags, Priority, SpecifierType};

use crate::transformer::{collect::Collect, utils::match_str};

/// This pass marks dependencies created inside a React.lazy call.
pub struct ReactLazy<'a> {
  collect: &'a Collect,
  deps: &'a mut Vec<Dependency>,
  in_lazy: bool,
}

impl<'a> ReactLazy<'a> {
  pub fn new(collect: &'a Collect, deps: &'a mut Vec<Dependency>) -> Self {
    ReactLazy {
      collect,
      deps,
      in_lazy: false,
    }
  }
}

impl<'a> Visit for ReactLazy<'a> {
  fn visit_call_expr(&mut self, node: &CallExpr) {
    if let Callee::Expr(expr) = &node.callee {
      match &**expr {
        Expr::Ident(id) => {
          if let Some(import) = self.collect.imports.get(&id.to_id()) {
            if import.source == "react" && import.specifier == "lazy" {
              self.in_lazy = true;
              node.visit_children_with(self);
              self.in_lazy = false;
              return;
            }
          }
        }
        Expr::Member(member) => {
          if let Expr::Ident(id) = &*member.obj {
            if let Some(import) = self.collect.imports.get(&id.to_id()) {
              if import.source == "react"
                && (import.specifier == "*" || import.specifier == "default")
                && matches!(&member.prop, MemberProp::Ident(id) if id.sym == "lazy")
              {
                self.in_lazy = true;
                node.visit_children_with(self);
                self.in_lazy = false;
                return;
              }
            }
          }
        }
        _ => {}
      }
    }

    node.visit_children_with(self);

    if !self.in_lazy {
      return;
    }

    let is_import = match &node.callee {
      Callee::Import(_) => true,
      Callee::Expr(expr) => matches!(&**expr, Expr::Ident(id) if id.sym == "require"),
      _ => false,
    };

    if !is_import {
      return;
    }

    if let Some(arg) = node.args.get(0) {
      if let Some((specifier, _)) = match_str(&*arg.expr) {
        for dep in self.deps.iter_mut() {
          // Dynamic imports.
          if dep.specifier_type == SpecifierType::Esm
            && dep.priority == Priority::Lazy
            && (*dep.specifier == *specifier
              || dep.placeholder.as_deref() == Some(specifier.as_str()))
          {
            dep.flags |= DependencyFlags::REACT_LAZY;
          }
        }
      }
    }
  }
}

#[cfg(test)]
mod test {
  use swc_core::ecma::visit::VisitWith;
  use swc_core::{common::Mark, ecma::ast::Module};

  use super::*;
  use crate::transformer::{
    Config, DependencyKind, SourceType,
    test_utils::{RunTestContext, run_with_transformation},
  };

  fn run(context: RunTestContext, module: &mut Module) {
    let mut deps = vec![Config::default().dependency(
      DependencyKind::DynamicImport,
      "./lazy",
      SourceType::Module,
      None,
    )];

    let mut collect = Collect::new(
      context.source_map.clone(),
      context.unresolved_mark,
      Mark::fresh(Mark::root()),
      false,
      true,
    );
    module.visit_with(&mut collect);
    module.visit_with(&mut ReactLazy::new(&collect, &mut deps));
    assert_eq!(deps[0].flags.bits(), DependencyFlags::REACT_LAZY.bits());
  }

  #[test]
  fn test_named_import() {
    let code = r#"
import {lazy} from 'react';

const Foo = lazy(() => import('./lazy'));
    "#;

    run_with_transformation(code, run);
  }

  fn test_renamed_import() {
    let code = r#"
  import {lazy as myLazy} from 'react';

  const Foo = myLazy(() => import('./lazy'));
      "#;
    run_with_transformation(code, run);
  }

  #[test]
  fn test_namespace_import() {
    let code = r#"
  import * as React from 'react';

  const Foo = React.lazy(() => import('./lazy'));
      "#;
    run_with_transformation(code, run);
  }

  #[test]
  fn test_default_import() {
    let code = r#"
  import React from 'react';

  const Foo = React.lazy(() => import('./lazy'));
      "#;
    run_with_transformation(code, run);
  }

  fn test_require() {
    let code = r#"
  const React = require('react');

  const Foo = React.lazy(() => import('./lazy'));
      "#;
    run_with_transformation(code, run);
  }

  fn test_require_destructure() {
    let code = r#"
  const {lazy} = require('react');

  const Foo = lazy(() => import('./lazy'));
      "#;
    run_with_transformation(code, run);
  }
}
