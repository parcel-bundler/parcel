use swc_ecmascript::ast::{
  Bool, CallExpr, Callee, Expr, ExprOrSpread, FnExpr, Ident, KeyValueProp, Lit, MemberExpr,
  MemberProp, MethodProp, ObjectLit, Prop, PropName, PropOrSpread, Str,
};

use swc_common::DUMMY_SP;
use swc_ecmascript::visit::{Fold, FoldWith};

use crate::{fold_member_expr_skip_prop, hoist::Collect, utils::match_module_reference};

struct ReactNativeReplacer<'a> {
  pub platforms: Vec<String>,
  pub collect: &'a Collect,
  pub is_development: bool,
}

pub fn react_native_replacer(
  platform: Option<String>,
  collect: &'_ Collect,
  is_development: bool,
) -> impl Fold + '_ {
  ReactNativeReplacer {
    platforms: if let Some(plat) = platform {
      vec![plat, "native".to_owned()]
    } else {
      vec![]
    },
    collect,
    is_development,
  }
}

impl<'a> Fold for ReactNativeReplacer<'a> {
  fn fold_expr(&mut self, node: Expr) -> Expr {
    match &node {
      Expr::Member(MemberExpr {
        obj,
        prop: MemberProp::Ident(Ident { sym: prop_id, .. }),
        ..
      }) => {
        if self.match_platform(&**obj) && prop_id == "OS" {
          return Expr::Lit(Lit::Str(Str {
            raw: None,
            span: DUMMY_SP,
            value: self.platforms[0].as_str().into(),
          }));
        }
      }
      Expr::Call(CallExpr { callee, args, .. }) => {
        if let Callee::Expr(expr) = callee {
          if let Expr::Member(MemberExpr {
            obj,
            prop: MemberProp::Ident(Ident { sym: prop_id, .. }),
            ..
          }) = &**expr
          {
            if self.match_platform(&**obj) && prop_id.as_ref() == "select" {
              if let Some(ExprOrSpread { spread: None, expr }) = args.get(0) {
                if let Expr::Object(ObjectLit { props, .. }) = &**expr {
                  let mut item: Option<(usize, Expr)> = None;

                  let mut assign_if_more_specific = |id: &Ident, expr: Expr| {
                    let index = if id.as_ref() == "default" {
                      usize::MAX / 2
                    } else {
                      self
                        .platforms
                        .iter()
                        .position(|f| *f == id.as_ref())
                        .unwrap_or(usize::MAX)
                    };
                    match item {
                      Some((index_existing, _)) => {
                        if index < index_existing {
                          item = Some((index, expr));
                        }
                      }
                      _ => item = Some((index, expr)),
                    };
                  };

                  for i in props {
                    match i {
                      PropOrSpread::Prop(prop) => match &**prop {
                        Prop::KeyValue(KeyValueProp { key, value }) => {
                          if let PropName::Ident(id) = key {
                            assign_if_more_specific(id, *value.clone());
                          }
                        }
                        Prop::Method(MethodProp { key, function }) => {
                          if let PropName::Ident(id) = key {
                            assign_if_more_specific(
                              id,
                              Expr::Fn(FnExpr {
                                ident: None,
                                function: function.clone(),
                              }),
                            );
                          }
                        }
                        _ => return node.fold_children_with(self),
                      },
                      _ => return node.fold_children_with(self),
                    }
                  }

                  if let Some((_, expr)) = item {
                    return expr.fold_with(self);
                  };
                }
              };
            }
          }
        }
      }
      Expr::Ident(id) => {
        if self
          .collect
          .decls
          .contains(&(id.sym.clone(), id.span.ctxt()))
        {
          return node;
        }

        if &id.sym == "__DEV__" {
          return Expr::Lit(Lit::Bool(Bool {
            value: self.is_development,
            span: DUMMY_SP,
          }));
        }
      }
      _ => {}
    }

    node.fold_children_with(self)
  }

  fold_member_expr_skip_prop! {}
}

impl<'a> ReactNativeReplacer<'a> {
  fn match_platform(&self, node: &Expr) -> bool {
    if let Some((source, specifier)) = match_module_reference(self.collect, node) {
      return &source == "react-native" && &specifier == "Platform";
    }
    false
  }
}

#[cfg(test)]
mod tests {
  use crate::decl_collector::collect_decls;

  use super::*;
  use indoc::indoc;
  use swc_common::chain;
  use swc_common::comments::SingleThreadedComments;
  use swc_common::{sync::Lrc, FileName, Globals, Mark, SourceMap};
  use swc_ecmascript::ast::Module;
  use swc_ecmascript::codegen::text_writer::JsWriter;
  use swc_ecmascript::parser::lexer::Lexer;
  use swc_ecmascript::parser::{Parser, StringInput};
  use swc_ecmascript::transforms::{fixer, hygiene, resolver};
  use swc_ecmascript::visit::VisitWith;

