use std::{
  cell::RefCell,
  collections::hash_map::DefaultHasher,
  fmt,
  hash::{Hash, Hasher},
  path::Path,
  rc::Rc,
  sync::Arc,
};

use bitflags::bitflags;
use parcel_core::{
  BundleBehavior, CodeFrame, Dependency, DependencyFlags, Diagnostic, DiagnosticSeverity,
  Environment, EnvironmentContext, EnvironmentFeature, EnvironmentFlags, Location, OutputFormat,
  Priority, SourceLocation, SourceType, SpecifierType, impl_bitflags_serde,
};
use parcel_evaluator::{
  Evaluate, Evaluator, Function, JsValue, Object, StaticOrRc, builtin_object,
};
use path_slash::PathBufExt;
use serde::{Deserialize, Serialize};
use sha1::digest::Update;
use swc_core::{
  common::{DUMMY_SP, Mark, SourceMap, Span, Spanned, SyntaxContext, sync::Lrc},
  ecma::{
    ast::*,
    atoms::Atom as JsWord,
    utils::{Type::Obj, member_expr, stack_size::maybe_grow_default},
    visit::{Fold, FoldWith, VisitMut, VisitMutWith},
  },
};

use crate::{
  Config, fold_member_expr_skip_prop,
  fs::{fs_ns, path_ns},
  utils::{create_require, create_url_constructor, is_unresolved, loc},
};

macro_rules! hash {
  ($str:expr) => {{
    let mut hasher = DefaultHasher::new();
    $str.hash(&mut hasher);
    hasher.finish()
  }};
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum DependencyKind {
  Import,
  Export,
  DynamicImport,
  Require,
  WebWorker,
  ServiceWorker,
  Worklet,
  Url,
  File,
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

/// This pass collects dependencies in a module and compiles references as needed to work with Parcel's JSRuntime.
pub fn dependency_collector<'a>(
  mut module: Module,
  source_map: Lrc<SourceMap>,
  items: &'a mut Vec<Dependency>,
  env: Arc<Environment>,
  ignore_mark: Mark,
  global_mark: Mark,
  unresolved_mark: Mark,
  config: &'a Config,
  diagnostics: &'a mut Vec<Diagnostic>,
) -> (Module, Helpers) {
  let mut collector = DependencyCollector::new(
    source_map,
    items,
    env,
    ignore_mark,
    global_mark,
    unresolved_mark,
    config,
    diagnostics,
  );

  module.visit_mut_with(&mut collector);
  (module, collector.helpers)
}

struct DependencyCollector<'a> {
  source_map: Lrc<SourceMap>,
  items: &'a mut Vec<Dependency>,
  env: Arc<Environment>,
  in_try: bool,
  ignore_mark: Mark,
  global_mark: Mark,
  unresolved_mark: Mark,
  diagnostics: &'a mut Vec<Diagnostic>,
  import_meta: Option<VarDecl>,
  helpers: Helpers,
  filename: String,
  relative_filename: String,
  project_root: &'a str,
  evaluator: Evaluator<'a>,
}

