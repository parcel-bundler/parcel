use std::{
  cell::{Ref, RefCell},
  collections::HashSet,
  vec,
};

use ast::*;
use indexmap::IndexMap;
use parcel_core::{Diagnostic, DiagnosticSeverity};
use parcel_evaluator::{Evaluate, Evaluator, JsValue, Object};
use std::rc::Rc;
use swc_core::{
  common::{DUMMY_SP, Mark, Span, SyntaxContext, sync::Lrc},
  ecma::{
    ast,
    atoms::Atom as JsWord,
    visit::{VisitMut, VisitMutWith},
  },
};

use crate::{
  dependency_collector2::{DependencyCollector, UpdateExpr},
  utils::*,
};

/// Replaces process.env usage with the literal strings for values referenced.
pub struct EnvReplacer<'a> {
  pub replace_env: bool,
  pub is_browser: bool,
  pub env: &'a IndexMap<JsWord, JsWord>,
  pub used_env: &'a mut HashSet<JsWord>,
  pub source_map: Lrc<swc_core::common::SourceMap>,
  pub diagnostics: &'a mut Vec<Diagnostic>,
  pub unresolved_mark: Mark,
  pub env_object: Rc<EnvObject>,
  pub evaluator: Evaluator<'a>,
}

pub struct Process {
  pub env: Rc<EnvObject>,
  pub browser: bool,
}

impl Object for Process {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "env" => JsValue::Object(self.env.clone().into()),
      "browser" => {
        if self.browser {
          JsValue::Bool(true)
        } else {
          JsValue::Unknown(span)
        }
      }
      _ => JsValue::Unknown(span),
    }
  }

  fn has(&self, prop: &JsValue) -> bool {
    matches!(prop.to_string().as_str(), "env" | "browser")
  }
}

impl UpdateExpr for Process {
  fn update_expr(
    &self,
    _node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    collector.add_import("process", "process", None);
    Ok(())
  }
}

pub struct EnvObject {
  env: IndexMap<JsWord, JsWord>,
  used_env: RefCell<HashSet<JsWord>>,
}

impl EnvObject {
  pub fn new(env: IndexMap<JsWord, JsWord>) -> Self {
    Self {
      env,
      used_env: RefCell::new(HashSet::new()),
    }
  }
}

impl Object for EnvObject {
  fn get(&self, prop: &JsValue, span: swc_core::common::Span) -> JsValue {
    let key = prop.to_string();
    match key.as_str() {
      // don't replace process.env.hasOwnProperty with undefined
      // "hasOwnProperty"
      "isPrototypeOf"
      | "propertyIsEnumerable"
      | "toLocaleString"
      | "toSource"
      | "toString"
      | "valueOf" => return JsValue::Unknown(span),
      _ => {}
    }

    if key == "hasOwnProperty" {
      return JsValue::Function((&has_own_property).into());
    }

    let res = self
      .env
      .get(&key)
      .map(|v| JsValue::String(v.clone()))
      .unwrap_or(JsValue::Undefined);

    self.used_env.borrow_mut().insert(key);
    res
  }

  fn has(&self, prop: &JsValue) -> bool {
    let key = prop.to_string();
    let res = self.env.contains_key(&key);
    self.used_env.borrow_mut().insert(key);
    res
  }

  fn entries<'s>(&'s self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 's> {
    self.used_env.borrow_mut().extend(self.env.keys().cloned());
    Box::new(
      self
        .env
        .iter()
        .map(|(k, v)| (k.clone(), JsValue::String(v.clone()))),
    )
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    Ok(Expr::Object(ObjectLit {
      span: DUMMY_SP,
      props: {
        let mut props = Vec::new();
        for (k, v) in self.entries() {
          props.push(PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
            key: if Ident::verify_symbol(&k).is_ok() {
              PropName::Ident(IdentName::new(k.clone().into(), DUMMY_SP))
            } else {
              PropName::Str(Str {
                value: k.clone().into(),
                span: DUMMY_SP,
                raw: None,
              })
            },
            value: Box::new(v.clone().into_expr()?),
          }))));
        }

        props
      },
    }))
  }
}

fn has_own_property(
  this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let (JsValue::Object(obj), Some(prop)) = (this, args.get(0)) {
    JsValue::Bool(obj.has(prop))
  } else {
    JsValue::Unknown(span)
  }
}

