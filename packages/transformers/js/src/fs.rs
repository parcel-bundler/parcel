use crate::hoist::{Collect, Import};
use crate::utils::SourceLocation;
use data_encoding::{BASE64, HEXLOWER};
use dependency_collector::{DependencyDescriptor, DependencyKind};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use swc_atoms::JsWord;
use swc_common::{Mark, Span, SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast::*;
use swc_ecmascript::visit::{Fold, FoldWith, VisitWith};

type IdentId = (JsWord, SyntaxContext);
macro_rules! id {
  ($ident: expr) => {
    ($ident.sym.clone(), $ident.span.ctxt)
  };
}

pub fn inline_fs<'a>(
  filename: &str,
  source_map: swc_common::sync::Lrc<swc_common::SourceMap>,
  decls: HashSet<IdentId>,
  global_mark: Mark,
  project_root: String,
  deps: &'a mut Vec<DependencyDescriptor>,
) -> impl Fold + 'a {
  InlineFS {
    filename: Path::new(filename).to_path_buf(),
    collect: Collect::new(source_map, decls, Mark::fresh(Mark::root()), global_mark),
    global_mark,
    project_root,
    deps,
  }
}

struct InlineFS<'a> {
  filename: PathBuf,
  collect: Collect,
  global_mark: Mark,
  project_root: String,
  deps: &'a mut Vec<DependencyDescriptor>,
}

impl<'a> Fold for InlineFS<'a> {
  fn fold_module(&mut self, node: Module) -> Module {
    node.visit_with(&Invalid { span: DUMMY_SP } as _, &mut self.collect);
    node.fold_children_with(self)
  }

  fn fold_expr(&mut self, node: Expr) -> Expr {
    match &node {
      Expr::Call(call) => match &call.callee {
        ExprOrSuper::Expr(expr) => {
          if let Some((source, specifier)) = self.match_module_reference(expr) {
            if &source == "fs" && &specifier == "readFileSync" {
              if let Some(arg) = call.args.get(0) {
                if let Some(res) = self.evaluate_fs_arg(&*arg.expr, call.args.get(1), call.span) {
                  return res;
                }
              }
            }
          }
        }
        _ => {}
      },
      _ => {}
    }

    node.fold_children_with(self)
  }
}

impl<'a> InlineFS<'a> {
  fn match_module_reference(&self, node: &Expr) -> Option<(JsWord, JsWord)> {
    match node {
      Expr::Ident(ident) => {
        if let Some(Import {
          source, specifier, ..
        }) = self.collect.imports.get(&id!(ident))
        {
          return Some((source.clone(), specifier.clone()));
        }
      }
      Expr::Member(member) => {
        let prop = match &*member.prop {
          Expr::Ident(ident) => {
            if !member.computed {
              ident.sym.clone()
            } else {
              return None;
            }
          }
          Expr::Lit(lit) => match lit {
            Lit::Str(str_) => str_.value.clone(),
            _ => return None,
          },
          _ => return None,
        };

        match &member.obj {
          ExprOrSuper::Expr(expr) => {
            if let Some(source) = self.collect.match_require(expr) {
              return Some((source.clone(), prop));
            }

            match &**expr {
              Expr::Ident(ident) => {
                if let Some(Import {
                  source, specifier, ..
                }) = self.collect.imports.get(&id!(ident))
                {
                  if specifier == "default" || specifier == "*" {
                    return Some((source.clone(), prop));
                  }
                }
              }
              _ => {}
            }
          }
          _ => {}
        }
      }
      _ => {}
    }

    return None;
  }

