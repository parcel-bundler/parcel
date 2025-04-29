use std::{
  cell::RefCell,
  collections::hash_map::DefaultHasher,
  fmt,
  hash::{Hash, Hasher},
  path::Path,
  rc::Rc,
};

use bitflags::bitflags;
use parcel_core::impl_bitflags_serde;
use parcel_evaluator::{
  Evaluate, Evaluator, Function, JsValue, Object, StaticOrRc, builtin_object,
};
use path_slash::PathBufExt;
use serde::{Deserialize, Serialize};
use swc_core::{
  common::{DUMMY_SP, Mark, SourceMap, Span, SyntaxContext, sync::Lrc},
  ecma::{
    ast::{
      self, CallExpr, Callee, ExportAll, Expr, ExprOrSpread, Ident, ImportDecl, MemberProp, Module,
      NamedExport, Prop, PropName, TryStmt,
    },
    atoms::Atom as JsWord,
    utils::{member_expr, stack_size::maybe_grow_default},
    visit::{Fold, FoldWith, VisitMut, VisitMutWith},
  },
};

use crate::{Config, fold_member_expr_skip_prop, utils::*};

macro_rules! hash {
  ($str:expr) => {{
    let mut hasher = DefaultHasher::new();
    $str.hash(&mut hasher);
    hasher.finish()
  }};
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum DependencyKind {
  /// Corresponds to ESM import statements
  /// ```skip
  /// import {x} from './dependency';
  /// ```
  Import,
  /// Corresponds to ESM re-export statements
  /// ```skip
  /// export {x} from './dependency';
  /// ```
  Export,
  /// Corresponds to dynamic import statements
  /// ```skip
  /// import('./dependency').then(({x}) => {/* ... */});
  /// ```
  DynamicImport,
  /// Corresponds to CJS require statements
  /// ```skip
  /// const {x} = require('./dependency');
  /// ```
  Require,
  /// Corresponds to Worker URL statements
  /// ```skip
  /// const worker = new Worker(
  ///     new URL('./dependency', import.meta.url),
  ///     {type: 'module'}
  /// );
  /// ```
  WebWorker,
  /// Corresponds to ServiceWorker URL statements
  /// ```skip
  /// navigator.serviceWorker.register(
  ///     new URL('./dependency', import.meta.url),
  ///     {type: 'module'}
  /// );
  /// ```
  ServiceWorker,
  /// CSS / WebAudio worklets
  /// ```skip
  /// CSS.paintWorklet.addModule(
  ///   new URL('./dependency', import.meta.url)
  /// );
  /// ```
  Worklet,
  /// URL statements
  /// ```skip
  /// let img = document.createElement('img');
  /// img.src = new URL('hero.jpg', import.meta.url);
  /// document.body.appendChild(img);
  /// ```
  Url,
  /// `fs.readFileSync` statements
  ///
  /// > Calls to fs.readFileSync are replaced with the file's contents if the filepath is statically
  /// > determinable and inside the project root.
  ///
  /// ```skip
  /// import fs from "fs";
  /// import path from "path";
  ///
  /// const data = fs.readFileSync(path.join(__dirname, "data.json"), "utf8");
  /// ```
  ///
  /// * https://parceljs.org/features/node-emulation/#inlining-fs.readfilesync
  File,
  /// `parcelRequire` call.
  Id,
}

bitflags! {
  #[derive(Clone, Copy, Default, PartialEq, Debug)]
  pub struct Helpers: u8 {
    /// `import.meta.distDir` – a relative path from the current bundle to the distDir
    const DIST_DIR = 1 << 0;
    /// `import.meta.publicUrl` - absolute public URL
    const PUBLIC_URL = 1 << 1;
    /// `parcelRequire.load`
    const LOAD = 1 << 2;
    /// `parcelRequire.resolve`
    const RESOLVE = 1 << 3;
    /// `parcelRequire.extendImportMap`
    const EXTEND_IMPORT_MAP = 1 << 4;
    /// `import.meta.devServer` – URL of Parcel HMR server
    const DEV_SERVER = 1 << 5;
  }
}

impl_bitflags_serde!(Helpers);

impl fmt::Display for DependencyKind {
  fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
    write!(f, "{:?}", self)
  }
}