impl<'a> DependencyCollector<'a> {
  pub fn new(
    source_map: Lrc<SourceMap>,
    items: &'a mut Vec<Dependency>,
    env: Arc<Environment>,
    ignore_mark: Mark,
    global_mark: Mark,
    unresolved_mark: Mark,
    config: &'a Config,
    diagnostics: &'a mut Vec<Diagnostic>,
  ) -> Self {
    let mut evaluator = Evaluator::new();
    let ctxt = SyntaxContext::empty().apply_mark(unresolved_mark);

    let require = JsValue::Function(
      Rc::new(Require {
        project_root: config.project_root.clone(),
        inline_fs: config.inline_fs(),
      })
      .into(),
    );

    evaluator.add_value(("require".into(), ctxt), require.clone());

    evaluator.add_value(
      ("module".into(), ctxt),
      JsValue::Object(
        Rc::new(indexmap::indexmap! {
          "require".into() => require.clone(),
        })
        .into(),
      ),
    );

    let relative_filename =
      if let Some(relative) = pathdiff::diff_paths(&config.filename, &config.project_root) {
        relative.to_slash_lossy()
      } else if let Some(filename) = Path::new(&config.filename).file_name() {
        String::from(filename.to_string_lossy())
      } else {
        String::from("unknown.js")
      };

    let meta = JsValue::Object(
      Rc::new(ImportMeta {
        url: format!("file:///{}", relative_filename).into(),
      })
      .into(),
    );

    evaluator.add_value(
      ("parcelRequire".into(), ctxt),
      JsValue::Function(StaticOrRc::Rc(Rc::new(ParcelRequire {
        meta: meta.clone(),
      }))),
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

    if env.context.is_worker() {
      evaluator.add_value(
        ("importScripts".into(), ctxt),
        JsValue::Function(StaticOrRc::Static(&import_scripts)),
      );
    }

    if env.context.is_browser() {
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

    if config.insert_node_globals() {
      evaluator.add_value(
        ("__dirname".into(), ctxt),
        JsValue::String(
          Path::new(&config.filename)
            .parent()
            .unwrap()
            .to_str()
            .unwrap()
            .into(),
        ),
      );

      evaluator.add_value(
        ("__filename".into(), ctxt),
        JsValue::String(relative_filename.clone().into()),
      );
    }

    if env.source_type == SourceType::Module {
      // TODO: error if accessed in scripts
      evaluator.import_meta = meta;
    }

    evaluator.dynamic_import = JsValue::Function(StaticOrRc::Static(&import));

    DependencyCollector {
      source_map,
      items,
      env,
      in_try: false,
      ignore_mark,
      global_mark,
      unresolved_mark,
      diagnostics,
      import_meta: None,
      helpers: Helpers::empty(),
      filename: config.filename.clone(),
      project_root: &config.project_root,
      relative_filename,
      evaluator,
    }
  }

  fn add_script_error(&mut self, span: Span) {
    let (message, hint) = match self.env.context {
      EnvironmentContext::WebWorker => (
        "Web workers cannot have imports or exports without the `type: \"module\"` option.",
        "Add {type: 'module'} as a second argument to the Worker constructor.",
      ),
      EnvironmentContext::ServiceWorker => (
        "Service workers cannot have imports or exports without the `type: \"module\"` option.",
        "Add {type: 'module'} as a second argument to the navigator.serviceWorker.register() call.",
      ),
      EnvironmentContext::Browser | _ => (
        "Browser scripts cannot have imports or exports.",
        "Add the type=\"module\" attribute to the <script> tag.",
      ),
    };

    // Only add the diagnostic for imports/exports in scripts once.
    if self.diagnostics.iter().any(|d| d.message == message) {
      return;
    }

    let mut frames = vec![CodeFrame::from_loc(loc(span, &self.source_map), None)];

    if let Some(loc) = &self.env.loc {
      if loc.file_path != Path::new(&self.filename) {
        frames.push(CodeFrame::from_loc(
          loc.clone(),
          Some("The environment was originally created here".into()),
        ));
      }
    }

    self.diagnostics.push(Diagnostic {
      message: message.into(),
      origin: None,
      code_frames: frames,
      hints: vec![hint.into()],
      severity: DiagnosticSeverity::Error,
      documentation_url: Some(String::from(
        "https://parceljs.org/languages/javascript/#classic-scripts",
      )),
    })
  }

  fn add_import_error(&mut self, span: Span) {
    let message = if self.env.context == EnvironmentContext::Worklet {
      "import() is not allowed in worklets."
    } else {
      "import() is not allowed in service workers."
    };
    let mut frames = vec![CodeFrame::from_loc(loc(span, &self.source_map), None)];
    if let Some(loc) = &self.env.loc {
      frames.push(CodeFrame::from_loc(
        loc.clone(),
        Some("The environment was originally created here".into()),
      ));
    }
    self.diagnostics.push(Diagnostic {
      message: message.into(),
      origin: None,
      code_frames: frames,
      hints: vec!["Try using a static `import`.".into()],
      severity: DiagnosticSeverity::Error,
      documentation_url: None,
    });
  }
}

impl<'a> VisitMut for DependencyCollector<'a> {
  fn visit_mut_module(&mut self, node: &mut Module) {
    // Find builtin modules (e.g. fs and path).
    for item in &node.body {
      if let ModuleItem::ModuleDecl(ModuleDecl::Import(import)) = item {
        let namespace = match import.src.value.as_str() {
          "path" | "node:path" => path_ns(),
          "fs" | "node:fs" => fs_ns(self.project_root.to_string()),
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

    node.visit_mut_children_with(self);
    if let Some(decl) = self.import_meta.take() {
      node
        .body
        .insert(0, ModuleItem::Stmt(Stmt::Decl(Decl::Var(Box::new(decl)))));
    }
  }

  fn visit_mut_module_decl(&mut self, node: &mut ModuleDecl) {
    // If an import or export is seen within a script, flag it to throw an error from JS.
    if self.env.source_type == SourceType::Script {
      match node {
        ModuleDecl::Import(ImportDecl { span, .. })
        | ModuleDecl::ExportAll(ExportAll { span, .. })
        | ModuleDecl::ExportDecl(ExportDecl { span, .. })
        | ModuleDecl::ExportDefaultDecl(ExportDefaultDecl { span, .. })
        | ModuleDecl::ExportDefaultExpr(ExportDefaultExpr { span, .. })
        | ModuleDecl::ExportNamed(NamedExport { span, .. }) => self.add_script_error(*span),
        _ => {}
      }
      return;
    }

    node.visit_mut_children_with(self)
  }

  fn visit_mut_import_decl(&mut self, node: &mut ImportDecl) {
    if node.type_only {
      return;
    }

    let mut env = self.env.clone();
    if let Some(attrs) = &node.with {
      if let JsValue::Object(attrs) = attrs.evaluate(&self.evaluator) {
        if let JsValue::String(env_attr) = attrs.get(&JsValue::String("env".into()), DUMMY_SP) {
          if env_attr == "react-server" {
            env = Arc::new(Environment {
              context: EnvironmentContext::ReactServer,
              output_format: OutputFormat::Commonjs,
              ..(*env).clone()
            });
          } else if env_attr == "react-client" {
            env = Arc::new(Environment {
              context: EnvironmentContext::ReactClient,
              output_format: OutputFormat::Esmodule,
              include_node_modules: parcel_core::IncludeNodeModules::Bool(true),
              ..(*env).clone()
            });
          }
        }
      }
    }

    let mut specifier = node.src.value.to_string();
    let mut placeholder = None;
    if self.env.flags.contains(EnvironmentFlags::IS_LIBRARY)
      && self.env.output_format != OutputFormat::Esmodule
    {
      if let Some(rest) = specifier.strip_prefix("@swc/helpers/_/") {
        specifier = format!("@swc/helpers/cjs/{}.cjs", rest);
        placeholder = Some(specifier.clone());
        node.src = Box::new(specifier.clone().into());
      }
    }

    let mut flags = DependencyFlags::IS_ESM;

    let is_helper = node.span.is_dummy()
      && !(specifier.ends_with("/jsx-runtime") || specifier.ends_with("/jsx-dev-runtime"));
    flags.set(DependencyFlags::IS_HELPER, is_helper);

    // Always bundle helpers, even with includeNodeModules: false, except if this is a library.
    if is_helper && !self.env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
      env = Arc::new(Environment {
        include_node_modules: parcel_core::IncludeNodeModules::Bool(true),
        ..(*env).clone()
      })
    }

    self.items.push(Dependency {
      specifier,
      specifier_type: SpecifierType::Esm,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags,
      env,
      placeholder,
      loc: Some(loc(node.src.span, &self.source_map)),
      resolve_from: None,
      range: None,
    });
  }

  fn visit_mut_named_export(&mut self, node: &mut NamedExport) {
    if node.type_only {
      return;
    }

    if let Some(src) = &mut node.src {
      self.items.push(Dependency {
        specifier: src.value.to_string(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Sync,
        bundle_behavior: BundleBehavior::None,
        flags: DependencyFlags::IS_ESM,
        env: self.env.clone(),
        loc: Some(loc(src.span, &self.source_map)),
        placeholder: None,
        resolve_from: None,
        range: None,
      });
    }
  }

  fn visit_mut_export_all(&mut self, node: &mut ExportAll) {
    if node.type_only {
      return;
    }

    self.items.push(Dependency {
      specifier: node.src.value.to_string(),
      specifier_type: SpecifierType::Esm,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::IS_ESM,
      env: self.env.clone(),
      loc: Some(loc(node.src.span, &self.source_map)),
      placeholder: None,
      resolve_from: None,
      range: None,
    });
  }

  fn visit_mut_var_decl(&mut self, node: &mut VarDecl) {
    for decl in &node.decls {
      if let Some(expr) = &decl.init {
        let val = expr.evaluate(&self.evaluator);
        self
          .evaluator
          .eval_pat(val, &decl.name, &mut Evaluator::add_value);
      }
    }

    node.visit_mut_children_with(self);
  }

  fn visit_mut_try_stmt(&mut self, node: &mut TryStmt) {
    self.in_try = true;
    node.block.visit_mut_children_with(self);
    self.in_try = false;

    node.handler.visit_mut_children_with(self);
    node.finalizer.visit_mut_children_with(self);
  }

  fn visit_mut_ident(&mut self, node: &mut Ident) {
    if !is_unresolved(&node, self.unresolved_mark) {
      return;
    }

    match node.sym.as_str() {
      "__parcel__require__" => {
        *node = Ident::new(
          "require".into(),
          node.span,
          SyntaxContext::empty().apply_mark(self.ignore_mark),
        )
      }
      "__parcel__import__" => {
        *node = Ident::new(
          "import".into(),
          node.span,
          SyntaxContext::empty().apply_mark(self.ignore_mark),
        )
      }
      "__parcel__importScripts__" => {
        *node = Ident::new(
          "importScripts".into(),
          node.span,
          SyntaxContext::empty().apply_mark(self.ignore_mark),
        )
      }
      "require" => {
        *node = Ident::new(
          "undefined".into(),
          node.span,
          SyntaxContext::empty().apply_mark(self.unresolved_mark),
        )
      }
      _ => {}
    }
  }

  fn visit_mut_new_expr(&mut self, node: &mut NewExpr) {
    if let Expr::Ident(ident) = &*node.callee {
      if ident.sym == "__parcel__URL__" {
        if let Some(args) = &node.args {
          if let Expr::New(new) = create_url_constructor(
            *args[0].expr.clone(),
            self.env.output_format == OutputFormat::Esmodule,
          ) {
            *node = new;
            return;
          }
        }
      }
    }

    node.visit_mut_children_with(self);
  }

  fn visit_mut_expr(&mut self, node: &mut Expr) {
    if matches!(
      node,
      Expr::Call(_) | Expr::New(_) | Expr::Member(_) | Expr::MetaProp(_)
    ) || matches!(node, Expr::Ident(id) if is_unresolved(id, self.unresolved_mark))
    {
      let res = node.evaluate(&self.evaluator);

      let v = match &res {
        JsValue::Object(obj) => Some(obj.as_any()),
        JsValue::Function(f) => Some(f.as_any()),
        _ => None,
      };

      if let Some(v) = v {
        let v = if let Some(d) = v.downcast_ref::<DepObject>() {
          Some(d as &dyn UpdateExpr)
        } else if let Some(d) = v.downcast_ref::<Helpers>() {
          Some(d as &dyn UpdateExpr)
        } else if let Some(d) = v.downcast_ref::<ImportMeta>() {
          Some(d as &dyn UpdateExpr)
        } else {
          None
        };

        if let Some(v) = v {
          if let Err(err) = v.update_expr(node, self) {
            self.diagnostics.push(err);
          }
          return;
        }
      }

      if let Ok(res) = res.into_expr() {
        *node = res;
        return;
      }
    }

    if let Expr::Ident(id) = node {
      if !self.env.should_scope_hoist()
        && is_unresolved(&id, self.unresolved_mark)
        && id.sym == "parcelRequire"
      {
        *node = Expr::Member(member_expr!(
          Default::default(),
          id.span,
          module.bundle.root
        ));
      }
    }

    node.visit_mut_children_with(self);
  }
}

trait UpdateExpr {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic>;
}

struct ImportMeta {
  url: JsWord,
}

impl Object for ImportMeta {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "url" => JsValue::String(self.url.clone()),
      "distDir" => JsValue::Function((&Helpers::DIST_DIR).into()),
      "publicUrl" => JsValue::Function((&Helpers::PUBLIC_URL).into()),
      "devServer" => JsValue::Function((&Helpers::DEV_SERVER).into()),
      _ => JsValue::Unknown(span),
    }
  }

  fn has(&self, prop: &JsValue) -> bool {
    matches!(
      prop.to_string().as_str(),
      "url" | "distDir" | "publicUrl" | "devServer"
    )
  }

  fn iter<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    let keys = &["url", "distDist", "publicUrl", "devServer"];
    Box::new(keys.into_iter().map(|k| {
      (
        (*k).into(),
        self.get(&JsValue::String((*k).into()), DUMMY_SP),
      )
    }))
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    Ok(Expr::Call(CallExpr {
      callee: Callee::Expr(Box::new(Expr::Member(MemberExpr {
        obj: Box::new(Expr::Ident(Ident::new_no_ctxt("Object".into(), DUMMY_SP))),
        prop: MemberProp::Ident(IdentName::new("assign".into(), DUMMY_SP)),
        span: DUMMY_SP,
      }))),
      args: vec![
        ExprOrSpread {
          expr: Box::new(Expr::Call(CallExpr {
            callee: Callee::Expr(Box::new(Expr::Member(MemberExpr {
              obj: (Box::new(Expr::Ident(Ident::new_no_ctxt("Object".into(), DUMMY_SP)))),
              prop: MemberProp::Ident(IdentName::new("create".into(), DUMMY_SP)),
              span: DUMMY_SP,
            }))),
            args: vec![ExprOrSpread {
              expr: Box::new(Expr::Lit(Lit::Null(Null { span: DUMMY_SP }))),
              spread: None,
            }],
            span: DUMMY_SP,
            ctxt: SyntaxContext::empty(),
            type_args: None,
          })),
          spread: None,
        },
        ExprOrSpread {
          expr: Box::new(Expr::Object(ObjectLit {
            props: vec![PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
              key: PropName::Ident(IdentName::new("url".into(), DUMMY_SP)),
              value: Box::new(self.url.clone().into()),
            })))],
            span: DUMMY_SP,
          })),
          spread: None,
        },
      ],
      span: DUMMY_SP,
      ctxt: SyntaxContext::empty(),
      type_args: None,
    }))
  }
}