impl<'a> EnvReplacer<'a> {
  pub fn new(
    replace_env: bool,
    is_browser: bool,
    env: &'a IndexMap<JsWord, JsWord>,
    used_env: &'a mut HashSet<JsWord>,
    source_map: Lrc<swc_core::common::SourceMap>,
    diagnostics: &'a mut Vec<Diagnostic>,
    unresolved_mark: Mark,
  ) -> Self {
    let mut evaluator = Evaluator::new();

    let env_object = Rc::new(EnvObject {
      env: env.clone(),
      used_env: RefCell::new(HashSet::new()),
    });

    evaluator.add_value(
      (
        "process".into(),
        SyntaxContext::empty().apply_mark(unresolved_mark),
      ),
      JsValue::Object(
        Rc::new(indexmap::indexmap! {
          "env".into() => if replace_env {
            JsValue::Object(env_object.clone().into())
          } else {
            JsValue::Unknown(DUMMY_SP)
          },
          "browser".into() => if is_browser {
            JsValue::Bool(true)
          } else {
            JsValue::Unknown(DUMMY_SP)
          }
        })
        .into(),
      ),
    );

    Self {
      replace_env,
      is_browser,
      env,
      used_env,
      source_map,
      diagnostics,
      unresolved_mark,
      env_object,
      evaluator,
    }
  }
}

impl<'a> VisitMut for EnvReplacer<'a> {
  fn visit_mut_expr(&mut self, node: &mut Expr) {
    if matches!(node, Expr::Ident(_) | Expr::Lit(_)) {
      node.visit_mut_children_with(self);
      return;
    }

    if let Expr::Assign(assign) = node {
      if !self.replace_env {
        node.visit_mut_children_with(self);
        return;
      }

      // process.env = ...;
      // process.env.FOO = ...;
      if let AssignTarget::Simple(SimpleAssignTarget::Member(member)) = &assign.left {
        if matches!(member.obj.evaluate(&self.evaluator), JsValue::Object(obj) if obj.as_any().is::<EnvObject>())
          || matches!(member.evaluate(&self.evaluator), JsValue::Object(obj) if obj.as_any().is::<EnvObject>())
        {
          self.emit_mutating_error(assign.span);
          assign.right.visit_mut_with(self);
          *node = *assign.right.clone();
          return;
        }
      }

      if let Expr::Member(member) = &*assign.right {
        let right = member.evaluate(&self.evaluator);
        if assign.op == AssignOp::Assign
          && matches!(right, JsValue::Object(ref obj) if obj.as_any().is::<EnvObject>())
        {
          let pat = match &assign.left {
            // ({x, y, z, ...} = process.env);
            AssignTarget::Simple(SimpleAssignTarget::Ident(ident)) => {
              Some(Pat::Ident(ident.clone()))
            }
            // foo = process.env;
            AssignTarget::Pat(AssignTargetPat::Object(obj)) => Some(obj.clone().into()),
            _ => None,
          };
          if let Some(pat) = pat {
            let mut exprs = vec![];
            self.evaluator.eval_pat(
              member.evaluate(&self.evaluator),
              &pat,
              &mut |_evaluator, id, value| {
                exprs.push(Box::new(Expr::Assign(AssignExpr {
                  span: DUMMY_SP,
                  op: AssignOp::Assign,
                  left: AssignTarget::Simple(SimpleAssignTarget::Ident(BindingIdent {
                    id: Ident::new(id.0, DUMMY_SP, id.1),
                    type_ann: None,
                  })),
                  right: Box::new(value.into_expr().unwrap()),
                })));
              },
            );

            if !matches!(pat, Pat::Ident(..)) {
              exprs.push(Box::new(right.into_expr().unwrap()));
            }

            *node = Expr::Seq(SeqExpr {
              span: assign.span,
              exprs,
            });
            return;
          }
        }
      }
    }

    // if self.replace_env {
    //   match &node {
    //     // e.g. delete process.env.SOMETHING
    //     Expr::Unary(UnaryExpr { op: UnaryOp::Delete, arg, span, .. }) |
    //     // e.g. process.env.UPDATE++
    //     Expr::Update(UpdateExpr { arg, span, .. }) => {
    //       if let Expr::Member(MemberExpr { obj, .. }) = &**arg {
    //         if let Expr::Member(member) = &**obj {
    //           if matches!(member.evaluate(&self.evaluator), JsValue::Object(obj) if obj.as_any().is::<EnvObject>()) {
    //             self.emit_mutating_error(*span);
    //             *node = match &node {
    //               Expr::Unary(_) => Expr::Lit(Lit::Bool(Bool { span: *span, value: true })),
    //               Expr::Update(_) => {
    //                 // TODO: This can be written to run in-place to make it more efficient
    //                 let mut replacement = *arg.clone();
    //                 replacement.visit_mut_with(self);
    //                 replacement
    //               }
    //               _ => unreachable!()
    //             };
    //           }
    //         }
    //       }
    //     },
    //     _ => {}
    //   }
    // }

    let value = node.evaluate(&self.evaluator);
    if let Ok(expr) = value.into_expr() {
      *node = expr;
    }

    node.visit_mut_children_with(self);
  }