bitflags! {
  #[derive(Clone, Default, Debug, PartialEq)]
  pub struct DependencyFlags: u8 {
    const OPTIONAL = 1 << 0;
    const HELPER = 1 << 1;
    const NEEDS_STABLE_NAME = 1 << 2;
    const REACT_LAZY = 1 << 3;
  }
}

impl_bitflags_serde!(DependencyFlags);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DependencyDescriptor {
  pub kind: DependencyKind,
  pub loc: SourceLocation,
  /// The text specifier associated with the import/export statement.
  pub specifier: JsWord,
  pub attributes: Option<()>,
  pub flags: DependencyFlags,
  pub source_type: Option<SourceType>,
  pub placeholder: Option<String>,
}

/// This pass collects dependencies in a module and compiles references as needed to work with Parcel's JSRuntime.
pub fn dependency_collector<'a>(
  mut module: Module,
  source_map: Lrc<SourceMap>,
  items: &'a mut Vec<DependencyDescriptor>,
  ignore_mark: swc_core::common::Mark,
  unresolved_mark: swc_core::common::Mark,
  config: &'a Config,
  diagnostics: &'a mut Vec<Diagnostic>,
) -> (Module, Helpers) {
  let mut collector = DependencyCollector::new(
    source_map,
    items,
    ignore_mark,
    unresolved_mark,
    config,
    diagnostics,
  );

  module.visit_mut_with(&mut collector);
  (module, collector.helpers)
}

struct DependencyCollector<'a> {
  source_map: Lrc<SourceMap>,
  items: &'a mut Vec<DependencyDescriptor>,
  in_try: bool,
  in_promise: bool,
  require_node: Option<ast::CallExpr>,
  ignore_mark: swc_core::common::Mark,
  unresolved_mark: swc_core::common::Mark,
  config: &'a Config,
  diagnostics: &'a mut Vec<Diagnostic>,
  import_meta: Option<ast::VarDecl>,
  helpers: Helpers,
  filename: String,
  evaluator: Evaluator<'a>,
}