impl UpdateExpr for ImportMeta {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    if let Some(decl) = &collector.import_meta {
      if let Pat::Ident(name) = &decl.decls[0].name {
        *node = Expr::Ident(name.id.clone())
      } else {
        unreachable!()
      }
    } else {
      // Declares a variable at the top of the module:
      // var import_meta = Object.assign(Object.create(null), {url: 'file:///src/foo.js'});
      let ident = Ident::new(
        "import_meta".into(),
        DUMMY_SP,
        SyntaxContext::empty().apply_mark(collector.global_mark),
      );
      collector.import_meta = Some(VarDecl {
        kind: VarDeclKind::Var,
        declare: false,
        ctxt: SyntaxContext::empty(),
        span: DUMMY_SP,
        decls: vec![VarDeclarator {
          name: Pat::Ident(BindingIdent::from(ident.clone())),
          init: Some(Box::new(self.into_expr().unwrap())),
          definite: false,
          span: DUMMY_SP,
        }],
      });
      *node = Expr::Ident(ident);
    }
    Ok(())
  }
}

enum DepObject {
  Require(RequireDep),
  Import(ImportDep),
  Url(UrlDep),
  Worker(WorkerDep),
  ServiceWorker(ServiceWorkerDep),
  Worklet(WorkletDep),
  ImportScripts(ImportScriptDep),
  ParcelRequire(ParcelRequireDep),
}