  fn visit_mut_var_decl(&mut self, node: &mut VarDecl) {
    if !self.replace_env {
      node.visit_mut_children_with(self);
      return;
    }

    let mut decls = vec![];
    for decl in &node.decls {
      if let Some(init) = &decl.init {
        if let Expr::Member(member) = &**init {
          let init = member.evaluate(&self.evaluator);
          if matches!(init, JsValue::Object(obj) if obj.as_any().is::<EnvObject>()) {
            self.evaluator.eval_pat(
              member.evaluate(&self.evaluator),
              &decl.name,
              &mut |_evaluator, id, value| {
                decls.push(VarDeclarator {
                  span: DUMMY_SP,
                  name: Pat::Ident(BindingIdent {
                    id: Ident::new(id.0, DUMMY_SP, id.1),
                    type_ann: None,
                  }),
                  init: Some(Box::new(value.into_expr().unwrap())),
                  definite: false,
                });
              },
            );
            continue;
          }
        }
      }

      let mut decl = decl.clone();
      decl.visit_mut_with(self);
      decls.push(decl);
    }

    *node = VarDecl {
      span: node.span,
      kind: node.kind,
      decls,
      declare: node.declare,
      ctxt: node.ctxt,
    };
  }

  fn visit_mut_module(&mut self, node: &mut Module) {
    node.visit_mut_children_with(self);

    for key in self.env_object.used_env.borrow().iter() {
      self.used_env.insert(key.clone());
    }
  }
}

impl<'a> EnvReplacer<'a> {
  fn emit_mutating_error(&mut self, span: swc_core::common::Span) {
    let mut d = Diagnostic::from_loc(
      loc(span, &self.source_map),
      "Mutating process.env is not supported",
    );
    d.severity = DiagnosticSeverity::SourceError;
    self.diagnostics.push(d);
  }
}

#[cfg(test)]
mod test {
  use crate::test_utils::{RunTestContext, RunVisitResult, run_visit};

  use super::*;