impl<'a> DependencyCollector<'a> {
  pub fn new(
    source_map: Lrc<SourceMap>,
    items: &'a mut Vec<DependencyDescriptor>,
    ignore_mark: swc_core::common::Mark,
    unresolved_mark: swc_core::common::Mark,
    config: &'a Config,
    diagnostics: &'a mut Vec<Diagnostic>,
  ) -> Self {
    let mut evaluator = Evaluator::new();
    let ctxt = SyntaxContext::empty().apply_mark(unresolved_mark);

    evaluator.add_value(
      ("require".into(), ctxt),
      JsValue::Function(StaticOrRc::Static(&require)),
    );

    evaluator.add_value(
      ("module".into(), ctxt),
      builtin_object! {
        "require" => JsValue::Function(StaticOrRc::Static(&require)),
      },
    );

    evaluator.add_value(
      ("parcelRequire".into(), ctxt),
      JsValue::Function(StaticOrRc::Static(&ParcelRequire)),
    );

    evaluator.add_value(
      ("URL".into(), ctxt),
      JsValue::Function(StaticOrRc::Static(&URL)),
    );
    evaluator.add_value(
      ("__parcel_url_dep__".into(), ctxt),
      JsValue::Function(StaticOrRc::Static(&parcel_url_dep)),
    );

    evaluator.add_value(
      ("Promise".into(), ctxt),
      JsValue::Function(StaticOrRc::Static(&Promise)),
    );

    // __parcel__require__
    // __parcel__import__
    // __parcel__importScripts__
    // __parcel__URL__

    if config.is_worker() {
      evaluator.add_value(
        ("importScripts".into(), ctxt),
        JsValue::Function(StaticOrRc::Static(&import_scripts)),
      );
    }

    if config.is_browser() {
      evaluator.add_value(
        ("navigator".into(), ctxt),
        builtin_object! {
          "serviceWorker" => builtin_object! {
            "register" => JsValue::Function(StaticOrRc::Static(&service_worker_register)),
          },
        },
      );

      evaluator.add_value(
        ("CSS".into(), ctxt),
        builtin_object! {
          "paintWorklet" => builtin_object! {
            "addModule" => JsValue::Function(StaticOrRc::Static(&paint_worklet)),
          },
        },
      );

      evaluator.add_value(("Worker".into(), ctxt), JsValue::Function((&Worker).into()));

      evaluator.add_value(
        ("SharedWorker".into(), ctxt),
        JsValue::Function((&SharedWorker).into()),
      );
    }

    let filename =
      if let Some(relative) = pathdiff::diff_paths(&config.filename, &config.project_root) {
        relative.to_slash_lossy()
      } else if let Some(filename) = Path::new(&config.filename).file_name() {
        String::from(filename.to_string_lossy())
      } else {
        String::from("unknown.js")
      };

    if config.source_type == SourceType::Module {
      // TODO: error if accessed in scripts
      // TODO: should have no prototype: Object.assign(Object.create(null), {url: 'file:///src/foo.js'});
      evaluator.import_meta = JsValue::Object(
        Rc::new(indexmap::indexmap! {
          "url".into() => JsValue::String(format!("file:///{}", filename).into()),
          // distDir, publicUrl, devServer
        })
        .into(),
      );
    }

    evaluator.dynamic_import = JsValue::Function(StaticOrRc::Static(&import));

    DependencyCollector {
      source_map,
      items,
      in_try: false,
      in_promise: false,
      require_node: None,
      ignore_mark,
      unresolved_mark,
      config,
      diagnostics,
      import_meta: None,
      helpers: Helpers::empty(),
      filename,
      evaluator,
    }
  }
}

impl<'a> DependencyCollector<'a> {
  fn placeholder(&self, specifier: &JsWord, kind: DependencyKind) -> JsWord {
    format!(
      "{:x}",
      hash!(format!("{}:{}:{}", self.filename, specifier, kind)),
    )
    .into()
  }
}

impl<'a> VisitMut for DependencyCollector<'a> {
  fn visit_mut_import_decl(&mut self, node: &mut ImportDecl) {
    if node.type_only {
      return;
    }

    // let placeholder = self.placeholder(&node.src.value, DependencyKind::Import);
    // node.src.value = placeholder.clone();

    self.items.push(DependencyDescriptor {
      kind: DependencyKind::Import,
      loc: SourceLocation {
        start_line: 0,
        start_col: 0,
        end_line: 0,
        end_col: 0,
      },
      specifier: node.src.value.clone(),
      attributes: None,
      flags: DependencyFlags::empty(),
      source_type: Some(SourceType::Module),
      placeholder: None,
    });
  }

  fn visit_mut_named_export(&mut self, node: &mut NamedExport) {
    if node.type_only {
      return;
    }

    if let Some(src) = &mut node.src {
      self.items.push(DependencyDescriptor {
        kind: DependencyKind::Export,
        loc: SourceLocation {
          start_line: 0,
          start_col: 0,
          end_line: 0,
          end_col: 0,
        },
        specifier: src.value.clone(),
        attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: None,
      });
    }
  }

  fn visit_mut_export_all(&mut self, node: &mut ExportAll) {
    if node.type_only {
      return;
    }

    self.items.push(DependencyDescriptor {
      kind: DependencyKind::Export,
      loc: SourceLocation {
        start_line: 0,
        start_col: 0,
        end_line: 0,
        end_col: 0,
      },
      specifier: node.src.value.clone(),
      attributes: None,
      flags: DependencyFlags::empty(),
      source_type: Some(SourceType::Module),
      placeholder: None,
    });
  }

