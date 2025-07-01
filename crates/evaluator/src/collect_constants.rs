use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use petgraph::dot::Dot;
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::{EdgeRef, VisitMap, Visitable};
use swc_core::ecma::utils::for_each_binding_ident;
use swc_core::ecma::visit::{visit_obj_and_computed, Visit, VisitWith};
use swc_core::{common::DUMMY_SP, ecma::ast::*};

use crate::fs::create_fs_module;
use crate::macros::{MacroCallback, MacroModule};
use crate::path::create_path_module;
use crate::{Evaluate, Evaluator, JsValue};

pub fn collect_constants(node: &Module, evaluator: &mut Evaluator) {
  let mut collector = ConstantCollector {
    graph: DiGraph::new(),
    ids: HashMap::new(),
  };

  collector.visit_module(node);

  let graph = collector.graph;
  println!("{:?}", Dot::new(&graph));

  let mut visited = graph.visit_map();
  let mut stack = Vec::new();

  for node in graph.node_indices() {
    if matches!(graph[node], Node::Id) && !visited.contains(node.index()) {
      stack.push(node);
    }

    while let Some(node_index) = stack.last() {
      let node_index = *node_index;
      if visited.visit(node_index) {
        // Visit dependencies before declarations.
        for edge in graph.edges_directed(node_index, petgraph::Direction::Outgoing) {
          if matches!(edge.weight(), AccessType::Read | AccessType::Declare)
            && !visited.contains(edge.target().index())
          {
            stack.push(edge.target());
          }
        }
      } else {
        stack.pop();

        match &graph[node_index] {
          Node::Id => {}
          Node::Var(decl) => {
            if let Some(init) = &decl.init {
              let val = init.evaluate(evaluator);
              evaluator.eval_pat(val, &decl.name, &mut Evaluator::add_value);
            }
          }
          Node::Fn(f) => {
            let val = f.function.evaluate(evaluator);
            evaluator.add_value(f.ident.to_id(), val);
          }
          Node::Class(c) => {
            // let val = c.class.evaluate(evaluator);
            // evaluator.add_value(c.ident.to_id(), val);
          }
          Node::Expr(expr) => {
            evaluator.eval_mutation(expr);
          }
        }

        // Visit writes after declaration.
        for edge in graph.edges_directed(node_index, petgraph::Direction::Outgoing) {
          if matches!(edge.weight(), AccessType::Write) && !visited.contains(edge.target().index())
          {
            stack.push(edge.target());
          }
        }
      }
    }
  }
}

struct ConstantCollector<'a> {
  // module: Rc<RefCell<crate::module::Module>>,
  // evaluator: Evaluator<'a>,
  // call_macro: MacroCallback,
  graph: DiGraph<Node<'a>, AccessType>,
  ids: HashMap<Id, NodeIndex>,
}

#[derive(Debug)]
enum AccessType {
  Declare,
  Read,
  Write,
}