  fn evaluate_fs_arg(
    &mut self,
    node: &Expr,
    encoding: Option<&ExprOrSpread>,
    span: Span,
  ) -> Option<Expr> {
    let mut evaluator = Evaluator { inline: self };

    let res = node.clone().fold_with(&mut evaluator);
    match res {
      Expr::Lit(Lit::Str(str_)) => {
        // Ignore if outside the project root
        let path = match dunce::canonicalize(Path::new(&str_.value.to_string())) {
          Ok(path) => path,
          Err(_err) => return None,
        };
        if !path.starts_with(&self.project_root) {
          return None;
        }

        let encoding = match encoding {
          Some(e) => match &*e.expr {
            Expr::Lit(Lit::Str(str_)) => &str_.value,
            _ => "buffer",
          },
          None => "buffer",
        };

        // TODO: this should probably happen in JS so we use Parcel's file system
        // rather than only the real FS. Will need when we convert to WASM.
        let contents = match encoding {
          "base64" | "buffer" => {
            if let Ok(contents) = std::fs::read(&path) {
              BASE64.encode(&contents)
            } else {
              return None;
            }
          }
          "hex" => {
            if let Ok(contents) = std::fs::read(&path) {
              HEXLOWER.encode(&contents)
            } else {
              return None;
            }
          }
          "utf8" | "utf-8" => {
            if let Ok(contents) = std::fs::read_to_string(&path) {
              contents
            } else {
              return None;
            }
          }
          _ => return None,
        };

        let contents = Expr::Lit(Lit::Str(Str {
          value: contents.into(),
          kind: StrKind::Synthesized,
          has_escape: false,
          span: DUMMY_SP,
        }));

        // Add a file dependency so the cache is invalidated when this file changes.
        self.deps.push(DependencyDescriptor {
          kind: DependencyKind::File,
          loc: SourceLocation::from(&self.collect.source_map, span),
          specifier: path.to_str().unwrap().into(),
          attributes: None,
          is_optional: false,
          is_helper: false,
        });

        // If buffer, wrap in Buffer.from(base64String, 'base64')
        if encoding == "buffer" {
          Some(Expr::Call(CallExpr {
            callee: ExprOrSuper::Expr(Box::new(Expr::Member(MemberExpr {
              obj: ExprOrSuper::Expr(Box::new(Expr::Ident(Ident::new(
                "Buffer".into(),
                DUMMY_SP.apply_mark(self.global_mark),
              )))),
              prop: Box::new(Expr::Ident(Ident::new("from".into(), DUMMY_SP))),
              computed: false,
              span: DUMMY_SP,
            }))),
            args: vec![
              ExprOrSpread {
                expr: Box::new(contents),
                spread: None,
              },
              ExprOrSpread {
                expr: Box::new(Expr::Lit(Lit::Str(Str {
                  value: "base64".into(),
                  kind: StrKind::Synthesized,
                  has_escape: false,
                  span: DUMMY_SP,
                }))),
                spread: None,
              },
            ],
            span: DUMMY_SP,
            type_args: None,
          }))
        } else {
          Some(contents)
        }
      }
      _ => return None,
    }
  }
}

struct Evaluator<'a> {
  inline: &'a InlineFS<'a>,
}

impl<'a> Fold for Evaluator<'a> {
  fn fold_expr(&mut self, node: Expr) -> Expr {
    let node = node.fold_children_with(self);

    match &node {
      Expr::Ident(ident) => match ident.sym.to_string().as_str() {
        "__dirname" => Expr::Lit(Lit::Str(Str {
          value: self
            .inline
            .filename
            .parent()
            .unwrap()
            .to_str()
            .unwrap()
            .into(),
          kind: StrKind::Synthesized,
          has_escape: false,
          span: DUMMY_SP,
        })),
        "__filename" => Expr::Lit(Lit::Str(Str {
          value: self.inline.filename.to_str().unwrap().into(),
          kind: StrKind::Synthesized,
          has_escape: false,
          span: DUMMY_SP,
        })),
        _ => node,
      },
      Expr::Bin(bin) => match bin.op {
        BinaryOp::Add => {
          let left = match &*bin.left {
            Expr::Lit(Lit::Str(str_)) => str_.value.clone(),
            _ => return node,
          };

          let right = match &*bin.right {
            Expr::Lit(Lit::Str(str_)) => str_.value.clone(),
            _ => return node,
          };

          Expr::Lit(Lit::Str(Str {
            value: format!("{}{}", left, right).into(),
            kind: StrKind::Synthesized,
            has_escape: false,
            span: DUMMY_SP,
          }))
        }
        _ => node,
      },
      Expr::Call(call) => {
        let callee = match &call.callee {
          ExprOrSuper::Expr(expr) => &*expr,
          _ => return node,
        };

        if let Some((source, specifier)) = self.inline.match_module_reference(callee) {
          match (source.to_string().as_str(), specifier.to_string().as_str()) {
            ("path", "join") => {
              let mut path = PathBuf::new();
              for arg in call.args.clone() {
                let s = match &*arg.expr {
                  Expr::Lit(Lit::Str(str_)) => str_.value.clone(),
                  _ => return node,
                };
                if path.as_os_str().len() == 0 {
                  path.push(s.to_string());
                } else {
                  let s = s.to_string();
                  let mut p = Path::new(s.as_str());

                  // Node's path.join ignores separators at the start of path components.
                  // Rust's does not, so we need to strip them.
                  if let Ok(stripped) = p.strip_prefix("/") {
                    p = stripped;
                  }
                  path.push(p);
                }
              }

              return Expr::Lit(Lit::Str(Str {
                value: path.to_str().unwrap().into(),
                kind: StrKind::Synthesized,
                has_escape: false,
                span: DUMMY_SP,
              }));
            }
            _ => return node,
          }
        }

        return node;
      }
      _ => node,
    }
  }
}
