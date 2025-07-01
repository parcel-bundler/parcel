use std::{
  cell::RefCell,
  path::{Path, PathBuf},
  rc::Rc,
};

use data_encoding::{BASE64, HEXLOWER};
use parcel_core::Dependency;
use parcel_evaluator::{Evaluate, Evaluator, JsValue, Object, StaticOrRc, builtin_object};
use swc_core::{
  common::{DUMMY_SP, Mark, Span, SyntaxContext},
  ecma::{
    ast::*,
    atoms::Atom as JsWord,
    utils::stack_size::maybe_grow_default,
    visit::{Fold, FoldWith, VisitWith},
  },
};

use crate::dependency_collector2::UpdateExpr;

pub fn inline_fs<'a>(
  filename: &str,
  source_map: swc_core::common::sync::Lrc<swc_core::common::SourceMap>,
  unresolved_mark: Mark,
  global_mark: Mark,
  project_root: &'a str,
  deps: &'a mut Vec<Dependency>,
  is_module: bool,
) -> impl Fold + 'a {
  let mut evaluator = Evaluator::new();
  let ctxt = SyntaxContext::empty().apply_mark(unresolved_mark);
  let files = Rc::new(RefCell::new(Vec::new()));
  let files_clone = files.clone();

  let path = builtin_object! {
    "join" => JsValue::Function(StaticOrRc::Static(&path_join))
  };

  let project_root = project_root.to_string();
  // let fs = JsValue::Object(
  //   Rc::new(indexmap::indexmap! {
  //     "readFileSync".into() => JsValue::Function(Rc::new(move |this, args, span, _evaluator: &Evaluator|{
  //       fs_read_file_sync(this, args, span, files_clone.clone(), &project_root, unresolved_mark)
  //     }).into())
  //   })
  //   .into(),
  // );

  let path_ns = path.clone();
  // let fs_ns = fs.clone();

  // evaluator.add_value(
  //   ("require".into(), ctxt),
  //   JsValue::Function(
  //     Rc::new(
  //       move |_this, args: Vec<JsValue>, span, _evaluator: &Evaluator| {
  //         if let Some(JsValue::String(specifier)) = args.get(0) {
  //           match specifier.as_str() {
  //             "path" | "node:path" => path_ns.clone(),
  //             "fs" | "node:fs" => fs_ns.clone(),
  //             _ => JsValue::Unknown(DUMMY_SP),
  //           }
  //         } else {
  //           JsValue::Unknown(span)
  //         }
  //       },
  //     )
  //     .into(),
  //   ),
  // );

  evaluator.add_value(
    ("__dirname".into(), ctxt),
    JsValue::String(
      Path::new(filename)
        .parent()
        .unwrap()
        .to_str()
        .unwrap()
        .into(),
    ),
  );

  evaluator.add_value(
    ("__filename".into(), ctxt),
    JsValue::String(filename.into()),
  );

  InlineFS {
    filename: Path::new(filename).to_path_buf(),
    deps: files,
    path,
    fs: JsValue::Undefined,
    evaluator,
  }
}

struct InlineFS<'a> {
  filename: PathBuf,
  // collect: Collect,
  // project_root: &'a str,
  deps: Rc<RefCell<Vec<(JsWord, Span)>>>,
  path: JsValue,
  fs: JsValue,
  evaluator: Evaluator<'a>,
}

pub fn path_ns() -> JsValue {
  builtin_object! {
    "join" => JsValue::Function(StaticOrRc::Static(&path_join))
  }
}

pub fn fs_ns(project_root: String) -> JsValue {
  JsValue::Object(
    Rc::new(indexmap::indexmap! {
      "readFileSync".into() => JsValue::Function(Rc::new(move |this, args, span, _evaluator: &Evaluator|{
        fs_read_file_sync(this, args, span, &project_root)
      }).into())
    })
    .into(),
  )
}