#[derive(Debug, Clone)]
enum Node<'a> {
  Id,
  Var(&'a VarDeclarator),
  Fn(&'a FnDecl),
  Class(&'a ClassDecl),
  Expr(&'a Expr),
}

#[derive(Debug, Clone, Copy)]
enum Access {
  None,
  Declare(NodeIndex),
  Read(NodeIndex),
  Write(NodeIndex),
}

impl Access {
  fn read(self) -> Access {
    match self {
      Access::None => Access::None,
      Access::Declare(v) => Access::Read(v),
      Access::Read(v) => Access::Read(v),
      Access::Write(v) => Access::Read(v),
    }
  }
}

impl<'a> ConstantCollector<'a> {
  fn access(&mut self, node_index: NodeIndex, access: Access) {
    match access {
      Access::None => {}
      Access::Declare(dep) => {
        self.graph.add_edge(node_index, dep, AccessType::Declare);
      }
      Access::Write(dep) => {
        self.graph.add_edge(node_index, dep, AccessType::Write);
      }
      Access::Read(dep) => {
        self.graph.add_edge(dep, node_index, AccessType::Read);
      }
    }
  }

  fn access_id(&mut self, id: Id, access: Access) {
    let node_index = *self
      .ids
      .entry(id)
      .or_insert_with(|| self.graph.add_node(Node::Id));
    self.access(node_index, access);
  }
}

impl<'a> ConstantCollector<'a> {
  fn visit_module(&mut self, node: &'a Module) {
    // Visit import statements first.
    // for item in &node.body {
    //   if let ModuleItem::ModuleDecl(ModuleDecl::Import(import)) = item {
    //     let attrs = if let Some(attrs) = &import.with {
    //       attrs.evaluate(&self.evaluator)
    //     } else {
    //       JsValue::Unknown(import.span)
    //     };

    //     let namespace = if matches!(attrs.get(&JsValue::String("type".into()), DUMMY_SP), JsValue::String(t) if t == "macro")
    //     {
    //       JsValue::Object(
    //         Rc::new(MacroModule {
    //           module: self.module.clone(),
    //           src: import.src.value.clone(),
    //           callback: self.call_macro.clone(),
    //         })
    //         .into(),
    //       )
    //     } else {
    //       match import.src.value.as_str() {
    //         "path" | "node:path" => create_path_module(),
    //         // "fs" | "node:fs" => create_fs_module(self.project_root.to_string()),
    //         _ => JsValue::Unknown(DUMMY_SP),
    //       }
    //     };

    //     if matches!(namespace, JsValue::Object(..)) {
    //       for specifier in &import.specifiers {
    //         match specifier {
    //           ImportSpecifier::Named(named) => {
    //             let imported = match &named.imported {
    //               Some(ModuleExportName::Ident(id)) => id.sym.clone(),
    //               Some(ModuleExportName::Str(s)) => s.value.clone(),
    //               None => named.local.sym.clone(),
    //             };
    //             let value = namespace.get(&JsValue::String(imported), DUMMY_SP);
    //             self.evaluator.add_value(named.local.to_id(), value);
    //           }
    //           ImportSpecifier::Default(default) => {
    //             self
    //               .evaluator
    //               .add_value(default.local.to_id(), namespace.clone());
    //           }
    //           ImportSpecifier::Namespace(ns) => {
    //             self
    //               .evaluator
    //               .add_value(ns.local.to_id(), namespace.clone());
    //           }
    //         }
    //       }
    //     }
    //   }
    // }

    for item in &node.body {
      match item {
        ModuleItem::Stmt(stmt) => {
          self.visit_stmt(stmt, Access::None);
        }
        _ => {}
      }
    }
  }

  fn visit_stmt(&mut self, stmt: &'a Stmt, access: Access) {
    match stmt {
      Stmt::Block(BlockStmt { stmts, .. }) => {
        for stmt in stmts {
          self.visit_stmt(stmt, access);
        }
      }
      Stmt::Empty(_) => {}
      Stmt::Debugger(_) => {}
      Stmt::With(_) => todo!(),
      Stmt::Return(ReturnStmt { arg, .. }) => {
        if let Some(arg) = arg {
          self.visit_expr(&*arg, access);
        }
      }
      Stmt::Labeled(LabeledStmt { body, .. }) => {
        self.visit_stmt(&*body, access);
      }
      Stmt::Break(_) => {}
      Stmt::Continue(_) => {}
      Stmt::If(IfStmt {
        test, cons, alt, ..
      }) => {
        self.visit_expr(&*test, access);
        self.visit_stmt(&*cons, access);
        if let Some(alt) = alt {
          self.visit_stmt(&*alt, access);
        }
      }
      Stmt::Switch(SwitchStmt {
        discriminant,
        cases,
        ..
      }) => {
        self.visit_expr(&*discriminant, access);
        for case in cases {
          if let Some(test) = &case.test {
            self.visit_expr(test, access);
          }
          for stmt in &case.cons {
            self.visit_stmt(stmt, access);
          }
        }
      }
      Stmt::Throw(ThrowStmt { arg, .. }) => {
        self.visit_expr(&*arg, access);
      }
      Stmt::Try(stmt) => {
        for stmt in &stmt.block.stmts {
          self.visit_stmt(stmt, access);
        }
        if let Some(handler) = &stmt.handler {
          if let Some(param) = &handler.param {
            self.visit_pat(param, access);
          }
          for stmt in &handler.body.stmts {
            self.visit_stmt(stmt, access);
          }
        }
        if let Some(finalizer) = &stmt.finalizer {
          for stmt in &finalizer.stmts {
            self.visit_stmt(stmt, access);
          }
        }
      }
      Stmt::While(WhileStmt { test, body, .. }) | Stmt::DoWhile(DoWhileStmt { test, body, .. }) => {
        self.visit_expr(test, access);
        self.visit_stmt(body, access);
      }
      Stmt::For(ForStmt {
        init,
        test,
        update,
        body,
        ..
      }) => {
        if let Some(init) = init {
          match init {
            VarDeclOrExpr::VarDecl(decl) => self.visit_var_decl(decl, access),
            VarDeclOrExpr::Expr(expr) => self.visit_expr(expr, access),
          }
        }
        if let Some(test) = test {
          self.visit_expr(test, access);
        }
        if let Some(update) = update {
          self.visit_expr(update, access);
        }
        self.visit_stmt(body, access);
      }
      Stmt::ForIn(ForInStmt {
        left, right, body, ..
      })
      | Stmt::ForOf(ForOfStmt {
        left, right, body, ..
      }) => {
        match left {
          ForHead::VarDecl(decl) => self.visit_var_decl(decl, access),
          ForHead::UsingDecl(_) => todo!(),
          ForHead::Pat(pat) => self.visit_pat(pat, access),
        }

        self.visit_expr(&*right, access);
        self.visit_stmt(body, access);
      }
      Stmt::Decl(decl) => self.visit_decl(decl, access),
      Stmt::Expr(ExprStmt { expr, .. }) => {
        self.visit_expr(&*expr, access);
      }
    }
  }

  fn visit_decl(&mut self, decl: &'a Decl, access: Access) {
    match decl {
      Decl::Class(class_decl) => {
        let node = self.graph.add_node(Node::Class(class_decl));
        self.access_id(class_decl.ident.to_id(), Access::Declare(node));
        self.visit_class(&class_decl.class, access);
      }
      Decl::Fn(fn_decl) => {
        let node = self.graph.add_node(Node::Fn(fn_decl));
        self.access_id(fn_decl.ident.to_id(), Access::Declare(node));
        self.visit_function(&fn_decl.function, access);
      }
      Decl::Var(var_decl) => self.visit_var_decl(var_decl, access),
      Decl::Using(using_decl) => {
        for decl in &using_decl.decls {
          self.visit_var_declarator(decl, access);
        }
      }
      Decl::TsInterface(_) => {}
      Decl::TsTypeAlias(_) => {}
      Decl::TsEnum(_) => {}
      Decl::TsModule(_) => {}
    }
  }

  fn visit_var_decl(&mut self, decl: &'a VarDecl, access: Access) {
    for decl in &decl.decls {
      self.visit_var_declarator(decl, access);
    }
  }

  fn visit_var_declarator(&mut self, decl: &'a VarDeclarator, access: Access) {
    let node_index = self.graph.add_node(Node::Var(decl));
    self.visit_pat(&decl.name, Access::Declare(node_index));
    if let Some(init) = &decl.init {
      self.visit_expr(&*init, Access::Read(node_index));
    }
  }

  fn visit_function(&mut self, function: &'a Function, access: Access) {
    // TODO: decorators

    for param in &function.params {
      // TODO: decorators
      self.visit_pat(&param.pat, access);
    }

    if let Some(body) = &function.body {
      for stmt in &body.stmts {
        self.visit_stmt(stmt, access);
      }
    }
  }

  fn visit_class(&mut self, class: &'a Class, access: Access) {
    // TODO: decorators
    if let Some(super_class) = &class.super_class {
      self.visit_expr(&*&super_class, access);
    }

    for member in &class.body {
      match member {
        ClassMember::Constructor(Constructor {
          key, params, body, ..
        }) => {
          if let PropName::Computed(ComputedPropName { expr, .. }) = key {
            self.visit_expr(expr, access.read());
          }
          for param in params {
            match param {
              ParamOrTsParamProp::Param(param) => {
                self.visit_pat(&param.pat, access);
              }
              ParamOrTsParamProp::TsParamProp(_) => {}
            }
          }
        }
        ClassMember::Method(ClassMethod { key, function, .. }) => {
          if let PropName::Computed(ComputedPropName { expr, .. }) = key {
            self.visit_expr(expr, access.read());
          }
          self.visit_function(function, access.read());
        }
        ClassMember::PrivateMethod(PrivateMethod { function, .. }) => {
          self.visit_function(function, access);
        }
        ClassMember::ClassProp(ClassProp {
          key,
          value,
          decorators,
          ..
        }) => {
          if let PropName::Computed(ComputedPropName { expr, .. }) = key {
            self.visit_expr(expr, access.read());
          }
          if let Some(value) = value {
            self.visit_expr(value, access.read());
          }
        }
        ClassMember::PrivateProp(PrivateProp {
          value, decorators, ..
        }) => {
          if let Some(value) = value {
            self.visit_expr(value, access.read());
          }
        }
        ClassMember::TsIndexSignature(_) => {}
        ClassMember::Empty(_) => {}
        ClassMember::StaticBlock(StaticBlock { body, .. }) => {
          for stmt in &body.stmts {
            self.visit_stmt(stmt, access);
          }
        }
        ClassMember::AutoAccessor(AutoAccessor {
          key,
          value,
          decorators,
          ..
        }) => {
          match key {
            Key::Public(key) => {
              if let PropName::Computed(ComputedPropName { expr, .. }) = key {
                self.visit_expr(expr, access.read());
              }
            }
            Key::Private(_) => {}
          }
          if let Some(value) = value {
            self.visit_expr(value, access.read());
          }
        }
      }
    }
  }

  fn visit_pat(&mut self, pat: &'a Pat, access: Access) {
    match pat {
      Pat::Ident(id) => self.access_id(id.to_id(), access),
      Pat::Array(pat) => self.visit_array_pat(pat, access),
      Pat::Rest(RestPat { arg, .. }) => self.visit_pat(&*arg, access),
      Pat::Object(pat) => self.visit_object_pat(&*pat, access),
      Pat::Assign(AssignPat { left, right, .. }) => {
        self.visit_pat(&*left, access);
        self.visit_expr(&*right, access.read());
      }
      Pat::Invalid(_) => {}
      Pat::Expr(expr) => self.visit_expr(&*expr, access.read()), // ???
    }
  }

  fn visit_array_pat(&mut self, pat: &'a ArrayPat, access: Access) {
    for elem in &pat.elems {
      if let Some(elem) = elem {
        self.visit_pat(elem, access);
      }
    }
  }

  fn visit_object_pat(&mut self, pat: &'a ObjectPat, access: Access) {
    for prop in &pat.props {
      match prop {
        ObjectPatProp::KeyValue(KeyValuePatProp { key, value }) => {
          if let PropName::Computed(ComputedPropName { expr, .. }) = key {
            self.visit_expr(expr, access.read());
          }
          self.visit_pat(&*value, access);
        }
        ObjectPatProp::Assign(AssignPatProp { key, value, .. }) => {
          self.access_id(key.to_id(), access);
          if let Some(value) = value {
            self.visit_expr(&*value, access.read());
          }
        }
        ObjectPatProp::Rest(RestPat { arg, .. }) => {
          self.visit_pat(&*arg, access);
        }
      }
    }
  }

  fn visit_expr(&mut self, expr: &'a Expr, access: Access) {
    match expr {
      Expr::This(_) => {}
      Expr::Array(ArrayLit { elems, .. }) => {
        for elem in elems {
          if let Some(elem) = elem {
            self.visit_expr(&elem.expr, access);
          }
        }
      }
      Expr::Object(ObjectLit { props, .. }) => {
        for prop in props {
          match prop {
            PropOrSpread::Prop(prop) => match &**prop {
              Prop::KeyValue(KeyValueProp { key, value }) => {
                if let PropName::Computed(ComputedPropName { expr, .. }) = key {
                  self.visit_expr(&*expr, access);
                }
                self.visit_expr(&*value, access);
              }
              Prop::Shorthand(id) => {
                self.access_id(id.to_id(), access);
              }
              Prop::Assign(AssignProp { value, .. }) => {
                self.visit_expr(&*value, access);
              }
              Prop::Getter(GetterProp { key, body, .. }) => {
                if let PropName::Computed(ComputedPropName { expr, .. }) = key {
                  self.visit_expr(&*expr, access);
                }
                if let Some(body) = body {
                  for stmt in &body.stmts {
                    self.visit_stmt(stmt, access);
                  }
                }
              }
              Prop::Setter(SetterProp { key, body, .. }) => {
                if let PropName::Computed(ComputedPropName { expr, .. }) = key {
                  self.visit_expr(&*expr, access);
                }
                if let Some(body) = body {
                  for stmt in &body.stmts {
                    self.visit_stmt(stmt, access);
                  }
                }
              }
              Prop::Method(MethodProp { key, function }) => {
                if let PropName::Computed(ComputedPropName { expr, .. }) = key {
                  self.visit_expr(&*expr, access);
                }
                if let Some(body) = &function.body {
                  for stmt in &body.stmts {
                    self.visit_stmt(stmt, access);
                  }
                }
              }
            },
            PropOrSpread::Spread(spread) => {
              self.visit_expr(&*spread.expr, access);
            }
          }
        }
      }
      Expr::Fn(FnExpr { function, .. }) => {
        self.visit_function(function, access);
      }
      Expr::Unary(UnaryExpr { arg, .. }) => {
        self.visit_expr(&*arg, access);
      }
      Expr::Bin(BinExpr { left, right, .. }) => {
        self.visit_expr(&*left, access);
        self.visit_expr(&*right, access);
      }
      Expr::Update(UpdateExpr { arg, .. }) => {
        let node_index = self.graph.add_node(Node::Expr(expr));
        self.access(node_index, access);
        self.visit_expr(&*arg, Access::Write(node_index));
      }
      Expr::Assign(AssignExpr { left, right, .. }) => {
        let node_index = self.graph.add_node(Node::Expr(expr));
        self.access(node_index, access);
        self.visit_expr(&*right, Access::Read(node_index));

        let access = Access::Write(node_index);

        match left {
          AssignTarget::Simple(simple) => match simple {
            SimpleAssignTarget::Ident(id) => self.access_id(id.to_id(), access),
            SimpleAssignTarget::Member(member) => self.visit_member_expr(member, access),
            SimpleAssignTarget::SuperProp(SuperPropExpr { prop, .. }) => {
              if let SuperProp::Computed(ComputedPropName { expr, .. }) = prop {
                self.visit_expr(&*expr, access.read());
              }
            }
            SimpleAssignTarget::Paren(ParenExpr { expr, .. }) => {
              self.visit_expr(&*expr, access);
            }
            SimpleAssignTarget::OptChain(OptChainExpr { base, .. }) => match &**base {
              OptChainBase::Member(member) => self.visit_member_expr(member, access),
              OptChainBase::Call(OptCall { callee, args, .. }) => {
                self.visit_expr(&*callee, access);
                for arg in args {
                  self.visit_expr(&arg.expr, access);
                }
              }
            },
            SimpleAssignTarget::TsAs(_) => {}
            SimpleAssignTarget::TsSatisfies(_) => {}
            SimpleAssignTarget::TsNonNull(_) => {}
            SimpleAssignTarget::TsTypeAssertion(_) => {}
            SimpleAssignTarget::TsInstantiation(_) => {}
            SimpleAssignTarget::Invalid(_) => {}
          },
          AssignTarget::Pat(pat) => match pat {
            AssignTargetPat::Array(pat) => self.visit_array_pat(&*pat, access),
            AssignTargetPat::Object(pat) => self.visit_object_pat(&*pat, access),
            AssignTargetPat::Invalid(_) => {}
          },
        }
      }
      Expr::Member(member) => self.visit_member_expr(member, access),
      Expr::OptChain(opt_chain) => match &*opt_chain.base {
        OptChainBase::Member(member) => {
          self.visit_member_expr(member, access);
        }
        OptChainBase::Call(call) => {
          let node_index = self.graph.add_node(Node::Expr(expr));
          self.access(node_index, access);

          let access = Access::Write(node_index);
          self.visit_expr(&*call.callee, access);

          for arg in &call.args {
            self.visit_expr(&arg.expr, access);
          }
        }
      },
      Expr::SuperProp(SuperPropExpr { prop, .. }) => {
        if let SuperProp::Computed(ComputedPropName { expr, .. }) = prop {
          self.visit_expr(&*expr, access);
        }
      }
      Expr::Cond(CondExpr {
        test, cons, alt, ..
      }) => {
        self.visit_expr(&*test, access);
        self.visit_expr(&*cons, access);
        self.visit_expr(&*alt, access);
      }
      Expr::Call(CallExpr { callee, args, .. }) => {
        let node_index = self.graph.add_node(Node::Expr(expr));
        self.access(node_index, access);

        let access = Access::Write(node_index);
        if let Callee::Expr(expr) = callee {
          self.visit_expr(&*expr, access);
        }

        for arg in args {
          self.visit_expr(&arg.expr, access);
        }
      }
      Expr::New(NewExpr { callee, args, .. }) => {
        self.visit_expr(&*callee, access);
        if let Some(args) = args {
          for arg in args {
            self.visit_expr(&arg.expr, access);
          }
        }
      }
      Expr::Seq(SeqExpr { exprs, .. }) => {
        for expr in exprs {
          self.visit_expr(expr, access);
        }
      }
      Expr::Ident(id) => {
        self.access_id(id.to_id(), access);
      }
      Expr::Lit(_) => {}
      Expr::Tpl(Tpl { exprs, .. }) => {
        for expr in exprs {
          self.visit_expr(expr, access);
        }
      }
      Expr::TaggedTpl(TaggedTpl { tag, tpl, .. }) => {
        self.visit_expr(&*tag, access);
        for expr in &tpl.exprs {
          self.visit_expr(expr, access);
        }
      }
      Expr::Arrow(ArrowExpr { params, body, .. }) => {
        for param in params {
          self.visit_pat(param, access);
        }

        match &**body {
          BlockStmtOrExpr::BlockStmt(BlockStmt { stmts, .. }) => {
            for stmt in stmts {
              self.visit_stmt(stmt, access);
            }
          }
          BlockStmtOrExpr::Expr(expr) => {
            self.visit_expr(&*expr, access);
          }
        }
      }
      Expr::Class(class_expr) => {
        self.visit_class(&class_expr.class, access);
      }
      Expr::Yield(YieldExpr { arg, .. }) => {
        if let Some(arg) = arg {
          self.visit_expr(&*arg, access);
        }
      }
      Expr::MetaProp(_) => {}
      Expr::Await(AwaitExpr { arg, .. }) => {
        self.visit_expr(&*arg, access);
      }
      Expr::Paren(ParenExpr { expr, .. }) => {
        self.visit_expr(&*expr, access);
      }
      Expr::JSXMember(member) => {
        self.visit_jsx_member_expr(member, access);
      }
      Expr::JSXNamespacedName(_) => {}
      Expr::JSXEmpty(_) => {}
      Expr::JSXElement(el) => {
        self.visit_jsx_element(&*el, access);
      }
      Expr::JSXFragment(frag) => {
        self.visit_jsx_fragment(frag, access);
      }
      Expr::TsTypeAssertion(_) => {}
      Expr::TsConstAssertion(_) => {}
      Expr::TsNonNull(_) => {}
      Expr::TsAs(_) => {}
      Expr::TsInstantiation(_) => {}
      Expr::TsSatisfies(_) => {}
      Expr::PrivateName(_) => {}
      Expr::Invalid(_) => {}
    }
  }

  fn visit_member_expr(&mut self, member: &'a MemberExpr, access: Access) {
    self.visit_expr(&*member.obj, access);
    if let MemberProp::Computed(ComputedPropName { expr, .. }) = &member.prop {
      self.visit_expr(&*expr, access.read());
    }
  }

  fn visit_jsx_member_expr(&mut self, member: &'a JSXMemberExpr, access: Access) {
    match &member.obj {
      JSXObject::JSXMemberExpr(jsxmember_expr) => {
        self.visit_jsx_member_expr(&*jsxmember_expr, access);
      }
      JSXObject::Ident(ident) => {
        self.access_id(ident.to_id(), access);
      }
    }
  }

  fn visit_jsx_element(&mut self, el: &'a JSXElement, access: Access) {
    match &el.opening.name {
      JSXElementName::Ident(id) => {
        self.access_id(id.to_id(), access);
      }
      JSXElementName::JSXMemberExpr(member) => {
        self.visit_jsx_member_expr(member, access);
      }
      JSXElementName::JSXNamespacedName(_) => {}
    }

    for attr in &el.opening.attrs {
      match attr {
        JSXAttrOrSpread::JSXAttr(attr) => {
          if let Some(value) = &attr.value {
            match &value {
              JSXAttrValue::JSXElement(el) => {
                self.visit_jsx_element(&*el, access);
              }
              JSXAttrValue::JSXExprContainer(expr) => {
                self.visit_jsx_expr(expr, access);
              }
              JSXAttrValue::JSXFragment(fragment) => {
                self.visit_jsx_fragment(fragment, access);
              }
              JSXAttrValue::Lit(_) => {}
            }
          }
        }
        JSXAttrOrSpread::SpreadElement(spread) => {
          self.visit_expr(&*spread.expr, access);
        }
      }
    }

    for child in &el.children {
      self.visit_jsx_child(child, access);
    }
  }

  fn visit_jsx_child(&mut self, child: &'a JSXElementChild, access: Access) {
    match child {
      JSXElementChild::JSXText(_) => {}
      JSXElementChild::JSXExprContainer(expr) => {
        self.visit_jsx_expr(expr, access);
      }
      JSXElementChild::JSXSpreadChild(spread) => {
        self.visit_expr(&*spread.expr, access);
      }
      JSXElementChild::JSXElement(element) => {
        self.visit_jsx_element(&*element, access);
      }
      JSXElementChild::JSXFragment(fragment) => self.visit_jsx_fragment(fragment, access),
    }
  }

  fn visit_jsx_expr(&mut self, expr: &'a JSXExprContainer, access: Access) {
    match &expr.expr {
      JSXExpr::Expr(expr) => {
        self.visit_expr(&*expr, access);
      }
      JSXExpr::JSXEmptyExpr(_) => {}
    }
  }

  fn visit_jsx_fragment(&mut self, fragment: &'a JSXFragment, access: Access) {
    for child in &fragment.children {
      self.visit_jsx_child(child, access);
    }
  }
}

#[cfg(test)]
mod tests {
  use swc_core::{
    common::{sync::Lrc, FileName, Globals, Mark, SourceMap},
    ecma::{
      atoms::Atom as JsWord, parser::parse_file_as_module, transforms::base::resolver,
      visit::VisitMutWith,
    },
  };

  use super::*;

  fn parse(code: &str) -> Module {
    let source_map = Lrc::new(SourceMap::default());
    let source_file = source_map.new_source_file(Lrc::new(FileName::Anon), code.into());

    let mut recovered_errors = Vec::new();
    parse_file_as_module(
      &source_file,
      Default::default(),
      Default::default(),
      None,
      &mut recovered_errors,
    )
    .unwrap()
  }

  fn test(code: &str) -> HashMap<JsWord, JsValue> {
    let mut module = parse(code);
    swc_core::common::GLOBALS.set(&Globals::new(), || {
      let unresolved_mark = Mark::fresh(Mark::root());
      let global_mark = Mark::fresh(Mark::root());
      module.visit_mut_with(&mut resolver(unresolved_mark, global_mark, true));
      let mut evaluator = Evaluator::new();

      collect_constants(&module, &mut evaluator);
      evaluator
        .values
        .into_iter()
        .map(|(k, v)| (k.0, v))
        .collect()
    })
  }

  fn expect(code: &str, expected: HashMap<&str, &str>) {
    let result = test(code);
    let result = result
      .into_iter()
      .map(|(k, v)| (k, format!("{}", v)))
      .collect::<HashMap<_, _>>();
    let expected = expected
      .into_iter()
      .map(|(k, v)| (k.into(), v.into()))
      .collect();
    assert_eq!(result, expected);
  }

  #[test]
  fn test_constants() {
    expect(
      "let x = 2; let y = x + 2;",
      HashMap::from([("x", "2"), ("y", "4")]),
    );
    expect(
      "function test() { let y = x + 2; } let x = 2;",
      HashMap::from([("test", "unknown"), ("x", "2"), ("y", "4")]),
    );
  }

  #[test]
  fn test_mutation() {
    // Assignment expression.
    expect("let x = 2; x = 3", HashMap::from([("x", "unknown")]));
    expect("let x = 2; x += 3", HashMap::from([("x", "unknown")]));
    // Mutation inside declaration.
    expect(
      "let x = 2; let y = x += 4;",
      HashMap::from([("x", "unknown"), ("y", "unknown")]),
    );
    // Update expression.
    expect("let x = 2; x++", HashMap::from([("x", "unknown")]));
  }

  #[test]
  fn test_objects() {
    // Mutating object property.
    expect(
      "const x = {a: 1, b: {c: 1}}; const y = x.b; x.b.c = 3;",
      HashMap::from([("x", "{a: 1, b: {c: unknown}}"), ("y", "{c: unknown}")]),
    );
    // Mutating property of reference.
    expect(
      "const x = {a: 1, b: {c: 1}}; const y = x.b; y.c = 3;",
      HashMap::from([("x", "{a: 1, b: {c: unknown}}"), ("y", "{c: unknown}")]),
    );
    // Mutating unknown property.
    expect(
      "const x = {a: 1, b: {c: 1}}; const y = x.b; y[A] = 3;",
      HashMap::from([("x", "{a: 1, b: {}}"), ("y", "{}")]),
    );
    // Mutating computed property.
    expect(
      "const x = {a: 'c', b: {c: 1}}; const y = x.b; y[x.a] = 3;",
      HashMap::from([("x", "{a: \"c\", b: {c: unknown}}"), ("y", "{c: unknown}")]),
    );
    // Mutating sub-property of unknown property.
    expect(
      "const x = {a: 1, b: {c: 1}}; x[B].c = 4;",
      HashMap::from([("x", "{}")]),
    );
    // Mutating unknown property of sub-object.
    expect(
      "const x = {a: 1, b: {c: {d: 2}}}; x.b[Z].d = 4;",
      HashMap::from([("x", "{a: 1, b: {}}")]),
    );

    // Update expression.
    expect(
      "const x = {a: 'c', b: 2}; x.b++",
      HashMap::from([("x", "{a: \"c\", b: unknown}")]),
    );
  }

  #[test]
  fn test_call() {
    // Primitive values are passed by value.
    expect("let x = 2; fn(x)", HashMap::from([("x", "2")]));
    expect("let x = 'hi'; fn(x)", HashMap::from([("x", "\"hi\"")]));
    expect("let x = true; fn(x)", HashMap::from([("x", "true")]));

    // Objects are passed by reference and could be mutated by the function call.
    expect("let x = {foo: 2}; fn(x)", HashMap::from([("x", "{}")]));
    expect("let x = {foo: 2}; fn?.(x)", HashMap::from([("x", "{}")]));
    // This object may also be mutated.
    expect("let x = {foo: 2}; x.bar()", HashMap::from([("x", "{}")]));
    expect("let x = {foo: 2}; x?.bar()", HashMap::from([("x", "{}")]));
  }
}