impl Object for DepObject {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match self {
      DepObject::Require(dep) => dep.get(prop, span),
      _ => JsValue::Unknown(span),
    }
  }
}

impl UpdateExpr for DepObject {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    match self {
      DepObject::Require(dep) => dep.update_expr(node, collector),
      DepObject::Import(dep) => dep.update_expr(node, collector),
      DepObject::Url(dep) => dep.update_expr(node, collector),
      DepObject::Worker(dep) => dep.update_expr(node, collector),
      DepObject::ServiceWorker(dep) => dep.update_expr(node, collector),
      DepObject::Worklet(dep) => dep.update_expr(node, collector),
      DepObject::ImportScripts(dep) => dep.update_expr(node, collector),
      DepObject::ParcelRequire(dep) => dep.update_expr(node, collector),
    }
  }
}

fn placeholder(filename: &str, specifier: &JsWord, kind: DependencyKind) -> String {
  format!(
    "{:x}",
    hash!(format!("{}:{}:{}", filename, specifier, kind)),
  )
}

struct Require {
  project_root: String,
  inline_fs: bool,
}

impl Object for Require {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "extensions" => JsValue::Undefined,
      _ => JsValue::Unknown(span),
    }
  }
}

impl Function for Require {
  fn call(
    &self,
    _this: JsValue,
    args: Vec<JsValue>,
    span: Span,
    _evaluator: &Evaluator,
  ) -> JsValue {
    if let Some(JsValue::String(src)) = args.get(0) {
      let namespace = match src.as_str() {
        "path" | "node:path" if self.inline_fs => path_ns(),
        "fs" | "node:fs" if self.inline_fs => fs_ns(self.project_root.clone()),
        _ => JsValue::Unknown(DUMMY_SP),
      };

      JsValue::Object(
        Rc::new(DepObject::Require(RequireDep {
          specifier: src.clone(),
          span,
          ns: namespace,
        }))
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

struct RequireDep {
  specifier: JsWord,
  span: Span,
  ns: JsValue,
}

impl UpdateExpr for RequireDep {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    if collector.env.source_type == SourceType::Script {
      collector.add_script_error(node.span());
      return Ok(());
    }

    let placeholder = placeholder(
      &collector.relative_filename,
      &self.specifier,
      DependencyKind::Require,
    );
    let mut d = Dependency {
      specifier: self.specifier.to_string(),
      specifier_type: SpecifierType::Commonjs,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::empty(),
      env: collector.env.clone(),
      loc: Some(loc(self.span, &collector.source_map)),
      placeholder: Some(placeholder.clone()),
      resolve_from: None,
      range: None,
    };
    let placeholder: JsWord = placeholder.into();
    if collector.in_try {
      d.flags |= DependencyFlags::OPTIONAL;
    }
    collector.items.push(d);

    *node = Expr::Call(create_require(
      placeholder,
      collector.unresolved_mark,
      collector.env.source_type,
    ));

    Ok(())
  }
}

impl Object for RequireDep {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    self.ns.get(prop, span)
  }

  fn has(&self, prop: &JsValue) -> bool {
    if let JsValue::Object(obj) = &self.ns {
      obj.has(prop)
    } else {
      false
    }
  }

  fn iter<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    if let JsValue::Object(obj) = &self.ns {
      obj.iter()
    } else {
      Box::new(std::iter::empty())
    }
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    self.ns.clone().into_expr()
  }
}

fn import(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let Some(JsValue::String(src)) = args.get(0) {
    let mut flags = DependencyFlags::empty();
    if let Some(JsValue::Object(attrs)) = args.get(1) {
      if matches!(
        attrs.get(&JsValue::String("preload".into()), DUMMY_SP),
        JsValue::Bool(true)
      ) {
        flags |= DependencyFlags::PRELOAD;
      }

      if matches!(
        attrs.get(&JsValue::String("prefetch".into()), DUMMY_SP),
        JsValue::Bool(true)
      ) {
        flags |= DependencyFlags::PREFETCH;
      }
    }

    JsValue::Object(
      Rc::new(DepObject::Import(ImportDep {
        specifier: src.clone(),
        span,
        flags,
      }))
      .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

struct ImportDep {
  specifier: JsWord,
  span: Span,
  flags: DependencyFlags,
}

impl UpdateExpr for ImportDep {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    if matches!(
      collector.env.context,
      EnvironmentContext::Worklet | EnvironmentContext::ServiceWorker
    ) {
      collector.add_import_error(node.span());
      return Ok(());
    }

    // If all of the target engines support dynamic import natively,
    // we can output native ESM if scope hoisting is enabled.
    // Only do this for scripts, rather than modules in the global
    // output format so that assets can be shared between the bundles.
    let mut output_format = collector.env.output_format;
    if collector.env.source_type == SourceType::Script
      && collector.env.should_scope_hoist()
      && collector
        .env
        .engines
        .supports(EnvironmentFeature::DynamicImport)
    {
      output_format = OutputFormat::Esmodule;
    }

    let env = Arc::new(Environment {
      source_type: SourceType::Module,
      output_format,
      loc: Some(loc(self.span, &collector.source_map)),
      ..(*collector.env).clone()
    });

    let placeholder = placeholder(
      &collector.relative_filename,
      &self.specifier,
      DependencyKind::DynamicImport,
    );
    collector.items.push(Dependency {
      specifier: self.specifier.to_string(),
      specifier_type: SpecifierType::Esm,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::None,
      flags: self.flags,
      env,
      loc: Some(loc(self.span, &collector.source_map)),
      placeholder: Some(placeholder.clone()),
      resolve_from: None,
      range: None,
    });

    if collector.env.should_scope_hoist() && collector.env.source_type != SourceType::Script {
      if let Expr::Call(call) = node {
        call.args[0] = ExprOrSpread {
          expr: Box::new(Expr::Lit(Lit::Str(placeholder.into()))),
          spread: None,
        };
        return Ok(());
      }
    }

    *node = Expr::Call(create_require(
      placeholder.into(),
      collector.unresolved_mark,
      collector.env.source_type,
    ));

    Ok(())
  }
}

fn import_scripts(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let Some(JsValue::String(src)) = args.get(0) {
    // Ignore absolute URLs.
    if src.starts_with("http:") || src.starts_with("https:") || src.starts_with("//") {
      return JsValue::Unknown(span);
    }

    JsValue::Object(Rc::new(DepObject::ImportScripts(ImportScriptDep)).into())
  } else {
    JsValue::Unknown(span)
  }
}

struct ImportScriptDep;
impl UpdateExpr for ImportScriptDep {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    let message = if collector.env.source_type == SourceType::Script {
      "Argument to importScripts() must be a fully qualified URL."
    } else {
      "importScripts() is not supported in module workers."
    };

    let mut d = Diagnostic::from_loc(loc(node.span(), &collector.source_map), message);
    d.hints
      .push("Use a static `import`, or dynamic `import()` instead.".into());
    if collector.env.context == EnvironmentContext::ServiceWorker {
      d.hints.push(
        "Add {type: 'module'} as a second argument to the navigator.serviceWorker.register() call."
          .into(),
      );
    } else if collector.env.context == EnvironmentContext::WebWorker {
      d.hints
        .push("Add {type: 'module'} as a second argument to the Worker constructor.".into());
    }
    d.documentation_url = Some(String::from(
      "https://parceljs.org/languages/javascript/#classic-script-workers",
    ));
    if let Some(loc) = &collector.env.loc {
      d.code_frames.push(CodeFrame::from_loc(
        loc.clone(),
        Some("The environment was originally created here".into()),
      ));
    }

    return Err(d);
  }
}

fn service_worker_register(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  evaluator: &Evaluator,
) -> JsValue {
  if let Some(dep) = match_url_dep(&args, evaluator) {
    let mut source_type = SourceType::Script;
    if let Some(JsValue::Object(obj)) = args.get(1) {
      if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), DUMMY_SP) {
        if ty == "module" {
          source_type = SourceType::Module;
        }
      }
    }

    JsValue::Object(
      Rc::new(DepObject::ServiceWorker(ServiceWorkerDep {
        specifier: dep.clone(),
        source_type,
        span,
      }))
      .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

struct ServiceWorkerDep {
  specifier: JsWord,
  source_type: SourceType,
  span: Span,
}

impl UpdateExpr for ServiceWorkerDep {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    let loc = Some(loc(self.span, &collector.source_map));
    let placeholder = placeholder(
      &collector.relative_filename,
      &self.specifier,
      DependencyKind::ServiceWorker,
    );
    collector.items.push(Dependency {
      specifier: self.specifier.to_string(),
      specifier_type: SpecifierType::Url,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::NEEDS_STABLE_NAME,
      env: Arc::new(Environment {
        context: EnvironmentContext::ServiceWorker,
        source_type: self.source_type,
        output_format: OutputFormat::Global, // TODO: module service worker support
        loc: loc.clone(),
        ..(*collector.env).clone()
      }),
      loc,
      placeholder: Some(placeholder.clone()),
      resolve_from: None,
      range: None,
    });

    if let Expr::Call(call) = node {
      remove_type_option(&mut call.args);
      update_worker_args(&mut call.args, placeholder, collector);
    }

    Ok(())
  }
}

fn update_worker_args(
  args: &mut Vec<ExprOrSpread>,
  placeholder: String,
  collector: &mut DependencyCollector,
) {
  if collector.env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
    args[0] = ExprOrSpread {
      expr: Box::new(create_url_constructor(
        Expr::Lit(Lit::Str(placeholder.into())),
        collector.env.output_format == OutputFormat::Esmodule,
      )),
      spread: None,
    };
  } else {
    args[0] = ExprOrSpread {
      expr: Box::new(Expr::Call(create_require(
        placeholder.into(),
        collector.unresolved_mark,
        collector.env.source_type,
      ))),
      spread: None,
    };
  }
}

fn match_url_dep<'a, 'b>(args: &'a Vec<JsValue>, evaluator: &'b Evaluator) -> Option<&'a JsWord> {
  match args.get(0) {
    Some(JsValue::Object(src)) => {
      if let Some(dep) = src.as_any().downcast_ref::<DepObject>() {
        if let DepObject::Url(url) = dep {
          return Some(&url.specifier);
        }
      }
    }
    // TODO: error if string literal
    Some(v @ JsValue::String(url))
      if *v
        == evaluator
          .import_meta
          .get(&JsValue::String("url".into()), DUMMY_SP) =>
    {
      return Some(url);
    }
    _ => {}
  }