pub fn path_join(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  let mut path = PathBuf::new();
  for arg in args {
    match arg {
      JsValue::String(s) => {
        if path.as_os_str().is_empty() {
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
      _ => return JsValue::Unknown(span),
    }
  }

  JsValue::String(path.to_string_lossy().into())
}

pub fn fs_read_file_sync(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  // deps: Rc<RefCell<Vec<(JsWord, Span)>>>,
  project_root: &str,
  // unresolved_mark: Mark,
) -> JsValue {
  if let Some(JsValue::String(path)) = args.get(0) {
    // deps.borrow_mut().push((path.clone(), span));
    let encoding = match args.get(1) {
      Some(JsValue::String(encoding)) => encoding.as_str(),
      _ => "buffer",
    };

    let path = Path::new(project_root).join(path.as_str());
    let path = match dunce::canonicalize(path) {
      Ok(path) => path,
      Err(_err) => return JsValue::Unknown(span),
    };
    if !path.starts_with(project_root) {
      return JsValue::Unknown(span);
    }

    let contents = match encoding {
      "buffer" => {
        if let Ok(contents) = std::fs::read(&path) {
          return JsValue::Object(Rc::new(Buffer(Rc::new(contents))).into());
        } else {
          return JsValue::Unknown(span);
        }
      }
      "base64" => {
        if let Ok(contents) = std::fs::read(&path) {
          BASE64.encode(&contents)
        } else {
          return JsValue::Unknown(span);
        }
      }
      "hex" => {
        if let Ok(contents) = std::fs::read(&path) {
          HEXLOWER.encode(&contents)
        } else {
          return JsValue::Unknown(span);
        }
      }
      "utf8" | "utf-8" => {
        if let Ok(contents) = std::fs::read_to_string(&path) {
          contents
        } else {
          return JsValue::Unknown(span);
        }
      }
      _ => return JsValue::Unknown(span),
    };

    return JsValue::String(contents.into());
  }

  JsValue::Unknown(span)
}

pub struct Buffer(pub Rc<Vec<u8>>);

impl Object for Buffer {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop {
      JsValue::String(prop) => match prop.as_str() {
        "toString" => {
          let contents = self.0.clone();
          JsValue::Function(
            Rc::new(
              move |_this, args: Vec<JsValue>, span, _evaluator: &Evaluator| {
                let encoding = match args.get(0) {
                  None => "utf8",
                  Some(JsValue::String(e)) => e.as_str(),
                  _ => return JsValue::Unknown(span),
                };
                let start = match args.get(1) {
                  None | Some(JsValue::Undefined | JsValue::Null) => 0,
                  Some(JsValue::Number(s)) => *s as usize,
                  _ => return JsValue::Unknown(span),
                };
                let end = match args.get(2) {
                  None | Some(JsValue::Undefined | JsValue::Null) => contents.len(),
                  Some(JsValue::Number(s)) => *s as usize,
                  _ => return JsValue::Unknown(span),
                };
                let slice = &contents[start..end];

                match encoding {
                  "base64" => JsValue::String(BASE64.encode(&slice).into()),
                  "hex" => JsValue::String(HEXLOWER.encode(&slice).into()),
                  "utf8" | "utf-8" => std::str::from_utf8(&slice)
                    .ok()
                    .map(|v| JsValue::String(v.into()))
                    .unwrap_or(JsValue::Unknown(span)),
                  _ => JsValue::Unknown(span),
                }
              },
            )
            .into(),
          )
        }
        "length" => JsValue::Number(self.0.len() as f64),
        _ => JsValue::Unknown(span),
      },
      JsValue::Number(index) => self
        .0
        .get(*index as usize)
        .map_or(JsValue::Unknown(span), |v| JsValue::Number(*v as f64)),
      _ => JsValue::Unknown(span),
    }
  }

  fn has(&self, _prop: &JsValue) -> bool {
    false
  }

  fn entries<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    Box::new(std::iter::empty())
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    Ok(Expr::Call(CallExpr {
      callee: Callee::Expr(Box::new(Expr::Member(MemberExpr {
        obj: Box::new(Expr::Ident(Ident::new(
          "Buffer".into(),
          DUMMY_SP,
          SyntaxContext::empty(),
        ))),
        prop: MemberProp::Ident(IdentName::new("from".into(), DUMMY_SP)),
        span: DUMMY_SP,
      }))),
      args: vec![
        ExprOrSpread {
          expr: Box::new(BASE64.encode(&self.0).into()),
          spread: None,
        },
        ExprOrSpread {
          expr: Box::new(Expr::Lit(Lit::Str("base64".into()))),
          spread: None,
        },
      ],
      span: DUMMY_SP,
      ctxt: SyntaxContext::empty(),
      type_args: None,
    }))
  }
}

impl<'a> Fold for InlineFS<'a> {
  fn fold_module(&mut self, node: Module) -> Module {
    // Find builtin modules (e.g. fs and path).
    for item in &node.body {
      if let ModuleItem::ModuleDecl(ModuleDecl::Import(import)) = item {
        let namespace = match import.src.value.as_str() {
          "path" | "node:path" => self.path.clone(),
          "fs" | "node:fs" => self.fs.clone(),
          _ => JsValue::Unknown(DUMMY_SP),
        };

        if matches!(namespace, JsValue::Object(..)) {
          for specifier in &import.specifiers {
            match specifier {
              ImportSpecifier::Named(named) => {
                let imported = match &named.imported {
                  Some(ModuleExportName::Ident(id)) => id.sym.clone(),
                  Some(ModuleExportName::Str(s)) => s.value.clone(),
                  None => named.local.sym.clone(),
                };
                let value = namespace.get(&JsValue::String(imported), DUMMY_SP);
                self.evaluator.add_value(named.local.to_id(), value);
              }
              ImportSpecifier::Default(default) => {
                self
                  .evaluator
                  .add_value(default.local.to_id(), namespace.clone());
              }
              ImportSpecifier::Namespace(ns) => {
                self
                  .evaluator
                  .add_value(ns.local.to_id(), namespace.clone());
              }
            }
          }
        }
      }
    }

    node.fold_children_with(self)
  }

  fn fold_var_decl(&mut self, node: VarDecl) -> VarDecl {
    // if node.kind == VarDeclKind::Const {
    for decl in &node.decls {
      if let Some(expr) = &decl.init {
        let val = expr.evaluate(&self.evaluator);
        self
          .evaluator
          .eval_pat(val, &decl.name, &mut Evaluator::add_value);
      }
    }
    // }

    node.fold_children_with(self)
  }

  fn fold_expr(&mut self, node: Expr) -> Expr {
    if matches!(node, Expr::Call(_))
      || matches!(node, Expr::Member(ref member) if matches!(&*member.obj, Expr::Call(_)))
    {
      let result = node.evaluate(&self.evaluator);
      if let Ok(res) = result.into_expr() {
        return res;
      }
    }

    maybe_grow_default(|| node.fold_children_with(self))
  }
}