  fn parse(code: &str) -> String {
    let source_map = Lrc::new(SourceMap::default());
    let source_file = source_map.new_source_file(FileName::Anon, code.into());

    let comments = SingleThreadedComments::default();
    let lexer = Lexer::new(
      Default::default(),
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
            let unresolved_mark = Mark::fresh(Mark::root());
            let global_mark = Mark::fresh(Mark::root());
            let module = module.fold_with(&mut resolver(unresolved_mark, global_mark, false));

            let mut collect = Collect::new(
              source_map.clone(),
              collect_decls(&module),
              Mark::fresh(Mark::root()),
              global_mark,
              false,
            );
            module.visit_with(&mut collect);

            let module = {
              let mut hoist = ReactNativeReplacer {
                platforms: vec!["android".to_owned(), "native".to_owned()],
                collect: &collect,
                is_development: true,
              };
              module.fold_with(&mut hoist)
            };

            let module = module.fold_with(&mut chain!(hygiene(), fixer(Some(&comments))));
            emit(source_map, comments, &module)
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
      let config = swc_ecmascript::codegen::Config {
        minify: false,
        ascii_only: false,
        target: swc_ecmascript::ast::EsVersion::Es5,
      };
      let mut emitter = swc_ecmascript::codegen::Emitter {
        cfg: config,
        comments: Some(&comments),
        cm: source_map,
        wr: writer,
      };

      emitter.emit_module(program).unwrap();
    }

    String::from_utf8(buf).unwrap()
  }

  macro_rules! assert_replacer {
    ($input: expr) => {
      let code = parse($input);
      assert_eq!(code, $input);
    };
    ($input: expr, $expected: expr) => {
      let code = parse($input);
      assert_eq!(code, $expected);
    };
  }

  #[test]
  fn dev() {
    assert_replacer!(
      r#"
      console.log(__DEV__);
      "#,
      indoc! {r#"
      console.log(true);
    "#}
    );
    assert_replacer!(indoc! {r#"
      let __DEV__ = 1;
      console.log(__DEV__);
    "#});
    assert_replacer!(indoc! {r#"
      function f() {
          let __DEV__ = 2;
          console.log(__DEV__);
      }
    "#});
  }

  #[test]
  fn os() {
    assert_replacer!(
      r#"
      import { Platform } from "react-native";
      console.log(Platform.OS);
      "#,
      indoc! {r#"
      import { Platform } from "react-native";
      console.log("android");
    "#}
    );

    assert_replacer!(
      r#"
      const { Platform } = require("react-native");
      console.log(Platform.OS);
      "#,
      indoc! {r#"
      const { Platform  } = require("react-native");
      console.log("android");
    "#}
    );

    assert_replacer!(
      r#"
      import * as RN from "react-native";
      console.log(RN.Platform.OS);
      "#,
      indoc! {r#"
      import * as RN from "react-native";
      console.log("android");
    "#}
    );

    assert_replacer!(indoc! {r#"
      import { Platform } from "react-native";
      function x() {
          const Platform = 2;
          console.log(Platform.OS);
      }
    "#});
  }

  #[test]
  fn select_expr() {
    assert_replacer!(
      r#"
      import { Platform } from "react-native";
      console.log(Platform.select({
        android: 1,
        ios: 2
      }));
      "#,
      indoc! {r#"
      import { Platform } from "react-native";
      console.log(1);
    "#}
    );

    assert_replacer!(
      r#"
      import { Platform } from "react-native";
      console.log(Platform.select({
        default: 3,
        ios: 4
      }));
      "#,
      indoc! {r#"
      import { Platform } from "react-native";
      console.log(3);
    "#}
    );

    assert_replacer!(
      r#"
      import { Platform } from "react-native";
      console.log(Platform.select({
        default: 3,
        native: 3.5,
        ios: 4
      }));
      "#,
      indoc! {r#"
      import { Platform } from "react-native";
      console.log(3.5);
    "#}
    );

    assert_replacer!(indoc! {r#"
      import { Platform } from "react-native";
      let x = {
          default: 3,
          native: 3.5
      };
      console.log(Platform.select({
          ...x,
          ios: 4
      }));
      "#});

    assert_replacer!(indoc! {r#"
      import { Platform } from "react-native";
      console.log(Platform.select(foo));
    "#});
  }

  #[test]
  fn select_functions() {
    assert_replacer!(indoc! {r#"
      import { Platform } from "react-native";
      console.log(Platform.select({
          get ios () {
              return "get1";
          },
          default () {
              return "get2";
          }
      }));
    "#});

    assert_replacer!(
      r#"
      import { Platform } from "react-native";
      console.log(
        Platform.select({
          ios() {
            return 1;
          },
          async *android(a, b) {
            return 2;
          },
        }),
      );
     "#,
      indoc! {r#"
        import { Platform } from "react-native";
        console.log(async function*(a, b) {
            return 2;
        });
      "#}
    );
  }
}