  fn make_env_replacer<'a>(
    run_test_context: RunTestContext,
    env: &'a IndexMap<JsWord, JsWord>,
    used_env: &'a mut HashSet<JsWord>,
    diagnostics: &'a mut Vec<Diagnostic>,
  ) -> EnvReplacer<'a> {
    EnvReplacer::new(
      true,
      true,
      env,
      used_env,
      run_test_context.source_map.clone(),
      diagnostics,
      run_test_context.unresolved_mark,
    )
  }

  #[test]
  fn test_replacer_disabled() {
    let env: IndexMap<JsWord, JsWord> = IndexMap::new();
    let mut used_env = HashSet::new();
    let mut diagnostics = Vec::new();

    let RunVisitResult { output_code, .. } = run_visit(
      r#"process.browser = '1234';
console.log('thing' in process.env);
const isTest = process.env.IS_TEST === "true";
const { package, IS_TEST: isTest2, ...other } = process.env;
"#,
      |run_test_context: RunTestContext| {
        EnvReplacer::new(
          false,
          true,
          &env,
          &mut used_env,
          run_test_context.source_map.clone(),
          &mut diagnostics,
          run_test_context.unresolved_mark,
        )
      },
    );

    // transforms the inline value
    assert_eq!(
      output_code,
      r#"process.browser = '1234';
console.log('thing' in process.env);
const isTest = process.env.IS_TEST === "true";
const { package, IS_TEST: isTest2, ...other } = process.env;
"#,
    );
  }

  // TODO: This behaviour should be removed and will be disabled for canary builds.
  #[test]
  fn test_replace_browser_assignments() {
    let env: IndexMap<JsWord, JsWord> = IndexMap::new();
    let mut used_env = HashSet::new();
    let mut diagnostics = Vec::new();

    let RunVisitResult { output_code, .. } = run_visit(
      r#"
process.browser = '1234';
other = '1234';
console.log(process.browser = false);
console.log(other = false);
    "#,
      |run_test_context: RunTestContext| {
        make_env_replacer(run_test_context, &env, &mut used_env, &mut diagnostics)
      },
    );

    // transforms the inline value
    assert_eq!(
      output_code,
      r#"process.browser = '1234';
other = '1234';
console.log(process.browser = false);
console.log(other = false);
"#
    );
    // tracks that the variable was used
    assert_eq!(used_env, HashSet::new());
    assert_eq!(diagnostics, vec![]);
  }

  #[test]
  fn test_replace_env_assignments() {
    let env: IndexMap<JsWord, JsWord> = IndexMap::new();
    let mut used_env = HashSet::new();
    let mut diagnostics = Vec::new();

    let RunVisitResult { output_code, .. } = run_visit(
      r#"
process.env = {};
    "#,
      |run_test_context: RunTestContext| {
        make_env_replacer(run_test_context, &env, &mut used_env, &mut diagnostics)
      },
    );

    // transforms the inline value
    assert_eq!(
      output_code,
      r#"{};
"#
    );
    // tracks that the variable was used
    assert_eq!(used_env, HashSet::new());
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(
      diagnostics[0].message,
      "Mutating process.env is not supported"
    );
  }

  #[test]
  fn test_replace_env_member_assignments() {
    let env: IndexMap<JsWord, JsWord> = IndexMap::new();
    let mut used_env = HashSet::new();
    let mut diagnostics = Vec::new();

    let RunVisitResult { output_code, .. } = run_visit(
      r#"
process.env.PROP = 'other';
delete process.env.PROP;
process.env.PROP++;
    "#,
      |run_test_context: RunTestContext| {
        make_env_replacer(run_test_context, &env, &mut used_env, &mut diagnostics)
      },
    );

    // transforms the inline value
    assert_eq!(
      output_code,
      r#"'other';
true;
void 0;
"#
    );
    // tracks that the variable was used
    assert_eq!(used_env, HashSet::from(["PROP".into()]));
    assert_eq!(diagnostics.len(), 3);
    assert_eq!(
      diagnostics[0].message,
      "Mutating process.env is not supported"
    );
    assert_eq!(
      diagnostics[1].message,
      "Mutating process.env is not supported"
    );
    assert_eq!(
      diagnostics[2].message,
      "Mutating process.env is not supported"
    );
  }

  #[test]
  fn test_replace_env_in_expressions() {
    let mut env: IndexMap<JsWord, JsWord> = IndexMap::new();
    let mut used_env = HashSet::new();
    let mut diagnostics = Vec::new();

    env.insert("foo".into(), "foo".into());

    let RunVisitResult { output_code, .. } = run_visit(
      r#"
console.log(foo = process.env);
const x = ({ foo, ...others } = process.env);
    "#,
      |run_test_context: RunTestContext| {
        make_env_replacer(run_test_context, &env, &mut used_env, &mut diagnostics)
      },
    );

    assert_eq!(
      output_code,
      r#"console.log(foo = {
    foo: "foo"
});
const x = (foo = "foo", others = {}, {
    foo: "foo"
});
"#
    );
    // tracks that the variable was used
    assert_eq!(used_env, HashSet::from(["foo".into()]));
    assert_eq!(diagnostics.len(), 0);
  }

  #[test]
  fn test_replace_process_dot_browser() {
    let env: IndexMap<JsWord, JsWord> = IndexMap::new();
    let mut used_env = HashSet::new();
    let mut diagnostics = Vec::new();

    let RunVisitResult { output_code, .. } = run_visit(
      r#"
console.log(process.browser);
function run(enabled = process.browser) {}
    "#,
      |run_test_context: RunTestContext| {
        make_env_replacer(run_test_context, &env, &mut used_env, &mut diagnostics)
      },
    );

    // transforms the inline value
    assert_eq!(
      output_code,
      r#"console.log(true);
function run(enabled = true) {}
"#
    );
    // tracks that the variable was used
    assert_eq!(used_env, HashSet::new());
    assert_eq!(diagnostics, vec![]);
  }

  #[test]
  fn test_replace_foo_in_process_env() {
    let mut env: IndexMap<JsWord, JsWord> = IndexMap::new();
    let mut used_env = HashSet::new();
    let mut diagnostics = Vec::new();

    env.insert("thing".into(), "here".into());

    let RunVisitResult { output_code, .. } = run_visit(
      r#"
console.log('thing' in process.env);
console.log('other' in process.env);
    "#,
      |run_test_context: RunTestContext| {
        make_env_replacer(run_test_context, &env, &mut used_env, &mut diagnostics)
      },
    );

    // transforms the inline value
    assert_eq!(
      output_code,
      r#"console.log(true);
console.log(false);
"#
    );
    // tracks that the variable was used
    assert_eq!(used_env, HashSet::from(["thing".into(), "other".into()]));
    assert_eq!(diagnostics, vec![]);
  }

  #[test]
  fn test_unrelated_code_is_not_affected() {
    let env: IndexMap<JsWord, JsWord> = IndexMap::new();
    let mut used_env = HashSet::new();
    let mut diagnostics = Vec::new();

    let RunVisitResult { output_code, .. } = run_visit(
      r#"
const isTest = process.something;
const version = process.env.hasOwnProperty('version');
    "#,
      |run_test_context: RunTestContext| {
        make_env_replacer(run_test_context, &env, &mut used_env, &mut diagnostics)
      },
    );

    // transforms the inline value
    assert_eq!(
      output_code,
      r#"const isTest = process.something;
const version = false;
"#
    );
    // tracks that the variable was used
    assert_eq!(used_env, HashSet::from(["version".into()]));
    assert_eq!(diagnostics, vec![]);
  }

  #[test]
  fn test_replace_env_has_the_variable() {
    let mut env: IndexMap<JsWord, JsWord> = IndexMap::new();
    let mut used_env = HashSet::new();
    let mut diagnostics = Vec::new();

    env.insert("IS_TEST".into(), "true".into());
    env.insert("VERSION".into(), "1.2.3".into());
    env.insert("package".into(), "parcel".into());

    let RunVisitResult { output_code, .. } = run_visit(
      r#"
const isTest = process.env.IS_TEST === "true";
const version = process.env['VERSION'];
const { package, IS_TEST: isTest2 } = process.env;
    "#,
      |run_test_context: RunTestContext| {
        make_env_replacer(run_test_context, &env, &mut used_env, &mut diagnostics)
      },
    );

    // transforms the inline value
    assert_eq!(
      output_code,
      r#"const isTest = true;
const version = "1.2.3";
const package = "parcel", isTest2 = "true";
"#
    );
    // tracks that the variable was used
    assert_eq!(
      used_env,
      ["package", "IS_TEST", "VERSION"]
        .iter()
        .map(|s| (*s).into())
        .collect()
    );
    assert_eq!(diagnostics, vec![]);
  }

  #[test]
  fn test_replace_env_rest_spread() {
    let mut env: IndexMap<JsWord, JsWord> = IndexMap::new();
    let mut used_env = HashSet::new();
    let mut diagnostics = Vec::new();

    env.insert("package".into(), "parcel".into());

    let RunVisitResult { output_code, .. } = run_visit(
      r#"
const { package, ...other } = process.env;
    "#,
      |run_test_context: RunTestContext| {
        make_env_replacer(run_test_context, &env, &mut used_env, &mut diagnostics)
      },
    );

    // transforms the inline value
    assert_eq!(
      output_code,
      r#"const package = "parcel", other = {};
"#
    );
    // tracks that the variable was used
    assert_eq!(used_env, ["package"].iter().map(|s| (*s).into()).collect());
    assert_eq!(diagnostics, vec![]);
  }

  #[test]
  fn test_assign_env_to_variable() {
    let mut env: IndexMap<JsWord, JsWord> = IndexMap::new();
    let mut used_env = HashSet::new();
    let mut diagnostics = Vec::new();

    env.insert("A".into(), "A".into());
    env.insert("B".into(), "B".into());
    env.insert("C".into(), "C".into());

    let RunVisitResult { output_code, .. } = run_visit(
      r#"
const env = process.env;
    "#,
      |run_test_context: RunTestContext| {
        make_env_replacer(run_test_context, &env, &mut used_env, &mut diagnostics)
      },
    );

    // transforms the inline value
    assert_eq!(
      output_code,
      r#"const env = {
    A: "A",
    B: "B",
    C: "C"
};
"#
    );
    // tracks that the variable was used
    assert_eq!(
      used_env,
      HashSet::from(["A".into(), "B".into(), "C".into()])
    );
    assert_eq!(diagnostics, vec![]);
  }
}