  fn visit_mut_try_stmt(&mut self, node: &mut TryStmt) {
    self.in_try = true;
    node.block.visit_mut_children_with(self);
    self.in_try = false;

    node.handler.visit_mut_children_with(self);
    node.finalizer.visit_mut_children_with(self);
  }

  fn visit_mut_expr(&mut self, node: &mut Expr) {
    if matches!(node, Expr::Call(_) | Expr::New(_)) {
      let res = node.evaluate(&self.evaluator);
      if let JsValue::Object(res) = &res {
        if let Some(dep) = res.as_any().downcast_ref::<DependencyDescriptor>() {
          let placeholder = self.placeholder(&dep.specifier, dep.kind);
          let mut d = dep.clone();
          d.placeholder = Some(placeholder.to_string());

          if dep.kind == DependencyKind::Require && self.in_try {
            d.flags |= DependencyFlags::OPTIONAL;
          }

          self.items.push(d);

          if let Expr::New(new) = node {
            if matches!(dep.kind, DependencyKind::WebWorker | DependencyKind::Url) {
              if let Some(args) = &mut new.args {
                if !self.config.supports_module_workers {
                  remove_type_option(args);
                }

                args[0] = ExprOrSpread {
                  expr: Box::new(Expr::Call(create_require(
                    placeholder,
                    self.unresolved_mark,
                  ))),
                  spread: None,
                };
                return;
              }
            }
          }

          if let Expr::Call(call) = node {
            if matches!(
              dep.kind,
              DependencyKind::ServiceWorker | DependencyKind::Worklet
            ) {
              if !self.config.supports_module_workers {
                remove_type_option(&mut call.args);
              }

              call.args[0] = ExprOrSpread {
                expr: Box::new(Expr::Call(create_require(
                  placeholder,
                  self.unresolved_mark,
                ))),
                spread: None,
              };
              return;
            }

            if matches!(dep.kind, DependencyKind::Id) {
              call.callee = Callee::Expr(Box::new(Expr::Member(member_expr!(
                Default::default(),
                call.span,
                module.bundle.root
              ))));
              return;
            }
          }

          *node = Expr::Call(create_require(placeholder, self.unresolved_mark));
          return;
        }
      } else if let Expr::Call(call) = node {
        let callee = call.callee.evaluate(&self.evaluator);
        if let JsValue::Function(f) = callee {
          if let Some(helper) = f.as_any().downcast_ref::<Helpers>() {
            self.helpers |= *helper;
            if let Ok(res) = helper.into_expr() {
              call.callee = Callee::Expr(Box::new(res));
              return;
            }
          }
        }
      }

      if let Ok(res) = res.into_expr() {
        *node = res;
        return;
      }
    }

    node.visit_mut_children_with(self);
  }
}