  None
}

fn paint_worklet(_this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let Some(dep) = match_url_dep(&args, evaluator) {
    JsValue::Object(
      Rc::new(DepObject::Worklet(WorkletDep {
        specifier: dep.clone(),
        span,
      }))
      .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

struct WorkletDep {
  specifier: JsWord,
  span: Span,
}

impl UpdateExpr for WorkletDep {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    let loc = Some(loc(self.span, &collector.source_map));
    let placeholder = placeholder(
      &collector.relative_filename,
      &self.specifier,
      DependencyKind::Worklet,
    );
    collector.items.push(Dependency {
      specifier: self.specifier.to_string(),
      specifier_type: SpecifierType::Url,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::empty(),
      env: Arc::new(Environment {
        context: EnvironmentContext::Worklet,
        source_type: SourceType::Module,
        output_format: OutputFormat::Esmodule, // Worklets require ESM
        loc: loc.clone(),
        ..(*collector.env).clone()
      }),
      loc,
      placeholder: Some(placeholder.clone()),
      resolve_from: None,
      range: None,
    });

    if let Expr::Call(call) = node {
      remove_type_option(&mut call.args);
      update_worker_args(&mut call.args, placeholder, collector);
    }

    Ok(())
  }
}

struct URL;
impl Object for URL {}
impl Function for URL {
  fn construct(&self, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    if let (Some(JsValue::String(url)), Some(base)) = (args.get(0), args.get(1)) {
      if *base
        != evaluator
          .import_meta
          .get(&JsValue::String("url".into()), span)
      {
        return JsValue::Unknown(span);
      }

      JsValue::Object(
        Rc::new(DepObject::Url(UrlDep {
          specifier: url.clone(),
          span,
          needs_stable_name: false,
        }))
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

struct UrlDep {
  specifier: JsWord,
  needs_stable_name: bool,
  span: Span,
}

impl UpdateExpr for UrlDep {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    let placeholder = placeholder(
      &collector.relative_filename,
      &self.specifier,
      DependencyKind::Url,
    );
    collector.items.push(Dependency {
      specifier: self.specifier.to_string(),
      specifier_type: SpecifierType::Url,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::Isolated,
      flags: {
        let mut flags = DependencyFlags::empty();
        flags.set(DependencyFlags::NEEDS_STABLE_NAME, self.needs_stable_name);
        flags
      },
      env: collector.env.clone(),
      loc: Some(loc(self.span, &collector.source_map)),
      placeholder: Some(placeholder.clone()),
      resolve_from: None,
      range: None,
    });

    // For library builds, we need to create something that can be statically analyzed by another bundler,
    // so rather than replacing with a require call that is resolved by a runtime, replace with a `new URL`
    // call with a placeholder for the relative path to be replaced during packaging.
    if collector.env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
      *node = create_url_constructor(
        Expr::Lit(Lit::Str(placeholder.into())),
        collector.env.output_format == OutputFormat::Esmodule,
      );
      return Ok(());
    }

    if let Expr::New(new) = node {
      if let Some(args) = &mut new.args {
        args.truncate(1);
        args[0] = ExprOrSpread {
          expr: Box::new(Expr::Call(create_require(
            placeholder.into(),
            collector.unresolved_mark,
            collector.env.source_type,
          ))),
          spread: None,
        };
      }
    }

    Ok(())
  }
}

fn parcel_url_dep(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let (Some(JsValue::String(url)), Some(JsValue::Bool(needs_stable_name))) =
    (args.get(0), args.get(1))
  {
    JsValue::Object(
      Rc::new(DepObject::Url(UrlDep {
        specifier: url.clone(),
        span,
        needs_stable_name: *needs_stable_name,
      }))
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
    if let Some(dep) = match_url_dep(&args, evaluator) {
      let mut source_type = SourceType::Script;
      if let Some(JsValue::Object(obj)) = args.get(1) {
        if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), DUMMY_SP) {
          if ty == "module" {
            source_type = SourceType::Module;
          }
        }
      }

      JsValue::Object(
        Rc::new(DepObject::Worker(WorkerDep {
          specifier: dep.clone(),
          source_type,
          span,
        }))
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
    if let Some(dep) = match_url_dep(&args, evaluator) {
      let mut source_type = SourceType::Script;
      if let Some(JsValue::Object(obj)) = args.get(1) {
        if let JsValue::String(ty) = obj.get(&JsValue::String("type".into()), DUMMY_SP) {
          if ty == "module" {
            source_type = SourceType::Module;
          }
        }
      }

      JsValue::Object(
        Rc::new(DepObject::Worker(WorkerDep {
          specifier: dep.clone(),
          source_type,
          span,
        }))
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

struct WorkerDep {
  specifier: JsWord,
  source_type: SourceType,
  span: Span,
}

impl UpdateExpr for WorkerDep {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    // Use native ES module output if the worker was created with `type: 'module'` and all targets
    // support native module workers. Only do this if parent asset output format is also esmodule so that
    // assets can be shared between workers and the main thread in the global output format.
    let output_format = if collector.env.output_format == OutputFormat::Esmodule
      && self.source_type == SourceType::Module
      && collector
        .env
        .engines
        .supports(EnvironmentFeature::WorkerModule)
    {
      OutputFormat::Esmodule
    } else if collector.env.output_format == OutputFormat::Commonjs {
      OutputFormat::Commonjs
    } else {
      OutputFormat::Global
    };

    let loc = Some(loc(self.span, &collector.source_map));
    let env = Arc::new(Environment {
      context: EnvironmentContext::WebWorker,
      source_type: self.source_type,
      output_format,
      loc: loc.clone(),
      ..(*collector.env).clone()
    });

    let placeholder = placeholder(
      &collector.relative_filename,
      &self.specifier,
      DependencyKind::WebWorker,
    );
    collector.items.push(Dependency {
      specifier: self.specifier.to_string(),
      specifier_type: SpecifierType::Url,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::IS_WEBWORKER,
      env,
      loc,
      placeholder: Some(placeholder.clone()),
      resolve_from: None,
      range: None,
    });

    if let Expr::New(new) = node {
      if let Some(args) = &mut new.args {
        if !collector
          .env
          .engines
          .supports(EnvironmentFeature::WorkerModule)
        {
          remove_type_option(args);
        }

        update_worker_args(args, placeholder, collector);
      }
    }

    Ok(())
  }
}

fn remove_type_option(args: &mut Vec<ExprOrSpread>) {
  if let Some(arg) = args.get_mut(1) {
    if let Expr::Object(obj) = &mut *arg.expr {
      obj.props.retain(|v| {
        if let PropOrSpread::Prop(prop) = v {
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

struct ParcelRequire {
  meta: JsValue,
}

impl Object for ParcelRequire {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "load" => JsValue::Function(StaticOrRc::Static(&Helpers::LOAD)),
      "resolve" => JsValue::Function(StaticOrRc::Static(&Helpers::RESOLVE)),
      "extendImportMap" => JsValue::Function(StaticOrRc::Static(&Helpers::EXTEND_IMPORT_MAP)),
      "meta" => self.meta.clone(),
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
        Rc::new(DepObject::ParcelRequire(ParcelRequireDep {
          id: id.clone(),
          span,
        }))
        .into(),
      )
    } else {
      JsValue::Unknown(span)
    }
  }
}

struct ParcelRequireDep {
  id: JsWord,
  span: Span,
}

impl UpdateExpr for ParcelRequireDep {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    if collector.env.should_scope_hoist() {
      return Ok(());
    }

    if let Expr::Call(call) = node {
      call.callee = Callee::Expr(Box::new(Expr::Member(member_expr!(
        Default::default(),
        call.span,
        module.bundle.root
      ))));
    }

    Ok(())
  }
}

impl Object for Helpers {}
impl Function for Helpers {}

impl UpdateExpr for Helpers {
  fn update_expr(
    &self,
    node: &mut Expr,
    collector: &mut DependencyCollector,
  ) -> Result<(), Diagnostic> {
    collector.helpers |= *self;
    match *self {
      Helpers::RESOLVE => {
        if collector.env.should_scope_hoist() {
          *node = Expr::Ident(Ident::new_no_ctxt("$parcel$resolve".into(), node.span()));
        } else {
          *node = Expr::Member(member_expr!(
            Default::default(),
            DUMMY_SP,
            module.bundle.resolve
          ));
        }
      }
      Helpers::LOAD => {
        if collector.env.should_scope_hoist() {
          *node = Expr::Ident(Ident::new_no_ctxt("$parcel$import".into(), node.span()));
        } else {
          *node = Expr::Member(member_expr!(
            Default::default(),
            DUMMY_SP,
            module.bundle.load
          ));
        }
      }
      Helpers::EXTEND_IMPORT_MAP => {
        if collector.env.should_scope_hoist() {
          *node = Expr::Ident(Ident::new_no_ctxt(
            "$parcel$extendImportMap".into(),
            node.span(),
          ));
        } else {
          *node = Expr::Member(member_expr!(
            Default::default(),
            DUMMY_SP,
            module.bundle.extendImportMap
          ));
        }
      }
      Helpers::DEV_SERVER => {
        if collector.env.should_scope_hoist() {
          *node = Expr::Ident(Ident::new_no_ctxt("$parcel$devServer".into(), node.span()));
        } else {
          *node = Expr::Member(member_expr!(
            Default::default(),
            DUMMY_SP,
            module.bundle.devServer
          ));
        }
      }
      Helpers::PUBLIC_URL => {
        if collector.env.should_scope_hoist() {
          *node = Expr::Ident(Ident::new_no_ctxt("$parcel$publicUrl".into(), node.span()));
        } else {
          *node = Expr::Member(member_expr!(
            Default::default(),
            DUMMY_SP,
            module.bundle.publicUrl
          ));
        }
      }
      Helpers::DIST_DIR => {
        if collector.env.should_scope_hoist() {
          *node = Expr::Ident(Ident::new_no_ctxt("$parcel$distDir".into(), node.span()));
        } else {
          *node = Expr::Member(member_expr!(
            Default::default(),
            DUMMY_SP,
            module.bundle.distDir
          ));
        }
      }
      _ => {}
    }
    Ok(())
  }
}

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
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  let arg = args.get(0).cloned().unwrap_or(JsValue::Undefined);

  if let JsValue::Object(obj) = &arg {
    if let Some(dep) = obj.as_any().downcast_ref::<DepObject>() {
      if let DepObject::Require(dep) = dep {
        return JsValue::Object(
          Rc::new(DepObject::Import(ImportDep {
            specifier: dep.specifier.clone(),
            span: dep.span,
            flags: DependencyFlags::empty(),
          }))
          .into(),
        );
      }
    }
  }

  if matches!(arg, JsValue::Undefined) {
    JsValue::Object(Rc::new(PromiseInstance(arg)).into())
  } else {
    JsValue::Unknown(span)
  }
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
        if let Some(dep) = obj.as_any().downcast_ref::<DepObject>() {
          if let DepObject::Require(dep) = dep {
            return JsValue::Object(
              Rc::new(DepObject::Import(ImportDep {
                specifier: dep.specifier.clone(),
                span: dep.span,
                flags: DependencyFlags::empty(),
              }))
              .into(),
            );
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
                  if let Some(dep) = obj.as_any().downcast_ref::<DepObject>() {
                    if let DepObject::Require(dep) = dep {
                      return JsValue::Object(
                        Rc::new(DepObject::Import(ImportDep {
                          specifier: dep.specifier.clone(),
                          span: dep.span,
                          flags: DependencyFlags::empty(),
                        }))
                        .into(),
                      );
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
  use parcel_core::{Browsers, Engines};
  use pretty_assertions::assert_eq;

  use super::*;
  use crate::test_utils::{RunTestContext, RunVisitResult, run_visit};

  fn make_dependency_collector<'a>(
    context: RunTestContext,
    items: &'a mut Vec<Dependency>,
    diagnostics: &'a mut Vec<Diagnostic>,
    config: &'a Config,
  ) -> DependencyCollector<'a> {
    DependencyCollector::new(
      context.source_map.clone(),
      items,
      config.environment.clone(),
      Mark::new(),
      context.global_mark,
      context.unresolved_mark,
      config,
      diagnostics,
    )
  }

  fn default_env() -> Environment {
    Environment {
      engines: Engines {
        browsers: Browsers {
          chrome: Some(79.into()),
          ..Default::default()
        },
        ..Default::default()
      },
      ..Default::default()
    }
  }

  fn make_config() -> Config {
    Config {
      environment: Arc::new(default_env()),
      ..Default::default()
    }
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
    let config = make_config();
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_import_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Sync,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
        placeholder: None,
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_export_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Sync,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
        placeholder: None,
        ..items[0].clone()
      }]
    );
  }

  #[test]
  fn test_export_star_dependency() {
    let mut items = vec![];
    let mut diagnostics = vec![];
    let config = make_config();
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Sync,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Commonjs,
        priority: Priority::Sync,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Commonjs,
        priority: Priority::Sync,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::OPTIONAL,
        env: Arc::new(default_env()),
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Url,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::IS_WEBWORKER,
        env: Arc::new(Environment {
          context: EnvironmentContext::WebWorker,
          source_type: SourceType::Module,
          output_format: OutputFormat::Global,
          loc: items[0].loc.clone(),
          ..default_env()
        }),
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Url,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::NEEDS_STABLE_NAME,
        env: Arc::new(Environment {
          context: EnvironmentContext::ServiceWorker,
          source_type: SourceType::Module,
          output_format: OutputFormat::Global,
          loc: items[0].loc.clone(),
          ..default_env()
        }),
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
      [Dependency {
        specifier: "other".into(),
        specifier_type: SpecifierType::Url,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(Environment {
          context: EnvironmentContext::Worklet,
          source_type: SourceType::Module,
          output_format: OutputFormat::Esmodule,
          loc: items[0].loc.clone(),
          ..default_env()
        }),
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
      [Dependency {
        specifier: "hero.jpg".into(),
        specifier_type: SpecifierType::Url,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::Isolated,
        // attributes: None,
        flags: DependencyFlags::empty(),
        env: Arc::new(default_env()),
        placeholder: Some(hash),
        ..items[0].clone()
      }]
    );
  }
}