fn require(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let Some(JsValue::String(src)) = args.get(0) {
    JsValue::Object(
      Rc::new(DependencyDescriptor {
        kind: DependencyKind::Require,
        flags: DependencyFlags::empty(),
        loc: SourceLocation {
          start_line: 0,
          start_col: 0,
          end_line: 0,
          end_col: 0,
        },
        specifier: src.clone(),
        attributes: None,
        placeholder: None,
        source_type: Some(SourceType::Module),
      })
      .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

fn import(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let Some(JsValue::String(src)) = args.get(0) {
    JsValue::Object(
      Rc::new(DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        flags: DependencyFlags::empty(),
        loc: SourceLocation {
          start_line: 0,
          start_col: 0,
          end_line: 0,
          end_col: 0,
        },
        specifier: src.clone(),
        attributes: None,
        placeholder: None,
        source_type: Some(SourceType::Module),
      })
      .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

fn import_scripts(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let Some(JsValue::String(src)) = args.get(0) {
    // JsValue::Object(Rc::new(DepObject(src.clone())))
    todo!()
  } else {
    JsValue::Unknown(span)
  }
}

fn service_worker_register(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let Some(dep) = match_url_dep(&args) {
    let mut source_type = SourceType::Script;
    if let Some(JsValue::Object(obj)) = args.get(1) {
      if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), DUMMY_SP) {
        if ty == "module" {
          source_type = SourceType::Module;
        }
      }
    }

    JsValue::Object(
      Rc::new(DependencyDescriptor {
        kind: DependencyKind::ServiceWorker,
        loc: SourceLocation {
          start_line: 0,
          start_col: 0,
          end_line: 0,
          end_col: 0,
        },
        specifier: dep.specifier.clone(),
        attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(source_type),
        placeholder: None,
      })
      .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

fn match_url_dep(args: &Vec<JsValue>) -> Option<&DependencyDescriptor> {
  // TODO: support self reference, e.g. new Worker(import.meta.url)
  if let Some(JsValue::Object(src)) = args.get(0) {
    if let Some(dep) = src.as_any().downcast_ref::<DependencyDescriptor>() {
      if dep.kind == DependencyKind::Url {
        return Some(&dep);
      }
    }
  }

  None
}

fn paint_worklet(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let Some(dep) = match_url_dep(&args) {
    JsValue::Object(
      Rc::new(DependencyDescriptor {
        kind: DependencyKind::Worklet,
        loc: SourceLocation {
          start_line: 0,
          start_col: 0,
          end_line: 0,
          end_col: 0,
        },
        specifier: dep.specifier.clone(),
        attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: None,
      })
      .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

struct URL;
impl Object for URL {}
impl Function for URL {
  fn construct(&self, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
    if let (Some(JsValue::String(url)), Some(_)) = (args.get(0), args.get(1)) {
      JsValue::Object(
        Rc::new(DependencyDescriptor {
          kind: DependencyKind::Url,
          loc: SourceLocation {
            start_line: 0,
            start_col: 0,
            end_line: 0,
            end_col: 0,
          },
          specifier: url.clone(),
          attributes: None,
          flags: DependencyFlags::empty(),
          source_type: Some(SourceType::Module),
          placeholder: None,
        })
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

fn parcel_url_dep(
  this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let (Some(JsValue::String(url)), Some(JsValue::Bool(needs_stable_name))) =
    (args.get(0), args.get(1))
  {
    JsValue::Object(
      Rc::new(DependencyDescriptor {
        kind: DependencyKind::Url,
        loc: SourceLocation {
          start_line: 0,
          start_col: 0,
          end_line: 0,
          end_col: 0,
        },
        specifier: url.clone(),
        attributes: None,
        flags: if *needs_stable_name {
          DependencyFlags::NEEDS_STABLE_NAME
        } else {
          DependencyFlags::empty()
        },
        source_type: Some(SourceType::Module),
        placeholder: None,
      })
      .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

struct Worker;
impl Object for Worker {}
impl Function for Worker {
  fn construct(&self, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    if let Some(dep) = match_url_dep(&args) {
      let mut source_type = SourceType::Script;
      if let Some(JsValue::Object(obj)) = args.get(1) {
        if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), DUMMY_SP) {
          if ty == "module" {
            source_type = SourceType::Module;
          }
        }
      }

      JsValue::Object(
        Rc::new(DependencyDescriptor {
          kind: DependencyKind::WebWorker,
          loc: SourceLocation {
            start_line: 0,
            start_col: 0,
            end_line: 0,
            end_col: 0,
          },
          specifier: dep.specifier.clone(),
          attributes: None,
          flags: DependencyFlags::empty(),
          source_type: Some(source_type),
          placeholder: None,
        })
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

struct SharedWorker;
impl Object for SharedWorker {}
impl Function for SharedWorker {
  fn construct(&self, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    if let Some(dep) = match_url_dep(&args) {
      let mut source_type = SourceType::Script;
      if let Some(JsValue::Object(obj)) = args.get(1) {
        if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), DUMMY_SP) {
          if ty == "module" {
            source_type = SourceType::Module;
          }
        }
      }

      JsValue::Object(
        Rc::new(DependencyDescriptor {
          kind: DependencyKind::WebWorker,
          loc: SourceLocation {
            start_line: 0,
            start_col: 0,
            end_line: 0,
            end_col: 0,
          },
          specifier: dep.specifier.clone(),
          attributes: None,
          flags: DependencyFlags::empty(),
          source_type: Some(source_type),
          placeholder: None,
        })
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

impl Object for DependencyDescriptor {
  fn get(&self, _prop: &parcel_evaluator::JsValue, span: Span) -> parcel_evaluator::JsValue {
    JsValue::Unknown(span)
  }

  fn has(&self, _prop: &parcel_evaluator::JsValue) -> bool {
    false
  }

  fn iter<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, parcel_evaluator::JsValue)> + 'a> {
    Box::new(std::iter::empty())
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    // Ok(Expr::Call(CallExpr {
    //   callee: Callee::Expr(Box::new(Expr::Ident(Ident::new_private(
    //     "__parcel_dep__".into(),
    //     DUMMY_SP,
    //   )))),
    //   ..Default::default()
    // }))
    Ok(Expr::Call(create_require(
      self.specifier.clone(),
      Mark::fresh(Mark::root()),
    )))
  }
}

fn remove_type_option(args: &mut Vec<ExprOrSpread>) {
  if let Some(arg) = args.get_mut(1) {
    if let Expr::Object(obj) = &mut *arg.expr {
      obj.props.retain(|v| {
        if let ast::PropOrSpread::Prop(prop) = v {
          if let Prop::KeyValue(kv) = &**prop {
            match &kv.key {
              PropName::Ident(id) if id.sym == "type" => return false,
              PropName::Str(s) if s.value == "type" => return false,
              _ => {}
            }
          }
        }

        true
      });

      if obj.props.is_empty() {
        args.truncate(1);
      }
    } else {
      args.truncate(1);
    }
  }
}

struct ParcelRequire;
impl Object for ParcelRequire {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "load" => JsValue::Function(StaticOrRc::Static(&Helpers::LOAD)),
      "resolve" => JsValue::Function(StaticOrRc::Static(&Helpers::RESOLVE)),
      "extendImportMap" => JsValue::Function(StaticOrRc::Static(&Helpers::EXTEND_IMPORT_MAP)),
      "meta" => todo!(),
      _ => JsValue::Unknown(span),
    }
  }
}

impl Function for ParcelRequire {
  fn call(
    &self,
    _this: JsValue,
    args: Vec<JsValue>,
    span: Span,
    _evaluator: &Evaluator,
  ) -> JsValue {
    if let Some(JsValue::String(id)) = args.get(0) {
      JsValue::Object(
        Rc::new(DependencyDescriptor {
          kind: DependencyKind::Id,
          flags: DependencyFlags::empty(),
          loc: SourceLocation {
            start_line: 0,
            start_col: 0,
            end_line: 0,
            end_col: 0,
          },
          placeholder: None,
          attributes: None,
          specifier: id.clone(),
          source_type: None,
        })
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

impl Object for Helpers {
  fn into_expr(&self) -> Result<Expr, ()> {
    if *self == Helpers::RESOLVE {
      Ok(Expr::Member(member_expr!(
        Default::default(),
        DUMMY_SP,
        module.bundle.resolve
      )))
    } else if *self == Helpers::LOAD {
      Ok(Expr::Member(member_expr!(
        Default::default(),
        DUMMY_SP,
        module.bundle.load
      )))
    } else if *self == Helpers::EXTEND_IMPORT_MAP {
      Ok(Expr::Member(member_expr!(
        Default::default(),
        DUMMY_SP,
        module.bundle.extendImportMap
      )))
    } else {
      Err(())
    }
  }
}

impl Function for Helpers {}

struct Promise;
impl Object for Promise {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "resolve" => JsValue::Function(StaticOrRc::Static(&promise_resolve)),
      _ => JsValue::Unknown(span),
    }
  }
}

fn promise_resolve(
  _this: JsValue,
  args: Vec<JsValue>,
  _span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  let arg = args.get(0).cloned().unwrap_or(JsValue::Undefined);

  if let JsValue::Object(obj) = &arg {
    if let Some(dep) = obj.as_any().downcast_ref::<DependencyDescriptor>() {
      if dep.kind == DependencyKind::Require {
        let mut dep = dep.clone();
        dep.kind = DependencyKind::DynamicImport;
        return JsValue::Object(Rc::new(dep).into());
      }
    }
  }

  JsValue::Object(Rc::new(PromiseInstance(arg)).into())
}

impl Function for Promise {
  fn construct(&self, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    if let Some(JsValue::Function(f)) = args.get(0) {
      let result = Rc::new(RefCell::new(JsValue::Unknown(span)));
      let result_clone = result.clone();
      let resolve = JsValue::Function(
        Rc::new(
          move |_this: JsValue, args: Vec<JsValue>, _span: Span, _evaluator: &Evaluator| {
            if let Some(arg) = args.get(0) {
              *result_clone.borrow_mut() = arg.clone();
            }
            JsValue::Undefined
          },
        )
        .into(),
      );
      f.call(JsValue::Undefined, vec![resolve], span, evaluator);

      let res = result.clone().borrow().clone();

      if let JsValue::Object(obj) = res {
        if let Some(dep) = obj.as_any().downcast_ref::<DependencyDescriptor>() {
          if dep.kind == DependencyKind::Require {
            let mut dep = dep.clone();
            dep.kind = DependencyKind::DynamicImport;
            return JsValue::Object(Rc::new(dep).into());
          }
        }
      }
    }

    JsValue::Unknown(span)
  }
}

struct PromiseInstance(JsValue);
impl Object for PromiseInstance {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "then" => {
        let val = self.0.clone();
        JsValue::Function(
          Rc::new(
            move |this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator| {
              if let Some(JsValue::Function(f)) = args.get(0) {
                let res = f.call(this, vec![val.clone()], span, evaluator);
                if let JsValue::Object(obj) = &res {
                  if let Some(dep) = obj.as_any().downcast_ref::<DependencyDescriptor>() {
                    if dep.kind == DependencyKind::Require {
                      let mut dep = dep.clone();
                      dep.kind = DependencyKind::DynamicImport;
                      return JsValue::Object(Rc::new(dep).into());
                    }
                  }
                }

                res
              } else {
                JsValue::Unknown(span)
              }
            },
          )
          .into(),
        )
      }
      _ => JsValue::Unknown(span),
    }
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    Err(())
  }
}

#[cfg(test)]
mod test {
  use super::DependencyDescriptor;
  use super::*;
  use crate::test_utils::{RunTestContext, RunVisitResult, run_visit};

  fn make_dependency_collector<'a>(
    context: RunTestContext,
    items: &'a mut Vec<DependencyDescriptor>,
    diagnostics: &'a mut Vec<Diagnostic>,
    config: &'a Config,
  ) -> DependencyCollector<'a> {
    DependencyCollector::new(
      context.source_map.clone(),
      items,
      Mark::new(),
      context.unresolved_mark,
      config,
      diagnostics,
    )
  }

  fn make_config() -> Config {
    Config::default()
  }

  fn make_placeholder_hash(specifier: &str, dependency_kind: DependencyKind) -> String {
    format!(
      "{:x}",
      hash!(format!("{}:{}:{}", "", specifier, dependency_kind))
    )
  }

  #[test]
  fn test_dynamic_import_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = Config::default();
    let input_code = r#"
      const { x } = await import('other');
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
      const {{ x }} = await require("{}");
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_import_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = Config::default();
    let input_code = r#"
      import { x } from 'other';
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let expected_code = r#"
      import { x } from 'other';
    "#
    .trim_start()
    .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Import,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: None,
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_export_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = Config::default();
    let input_code = r#"
      export { x } from 'other';
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let expected_code = r#"
      export { x } from 'other';
    "#
    .trim_start()
    .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Export,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: None,
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_export_star_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = Config::default();
    let input_code = r#"
      export * from 'other';
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let expected_code = r#"
      export * from 'other';
    "#
    .trim_start()
    .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Export,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: None,
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_require_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
      const { x } = require('other');
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::Require);
    let expected_code = format!(
      r#"
      const {{ x }} = require("{}");
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Require,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_optional_require_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
try {
    const { x } = require('other');
} catch (err) {}
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::Require);
    let expected_code = format!(
      r#"
try {{
    const {{ x }} = require("{}");
}} catch (err) {{}}
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Require,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::OPTIONAL,
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_compiled_dynamic_imports() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
Promise.resolve().then(() => require('other'));
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
require("{}");
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_compiled_dynamic_imports_with_chain() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
Promise.resolve().then(() => doSomething(require('other')));
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
Promise.resolve().then(function() {{
    return require("{}");
}}).then((res)=>doSomething(res));
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_compiled_dynamic_imports_with_function_chain() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
Promise.resolve().then(function() { return doSomething(require('other')); });
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
Promise.resolve().then(function() {{
    return require("{}");
}}).then(function(res) {{
    return doSomething(res);
}});
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_new_promise_require_imports() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
new Promise((resolve) => resolve(require("other")));
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
require("{}");
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_new_promise_require_imports_with_function_expr() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
new Promise(function(resolve) { return resolve(require("other")) });
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
require("{}");
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  // Require is treated as dynamic import
  #[test]
  fn test_promise_resolve_require_dynamic_import() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
Promise.resolve(require("other"));
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::DynamicImport);
    let expected_code = format!(
      r#"
require("{}");
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::DynamicImport,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_worker_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
      new Worker(new URL('other', import.meta.url), {type: 'module'});
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::WebWorker);
    let expected_code = format!(
      r#"
      new Worker(require("{}"));
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::WebWorker,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_service_worker_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
      navigator.serviceWorker.register(new URL('other', import.meta.url), {type: 'module'});
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::ServiceWorker);
    let expected_code = format!(
      r#"
      navigator.serviceWorker.register(require("{}"));
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::ServiceWorker,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_worklet_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
      CSS.paintWorklet.addModule(new URL('other', import.meta.url));
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("other", DependencyKind::Worklet);
    let expected_code = format!(
      r#"
      CSS.paintWorklet.addModule(require("{}"));
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Worklet,
        specifier: "other".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_url_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
    let input_code = r#"
let img = document.createElement('img');
img.src = new URL('hero.jpg', import.meta.url);
document.body.appendChild(img);
    "#;

    let RunVisitResult { output_code, .. } = run_visit(input_code, |context| {
      make_dependency_collector(context, &mut items, &mut diagnostics, &config)
    });

    let hash = make_placeholder_hash("hero.jpg", DependencyKind::Url);
    let expected_code = format!(
      r#"
let img = document.createElement('img');
img.src = new URL(require("{}"));
document.body.appendChild(img);
    "#,
      hash
    );
    let expected_code = expected_code
      .trim_start()
      .trim_end_matches(|p: char| p == ' ');

    assert_eq!(output_code, expected_code);
    assert_eq!(diagnostics, []);
    assert_eq!(
      items,
      [DependencyDescriptor {
        kind: DependencyKind::Url,
        specifier: "hero.jpg".into(),
        // attributes: None,
        flags: DependencyFlags::empty(),
        source_type: Some(SourceType::Module),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }
}
