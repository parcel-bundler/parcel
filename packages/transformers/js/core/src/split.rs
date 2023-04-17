use std::{
  collections::{hash_map::Entry, HashMap, HashSet},
  fmt::{Debug, Formatter},
  hash::{Hash, Hasher},
  iter::Peekable,
  mem::discriminant,
};

use indexmap::IndexMap;
use petgraph::{
  dot::{Config, Dot},
  prelude::{DiGraph, EdgeIndex, NodeIndex},
  visit::{
    DfsPostOrder, EdgeRef, GraphRef, IntoNeighbors, IntoNeighborsDirected, VisitMap, Visitable,
  },
};
use swc_atoms::JsWord;
use swc_common::{SyntaxContext, DUMMY_SP};
use swc_ecmascript::{
  ast::{
    AssignExpr, ClassExpr, Decl, DefaultDecl, ExportDecl, ExportNamedSpecifier, ExportSpecifier,
    FnExpr, Id, Ident, ImportDecl, ImportDefaultSpecifier, ImportNamedSpecifier, ImportSpecifier,
    ImportStarAsSpecifier, MemberProp, Module, ModuleDecl, ModuleExportName, ModuleItem,
    NamedExport, PropName, Stmt, UnaryExpr, UnaryOp, UpdateExpr, VarDecl,
  },
  visit::{Visit, VisitWith},
};

use crate::{collect::Collect, utils::match_export_name_ident};

#[derive(Debug)]
struct ValueGraph {
  pub graph: DiGraph<ValueGraphNode, ValueGraphEdge>,
  pub nodes: HashMap<ValueGraphNode, NodeIndex>,
}

impl ValueGraph {
  fn new() -> Self {
    Self {
      graph: DiGraph::new(),
      nodes: HashMap::new(),
    }
  }

  fn add_node(&mut self, node: ValueGraphNode) -> NodeIndex {
    if let Some(existing) = self.nodes.get(&node) {
      *existing
    } else {
      let n = self.graph.add_node(node.clone());
      self.nodes.insert(node, n);
      n
    }
  }
  fn add_update_node_exact(&mut self, node: ValueGraphNode) -> NodeIndex {
    if let Some(existing) = self.nodes.get(&node).copied() {
      if !self.graph.node_weight(existing).unwrap().exact_eq(&node) {
        *self.graph.node_weight_mut(existing).unwrap() = node.clone();
        self.nodes.insert(node, existing);
      }
      existing
    } else {
      let n = self.graph.add_node(node.clone());
      self.nodes.insert(node, n);
      n
    }
  }
  fn add_edge(&mut self, a: NodeIndex, b: NodeIndex, edge: ValueGraphEdge) -> EdgeIndex {
    self.graph.add_edge(a, b, edge)
  }

  fn get_node(&self, node: &ValueGraphNode) -> Option<NodeIndex> {
    self.nodes.get(node).copied()
  }

  fn add_referenced_locals<T: for<'a> VisitWith<VisitReferences<'a>>>(
    &mut self,
    id_parent: NodeIndex,
    name: Option<&Id>,
    node: &T,
    collect: &Collect,
  ) {
    let references = find_referenced_locals(node, collect);
    for read in references.reads {
      if name.as_ref().map_or(false, |ident| &read == *ident) {
        continue;
      };
      let id_read = self.add_node(ValueGraphNode::Binding(read));
      self.add_edge(id_parent, id_read, ValueGraphEdge::Read);
    }
    for write in references.writes {
      if name.as_ref().map_or(false, |ident| &write == *ident) {
        continue;
      };
      let id_write = self.add_node(ValueGraphNode::Binding(write));
      self.add_edge(id_parent, id_write, ValueGraphEdge::Write);
    }
  }

  fn get_exports_of_binding(&self, node: NodeIndex) -> Peekable<impl Iterator<Item = &JsWord>> {
    self
      .graph
      .neighbors_directed(node, petgraph::Direction::Incoming)
      .filter_map(|n| {
        let value = self.graph.node_weight(n).unwrap();
        if let ValueGraphNode::Export(name) = value {
          Some(name)
        } else {
          None
        }
      })
      .peekable()
  }

  fn get_single_child_node(&self, node: NodeIndex) -> NodeIndex {
    let mut iter = self
      .graph
      .neighbors_directed(node, petgraph::Direction::Outgoing);
    let value = iter.next().unwrap();
    assert!(iter.next().is_none());
    value
  }
}

#[derive(Clone)]
enum ValueGraphNode {
  Export(JsWord),
  Statement(usize),
  Binding(Id),
  ImportedBinding((Id, JsWord, ModuleExportName)),
}

impl Debug for ValueGraphNode {
  fn fmt(&self, f: &mut Formatter) -> std::fmt::Result {
    match self {
      ValueGraphNode::Export(name) => f.debug_tuple("Export").field(&name.to_string()).finish(),
      ValueGraphNode::Statement(idx) => f.debug_tuple("Statement").field(idx).finish(),
      ValueGraphNode::Binding(id) => f
        .debug_tuple("Binding")
        .field(&(id.0.to_string(), id.1))
        .finish(),
      ValueGraphNode::ImportedBinding((id, source, imported)) => f
        .debug_tuple("ImportedBinding")
        .field(&(id.0.to_string(), id.1))
        .field(&source.to_string())
        .field(&match imported {
          ModuleExportName::Ident(ident) => ident.sym.to_string(),
          ModuleExportName::Str(v) => v.value.to_string(),
        })
        .finish(),
    }
  }
}

impl ValueGraphNode {
  fn is_imported_binding(&self) -> bool {
    matches!(self, ValueGraphNode::ImportedBinding(_))
  }
  #[inline]
  fn exact_eq(&self, other: &ValueGraphNode) -> bool {
    let self_tag = discriminant(self);
    let other_tag = discriminant(other);
    self_tag == other_tag
      && match (self, other) {
        (ValueGraphNode::Export(a), ValueGraphNode::Export(b)) => a == b,
        (ValueGraphNode::Binding(a), ValueGraphNode::Binding(b)) => a == b,
        (ValueGraphNode::Statement(a), ValueGraphNode::Statement(b)) => a == b,
        (ValueGraphNode::ImportedBinding(a), ValueGraphNode::ImportedBinding(b)) => a == b,
        _ => unreachable!(),
      }
  }
}

impl Hash for ValueGraphNode {
  fn hash<H: Hasher>(&self, state: &mut H) {
    match self {
      ValueGraphNode::Export(name) => {
        0.hash(state);
        name.hash(state);
      }
      ValueGraphNode::Statement(idx) => {
        1.hash(state);
        idx.hash(state);
      }
      ValueGraphNode::Binding(id) | ValueGraphNode::ImportedBinding((id, _, _)) => {
        2.hash(state);
        id.hash(state);
      }
    }
  }
}
impl PartialEq for ValueGraphNode {
  #[inline]
  fn eq(&self, other: &Self) -> bool {
    match (self, other) {
      (ValueGraphNode::Export(a), ValueGraphNode::Export(b)) => a == b,
      (ValueGraphNode::Statement(a), ValueGraphNode::Statement(b)) => a == b,
      (ValueGraphNode::Binding(a), ValueGraphNode::Binding(b))
      | (ValueGraphNode::ImportedBinding((a, _, _)), ValueGraphNode::Binding(b))
      | (ValueGraphNode::Binding(a), ValueGraphNode::ImportedBinding((b, _, _)))
      | (ValueGraphNode::ImportedBinding((a, _, _)), ValueGraphNode::ImportedBinding((b, _, _))) => {
        a == b
      }
      _ => false,
    }
  }
}
impl Eq for ValueGraphNode {}

#[derive(Debug, PartialEq, Eq)]
enum ValueGraphEdge {
  Read,
  Write,
}

const COMMON_ID: usize = 1;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
struct ModuleIndex(usize);
impl ModuleIndex {
  pub fn common() -> Self {
    ModuleIndex(COMMON_ID)
  }

  pub fn index(&self) -> usize {
    self.0
  }

  pub fn as_import_specifier(&self, module_id: &str) -> String {
    format!("{}{}", module_id, self.index())
  }
}

// const OFFSET: usize = 2;

pub fn split(
  module_id: &str,
  module: Module,
  collect: &Collect,
) -> (Module, Vec<(String, Module)>) {
  let mut graph = ValueGraph::new();

  for (i, it) in module.body.iter().enumerate() {
    match it {
      ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(decl)) => {
        for (name, decl) in get_decl_names(&decl.decl) {
          let id_export = graph.add_node(ValueGraphNode::Export(name.0.clone()));
          let id_local = graph.add_node(ValueGraphNode::Binding(name.clone()));
          graph.add_edge(id_export, id_local, ValueGraphEdge::Read);
          graph.add_referenced_locals(id_local, Some(&name), &decl, collect);
        }
      }
      ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(decl)) => {
        let name = match &decl.decl {
          DefaultDecl::Class(ClassExpr {
            ident: Some(ident), ..
          })
          | DefaultDecl::Fn(FnExpr {
            ident: Some(ident), ..
          }) => Some(ident.to_id()),
          _ => None,
        };

        let id_export = graph.add_node(ValueGraphNode::Export("default".into()));
        let id_local = graph.add_node(if let Some(name) = &name {
          ValueGraphNode::Binding(name.clone())
        } else {
          ValueGraphNode::Binding(("default export".into(), SyntaxContext::empty()))
        });
        graph.add_edge(id_export, id_local, ValueGraphEdge::Read);
        graph.add_referenced_locals(id_local, name.as_ref(), &decl.decl, collect);
      }
      ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(expr)) => {
        let id_export = graph.add_node(ValueGraphNode::Export("default".into()));
        let id_local = graph.add_node(ValueGraphNode::Binding((
          "default export".into(),
          SyntaxContext::empty(),
        )));
        graph.add_edge(id_export, id_local, ValueGraphEdge::Read);
        graph.add_referenced_locals(id_local, None, &expr.expr, collect);
      }
      ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(NamedExport {
        specifiers,
        src: None,
        ..
      })) => {
        for spec in specifiers {
          let (local, exported) = match spec {
            ExportSpecifier::Namespace(_) => continue,
            ExportSpecifier::Default(v) => (v.exported.to_id(), "default".into()),
            ExportSpecifier::Named(spec) => (
              match_export_name_ident(&spec.orig).to_id(),
              match spec.exported.as_ref().unwrap_or(&spec.orig) {
                ModuleExportName::Ident(v) => v.sym.clone(),
                ModuleExportName::Str(v) => v.value.clone(),
              },
            ),
          };
          let id_export = graph.add_node(ValueGraphNode::Export(exported));
          let id_local = graph.add_node(ValueGraphNode::Binding(local));
          graph.add_edge(id_export, id_local, ValueGraphEdge::Read);
          // uses get added below
        }
      }
      ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(_))
      | ModuleItem::ModuleDecl(ModuleDecl::ExportAll(_)) => {
        // Ignore, no need to include this in the graph
      }
      ModuleItem::ModuleDecl(ModuleDecl::Import(decl)) => {
        for spec in &decl.specifiers {
          match spec {
            ImportSpecifier::Named(ImportNamedSpecifier {
              imported, local, ..
            }) => {
              graph.add_update_node_exact(ValueGraphNode::ImportedBinding((
                local.to_id(),
                decl.src.value.clone(),
                imported
                  .clone()
                  .unwrap_or_else(|| ModuleExportName::Ident(local.clone())),
              )));
            }
            ImportSpecifier::Default(ImportDefaultSpecifier { local, .. }) => {
              graph.add_update_node_exact(ValueGraphNode::ImportedBinding((
                local.to_id(),
                decl.src.value.clone(),
                ModuleExportName::Ident((JsWord::from("default"), SyntaxContext::empty()).into()),
              )));
            }
            ImportSpecifier::Namespace(ImportStarAsSpecifier { local, .. }) => {
              graph.add_update_node_exact(ValueGraphNode::ImportedBinding((
                local.to_id(),
                decl.src.value.clone(),
                ModuleExportName::Str(JsWord::from("*").into()),
              )));
            }
          }
        }
      }
      ModuleItem::Stmt(Stmt::Decl(decl)) => {
        for (name, decl) in get_decl_names(decl) {
          let id_local = graph.add_node(ValueGraphNode::Binding(name.clone()));
          graph.add_referenced_locals(id_local, Some(&name), &decl, collect);
        }
      }
      ModuleItem::Stmt(stmt) => {
        let id_stmt = graph.add_node(ValueGraphNode::Statement(i));
        graph.add_referenced_locals(id_stmt, None, stmt, collect);
      }
      _ => unreachable!(),
    }
  }

  // node index -> final module index
  // let graph_assignment: HashMap<usize, usize> = {
  //     // node index -> export/statement nodes which use it
  //     let mut users: HashMap<usize, HashSet<usize>> = HashMap::new();
  //     for root_idx in graph.graph.node_indices() {
  //         if let ValueGraphNode::Export(_) | ValueGraphNode::Statement(_) =
  //             graph.graph.node_weight(root_idx).unwrap()
  //         {
  //             let mut bfs = Bfs::new(&graph.graph, root_idx);
  //             while let Some(nx) = bfs.next(&graph.graph) {
  //                 if nx == root_idx {
  //                     continue;
  //                 }
  //                 users
  //                     .entry(nx.index())
  //                     .or_default()
  //                     .insert(root_idx.index());
  //             }
  //         }
  //     }

  //     // [export/statements nodes] -> [uses of these nodes]
  //     let mut users_reverse: HashMap<Vec<usize>, Vec<usize>> = HashMap::new();
  //     for (node_idx, export_idx) in &users {
  //         let mut k: Vec<usize> = export_idx.iter().cloned().collect();
  //         k.sort();
  //         users_reverse.entry(k).or_default().push(*node_idx);
  //     }

  //     println!("{:?}", users);
  //     println!("{:?}", users_reverse);

  //     HashMap::from_iter(
  //         users_reverse
  //             .iter()
  //             .enumerate()
  //             .flat_map(|(i, (exports, uses))| {
  //                 exports.iter().chain(uses.iter()).map(move |v| (*v, i))
  //             }),
  //     )
  // };

  // Visit write edges so that source and target are in the same module
  // let graph_assignment: HashMap<usize, usize> = {
  //     let mut graph_assignment: HashMap<usize, usize> = HashMap::new();
  //     let mut next_id = 2;
  //     for nx in graph.graph.node_indices() {
  //         for e in graph
  //             .graph
  //             .edges_directed(nx, petgraph::Direction::Incoming)
  //         {
  //             if e.weight() == &ValueGraphEdge::Write {
  //                 let idx = graph_assignment
  //                     .get(&e.source().index())
  //                     .copied()
  //                     .or(graph_assignment.get(&e.target().index()).copied())
  //                     .unwrap_or_else(|| {
  //                         next_id += 1;
  //                         next_id - 1
  //                     });

  //                 graph_assignment.insert(e.source().index(), idx);
  //                 graph_assignment.insert(e.target().index(), idx);
  //             }
  //         }
  //     }
  //     graph_assignment
  // };

  let graph_assignment: HashMap<NodeIndex, ModuleIndex> = {
    // graph node -> export index
    let mut graph_assignment: HashMap<NodeIndex, ModuleIndex> = HashMap::new();

    // Put every export into a new module, put revisited nodes (so used by multiple exports) into common module
    let mut next_id = COMMON_ID + 1;
    for root_idx in graph.graph.node_indices() {
      if let ValueGraphNode::Export(_) = graph.graph.node_weight(root_idx).unwrap() {
        let root_id = next_id;
        next_id += 1;

        let mut traversal = Dfs::new(&graph.graph, root_idx);
        assert_eq!(root_idx, traversal.next(&graph.graph).unwrap()); // skip root
        if let Some(existing) = graph_assignment.get(&traversal.peek(&graph.graph).unwrap()) {
          // Binding is exported multiple times
          graph_assignment.insert(root_idx, *existing);
        } else {
          graph_assignment.insert(root_idx, ModuleIndex(root_id));
          while let Some(nx) = traversal.next(&graph.graph) {
            if graph.graph.node_weight(nx).unwrap().is_imported_binding() {
              continue;
            }
            match graph_assignment.entry(nx) {
              Entry::Vacant(e) => {
                e.insert(ModuleIndex(root_id));
              }
              Entry::Occupied(mut e) => {
                e.insert(ModuleIndex(COMMON_ID));
                // TODO if it's already set to COMMON_ID, skip children
              }
            };
          }
        }
      }
    }

    // The subgraph of statements also has to be contained in a single module
    for root_idx in graph.graph.node_indices() {
      if let ValueGraphNode::Statement(_) = graph.graph.node_weight(root_idx).unwrap() {
        let mut traversal = DfsPostOrder::new(&graph.graph, root_idx);
        let mut in_module = None;
        while let Some(nx) = traversal.next(&graph.graph) {
          if graph.graph.node_weight(nx).unwrap().is_imported_binding() {
            continue;
          }
          let v = graph_assignment.get(&nx).copied();
          if in_module.is_none() {
            in_module = v;
          }
          if v != in_module {
            in_module = Some(ModuleIndex::common());
            break;
          }
        }

        in_module = in_module.or(Some(ModuleIndex::common()));
        let mut traversal = Dfs::new(&graph.graph, root_idx);
        while let Some(nx) = traversal.next(&graph.graph) {
          if graph.graph.node_weight(nx).unwrap().is_imported_binding() {
            continue;
          }
          graph_assignment.insert(nx, in_module.unwrap());
        }
      }
    }

    // Ensure that write edges start and end in the same module
    for ex in graph.graph.edge_indices() {
      let (e_source, e_target) = graph.graph.edge_endpoints(ex).unwrap();
      if graph.graph.edge_weight(ex).unwrap() == &ValueGraphEdge::Write {
        let source_module = graph_assignment.get(&e_source);
        let target_module = graph_assignment.get(&e_target);
        if source_module.is_some() && source_module != target_module {
          let mut traversal = Dfs::new(&graph.graph, e_target);
          while let Some(nx) = traversal.next(&graph.graph) {
            if graph.graph.node_weight(nx).unwrap().is_imported_binding() {
              continue;
            }
            graph_assignment.insert(nx, ModuleIndex::common());
          }

          let mut export_nodes_to_rewrite = vec![];
          let mut traversal = DfsAncestors::new(&graph.graph, e_target);
          while let Some(nx) = traversal.next(&graph.graph) {
            if let ValueGraphNode::Export(_) = graph.graph.node_weight(nx).unwrap() {
              export_nodes_to_rewrite.push(nx);
            }
          }

          let mut traversal = Dfs::from_parts(export_nodes_to_rewrite, graph.graph.visit_map());
          while let Some(nx) = traversal.next(&graph.graph) {
            if graph.graph.node_weight(nx).unwrap().is_imported_binding() {
              continue;
            }
            graph_assignment.insert(nx, ModuleIndex::common());
          }
        }
      }
    }

    graph_assignment
  };

  // println!(
  //   "{:?}",
  //   Dot::with_attr_getters(
  //     &graph.graph,
  //     &[Config::NodeNoLabel],
  //     &|_graph, edge| {
  //       if graph_assignment.get(&edge.source()) == graph_assignment.get(&edge.target()) {
  //         "".to_owned()
  //       } else {
  //         ", color = lightgrey".to_owned()
  //       }
  //     },
  //     &|_graph, (node_idx, node_weight)| {
  //       format!(
  //         "label=\"[{}] {}: {:?}\"",
  //         node_idx.index(),
  //         format!("{:?}", node_weight).replace('\"', "\\\""),
  //         graph_assignment.get(&node_idx).map(|v| v.index())
  //       )
  //     }
  //   )
  // );

  let mut reexports: Vec<ModuleItem> = vec![];
  let mut modules: IndexMap<ModuleIndex, Vec<ModuleItem>> = IndexMap::new();

  for (i, it) in module.body.into_iter().enumerate() {
    match it {
      ModuleItem::Stmt(Stmt::Decl(decl)) => {
        for (name, decl) in split_up_decl(decl) {
          let node_local = graph
            .get_node(&ValueGraphNode::Binding(name.clone()))
            .unwrap();
          let id_local = *graph_assignment
            .get(&node_local)
            .unwrap_or(&ModuleIndex::common());

          let mut is_used_externally = false;
          let exports = graph
            .graph
            .neighbors_directed(node_local, petgraph::Direction::Incoming)
            .filter_map(|node_parent| {
              let value = graph.graph.node_weight(node_parent).unwrap();
              match value {
                ValueGraphNode::Export(name) => {
                  is_used_externally = true;
                  Some(name)
                }
                ValueGraphNode::Statement(_) | ValueGraphNode::Binding(_) => {
                  is_used_externally = is_used_externally
                    || graph_assignment
                      .get(&node_parent)
                      .map_or(false, |i| i != &id_local);
                  None
                }
                ValueGraphNode::ImportedBinding(_) => unreachable!(),
              }
            });
          for exported in exports {
            reexports.push(ModuleItem::ModuleDecl(create_export_named(
              ModuleExportName::Ident(name.clone().into()),
              Some(word_to_export_name(exported.clone())),
              Some(&id_local.as_import_specifier(module_id)),
            )));
          }

          let mut body =
            generate_imports(module_id, &graph, &graph_assignment, node_local, id_local);
          body.push(ModuleItem::Stmt(Stmt::Decl(decl)));
          if is_used_externally {
            body.push(ModuleItem::ModuleDecl(create_export_named(
              ModuleExportName::Ident(name.clone().into()),
              Some(word_to_export_name(name.0.clone())),
              None,
            )));
          }
          modules.entry(id_local).or_default().append(&mut body);
        }
      }
      ModuleItem::Stmt(_) => {
        let node_idx = graph.get_node(&ValueGraphNode::Statement(i)).unwrap();
        let id = *graph_assignment.get(&node_idx).unwrap();
        modules.entry(id).or_default().push(it);
        continue;
      }
      ModuleItem::ModuleDecl(decl) => match decl {
        ModuleDecl::ExportDefaultDecl(decl) => {
          let node_export = graph
            .get_node(&ValueGraphNode::Export("default".into()))
            .unwrap();
          let id_export = *graph_assignment.get(&node_export).unwrap();
          let node_local = graph.get_single_child_node(node_export);
          let id_local = *graph_assignment.get(&node_local).unwrap();

          for exported_renamed in graph.get_exports_of_binding(node_local) {
            reexports.push(ModuleItem::ModuleDecl(create_export_named(
              ModuleExportName::Ident(("default".into(), SyntaxContext::empty()).into()),
              Some(word_to_export_name(exported_renamed.clone())),
              Some(&id_export.as_import_specifier(module_id)),
            )));
          }

          let mut body =
            generate_imports(module_id, &graph, &graph_assignment, node_local, id_local);
          body.push(ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(decl)));
          modules.entry(id_export).or_default().append(&mut body);
        }
        ModuleDecl::ExportDefaultExpr(expr) => {
          let node_export = graph
            .get_node(&ValueGraphNode::Export("default".into()))
            .unwrap();
          let id_export = *graph_assignment.get(&node_export).unwrap();
          let node_local = graph.get_single_child_node(node_export);
          let id_local = *graph_assignment.get(&node_local).unwrap();

          reexports.push(ModuleItem::ModuleDecl(create_export_named(
            ModuleExportName::Ident(("default".into(), SyntaxContext::empty()).into()),
            None,
            Some(&id_export.as_import_specifier(module_id)),
          )));

          let mut body =
            generate_imports(module_id, &graph, &graph_assignment, node_local, id_local);
          body.push(ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(expr)));
          modules.entry(id_export).or_default().append(&mut body);
        }
        ModuleDecl::ExportNamed(NamedExport { src: Some(_), .. }) | ModuleDecl::ExportAll(_) => {
          reexports.push(ModuleItem::ModuleDecl(decl));
        }
        ModuleDecl::ExportNamed(NamedExport {
          specifiers,
          src: None,
          ..
        }) => {
          for spec in specifiers {
            let exported = match spec {
              ExportSpecifier::Namespace(_) => continue,
              ExportSpecifier::Default(_) => "default".into(),
              ExportSpecifier::Named(spec) => match spec.exported.as_ref().unwrap_or(&spec.orig) {
                ModuleExportName::Ident(v) => v.sym.clone(),
                ModuleExportName::Str(v) => v.value.clone(),
              },
            };
            let id_export = graph.get_node(&ValueGraphNode::Export(exported)).unwrap();
            let id_local = graph
              .graph
              .node_weight(graph.get_single_child_node(id_export))
              .unwrap();
            if let ValueGraphNode::ImportedBinding((_, source, imported)) = id_local {
              reexports.push(ModuleItem::ModuleDecl(create_export_named(
                imported.clone(),
                Some(imported.clone()),
                Some(source),
              )))
            }
          }
        }
        // Handled by locals/ImportedBinding
        ModuleDecl::Import(_) => continue,
        // Handled when visiting the exported declarations themselves
        ModuleDecl::ExportDecl(decl) => {
          for (exported, decl) in split_up_decl(decl.decl) {
            // just put the export where the local ended up. Which means that
            // graph_assignment(ValueGraphNode:Export) is just ignored
            let node_local = graph
              .get_node(&ValueGraphNode::Binding(exported.clone()))
              .unwrap();

            let id_local = *graph_assignment.get(&node_local).unwrap();

            for exported_renamed in graph.get_exports_of_binding(node_local) {
              reexports.push(ModuleItem::ModuleDecl(create_export_named(
                ModuleExportName::Ident(exported.clone().into()),
                Some(word_to_export_name(exported_renamed.clone())),
                Some(&id_local.as_import_specifier(module_id)),
              )));
            }

            let mut body =
              generate_imports(module_id, &graph, &graph_assignment, node_local, id_local);
            body.push(ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
              span: DUMMY_SP,
              decl,
            })));
            modules.entry(id_local).or_default().append(&mut body);
          }
        }
        _ => unreachable!(),
      },
    }
  }

  let mut result = Vec::with_capacity(modules.len());
  for (i, body) in modules.into_iter() {
    result.push((
      i.as_import_specifier(module_id),
      Module {
        body,
        span: DUMMY_SP,
        shebang: None,
      },
    ))
  }

  (
    Module {
      body: reexports,
      span: DUMMY_SP,
      shebang: None,
    },
    result,
  )
}

fn generate_imports(
  module_id: &str,
  graph: &ValueGraph,
  graph_assignment: &HashMap<NodeIndex, ModuleIndex>,
  node_local: NodeIndex,
  id_local: ModuleIndex,
) -> Vec<ModuleItem> {
  graph
    .graph
    .neighbors_directed(node_local, petgraph::Direction::Outgoing)
    .map(|n| {
      (
        graph.graph.node_weight(n).unwrap(),
        graph_assignment.get(&n).copied(),
      )
    })
    .filter_map(|v| match v.0 {
      ValueGraphNode::Binding(n) => {
        if v.1.unwrap_or(ModuleIndex::common()) != id_local {
          Some(ModuleItem::ModuleDecl(create_import(
            n,
            None,
            &v.1.unwrap().as_import_specifier(module_id),
          )))
        } else {
          None
        }
      }
      ValueGraphNode::ImportedBinding((id, source, imported)) => Some(ModuleItem::ModuleDecl(
        create_import(id, Some(imported.clone()), source),
      )),
      ValueGraphNode::Export(_) | ValueGraphNode::Statement(_) => unreachable!(),
    })
    .collect()
}

fn create_import(local: &Id, imported: Option<ModuleExportName>, src: &str) -> ModuleDecl {
  let local: Ident = Ident::from(local.clone());

  let is_namespace = imported.as_ref().map_or(false, |imported| match imported {
    ModuleExportName::Ident(_) => false,
    ModuleExportName::Str(v) => v.value == *"*",
  });
  ModuleDecl::Import(ImportDecl {
    span: DUMMY_SP,
    specifiers: vec![if is_namespace {
      ImportSpecifier::Namespace(ImportStarAsSpecifier {
        span: DUMMY_SP,
        local,
      })
    } else {
      ImportSpecifier::Named(ImportNamedSpecifier {
        span: DUMMY_SP,
        local,
        imported,
        is_type_only: false,
      })
    }],
    src: Box::new(src.into()),
    type_only: false,
    asserts: None,
  })
}

fn create_export_named(
  local: ModuleExportName,
  exported: Option<ModuleExportName>,
  src: Option<&str>,
) -> ModuleDecl {
  ModuleDecl::ExportNamed(NamedExport {
    span: DUMMY_SP,
    specifiers: vec![ExportSpecifier::Named(ExportNamedSpecifier {
      span: DUMMY_SP,
      orig: local,
      exported,
      is_type_only: false,
    })],
    src: src.map(|src| Box::new(src.into())),
    type_only: false,
    asserts: None,
  })
}

fn word_to_export_name(v: JsWord) -> ModuleExportName {
  ModuleExportName::Ident(Ident::new(v, DUMMY_SP))
}

fn find_referenced_locals<T: for<'a> VisitWith<VisitReferences<'a>>>(
  node: &T,
  collect: &Collect,
) -> ReferencesResult {
  let mut uses = VisitReferences {
    collect,
    reads: HashSet::new(),
    writes: HashSet::new(),
    in_write: false,
  };
  node.visit_with(&mut uses);
  ReferencesResult {
    reads: uses.reads,
    writes: uses.writes,
  }
}
struct VisitReferences<'a> {
  collect: &'a Collect,
  reads: HashSet<Id>,
  writes: HashSet<Id>,
  in_write: bool,
}

#[derive(Debug)]
struct ReferencesResult {
  pub reads: HashSet<Id>,
  pub writes: HashSet<Id>,
}

impl<'a> VisitReferences<'a> {
  fn handle_id(&mut self, id: Id) {
    if id.1.has_mark(self.collect.global_mark)
      && (self.collect.decls.contains(&id) || self.collect.imports.contains_key(&id))
    {
      if self.in_write {
        // self.reads.remove(&id);
        self.writes.insert(id);
      } else {
        // if !self.writes.contains(&id)
        self.reads.insert(id);
      }
    }
  }
}

impl Visit for VisitReferences<'_> {
  fn visit_ident(&mut self, ident: &Ident) {
    self.handle_id(ident.to_id());
  }
  // fn visit_expr(&mut self, expr: &Expr) {
  //     expr.visit_children_with(self);
  //     if let Expr::Ident(ident) = expr {
  //         self.handle_id(ident.to_id());
  //     }
  // }

  // fn visit_assign_pat_prop(&mut self, node: &AssignPatProp) {
  //     node.value.visit_with(self);
  // }

  // fn visit_pat(&mut self, pat: &Pat) {
  //     pat.visit_children_with(self);

  //     if let Pat::Ident(ident) = pat {
  //         self.handle_id(ident.to_id());
  //     }
  // }

  fn visit_assign_expr(&mut self, expr: &AssignExpr) {
    let old = self.in_write;
    self.in_write = true;
    expr.left.visit_with(self);
    self.in_write = old;
    expr.right.visit_with(self);
  }
  fn visit_update_expr(&mut self, expr: &UpdateExpr) {
    let old = self.in_write;
    self.in_write = true;
    expr.visit_children_with(self);
    self.in_write = old;
  }
  fn visit_unary_expr(&mut self, expr: &UnaryExpr) {
    if expr.op == UnaryOp::Delete {
      let old = self.in_write;
      self.in_write = true;
      expr.visit_children_with(self);
      self.in_write = old;
    } else {
      expr.visit_children_with(self);
    }
  }

  fn visit_member_prop(&mut self, n: &MemberProp) {
    if let MemberProp::Computed(..) = n {
      n.visit_children_with(self);
    }
  }

  fn visit_prop_name(&mut self, n: &PropName) {
    if let PropName::Computed(..) = n {
      n.visit_children_with(self);
    }
  }
}

fn get_decl_names(decl: &Decl) -> Vec<(Id, Decl)> {
  // TODO get rid of clone which is needed because of the Decl::Var(...) allocation
  match decl {
    Decl::Class(ref v) => vec![(v.ident.to_id(), decl.clone())],
    Decl::Fn(ref v) => vec![(v.ident.to_id(), decl.clone())],
    Decl::Var(var) => var
      .decls
      .iter()
      .map(|var_decl| {
        (
          var_decl.name.as_ident().unwrap().to_id(),
          Decl::Var(Box::new(VarDecl {
            span: DUMMY_SP,
            kind: var.kind,
            declare: var.declare,
            decls: vec![var_decl.clone()],
          })),
        )
      })
      .collect(),
    _ => unreachable!(),
  }
}

fn split_up_decl(decl: Decl) -> Vec<(Id, Decl)> {
  match decl {
    Decl::Class(ref v) => vec![(v.ident.to_id(), decl)],
    Decl::Fn(ref v) => vec![(v.ident.to_id(), decl)],
    Decl::Var(var) => var
      .decls
      .into_iter()
      .map(|var_decl| {
        (
          var_decl.name.as_ident().unwrap().to_id(),
          Decl::Var(Box::new(VarDecl {
            span: DUMMY_SP,
            kind: var.kind,
            declare: var.declare,
            decls: vec![var_decl],
          })),
        )
      })
      .collect(),
    _ => unreachable!(),
  }
}

#[derive(Clone, Debug)]
pub struct DfsAncestors<N, VM> {
  /// The stack of nodes to visit
  pub stack: Vec<N>,
  /// The map of discovered nodes
  pub discovered: VM,
}

impl<N, VM> Default for DfsAncestors<N, VM>
where
  VM: Default,
{
  fn default() -> Self {
    DfsAncestors {
      stack: Vec::new(),
      discovered: VM::default(),
    }
  }
}

impl<N, VM> DfsAncestors<N, VM>
where
  N: Copy + PartialEq,
  VM: VisitMap<N>,
{
  /// Create a new **Dfs**, using the graph's visitor map, and put **start**
  /// in the stack of nodes to visit.
  pub fn new<G>(graph: G, start: N) -> Self
  where
    G: GraphRef + Visitable<NodeId = N, Map = VM>,
  {
    let mut dfs = DfsAncestors::empty(graph);
    dfs.move_to(start);
    dfs
  }

  /// Create a new **Dfs** using the graph's visitor map, and no stack.
  pub fn empty<G>(graph: G) -> Self
  where
    G: GraphRef + Visitable<NodeId = N, Map = VM>,
  {
    DfsAncestors {
      stack: Vec::new(),
      discovered: graph.visit_map(),
    }
  }

  /// Keep the discovered map, but clear the visit stack and restart
  /// the dfs from a particular node.
  pub fn move_to(&mut self, start: N) {
    self.stack.clear();
    self.stack.push(start);
  }

  /// Return the next node in the dfs, or **None** if the traversal is done.
  pub fn next<G>(&mut self, graph: G) -> Option<N>
  where
    G: IntoNeighborsDirected<NodeId = N>,
  {
    while let Some(node) = self.stack.pop() {
      if self.discovered.visit(node) {
        for succ in graph.neighbors_directed(node, petgraph::Direction::Incoming) {
          if !self.discovered.is_visited(&succ) {
            self.stack.push(succ);
          }
        }
        return Some(node);
      }
    }
    None
  }
}

#[derive(Clone, Debug)]
pub struct Dfs<N, VM> {
  /// The stack of nodes to visit
  pub stack: Vec<N>,
  /// The map of discovered nodes
  pub discovered: VM,

  peeked: Option<N>,
}

impl<N, VM> Default for Dfs<N, VM>
where
  VM: Default,
{
  fn default() -> Self {
    Dfs {
      stack: Vec::new(),
      discovered: VM::default(),
      peeked: None,
    }
  }
}

impl<N, VM> Dfs<N, VM>
where
  N: Copy + PartialEq,
  VM: VisitMap<N>,
{
  /// Create a new **Dfs**, using the graph's visitor map, and put **start**
  /// in the stack of nodes to visit.
  pub fn new<G>(graph: G, start: N) -> Self
  where
    G: GraphRef + Visitable<NodeId = N, Map = VM>,
  {
    let mut dfs = Dfs::empty(graph);
    dfs.move_to(start);
    dfs
  }

  /// Create a `Dfs` from a vector and a visit map
  pub fn from_parts(stack: Vec<N>, discovered: VM) -> Self {
    Dfs {
      stack,
      discovered,
      peeked: None,
    }
  }

  /// Create a new **Dfs** using the graph's visitor map, and no stack.
  pub fn empty<G>(graph: G) -> Self
  where
    G: GraphRef + Visitable<NodeId = N, Map = VM>,
  {
    Dfs {
      stack: Vec::new(),
      discovered: graph.visit_map(),
      peeked: None,
    }
  }

  /// Keep the discovered map, but clear the visit stack and restart
  /// the dfs from a particular node.
  pub fn move_to(&mut self, start: N) {
    self.stack.clear();
    self.stack.push(start);
  }

  /// Return the next node in the dfs, or **None** if the traversal is done.
  pub fn next<G>(&mut self, graph: G) -> Option<N>
  where
    G: IntoNeighbors<NodeId = N>,
  {
    if self.peeked.is_some() {
      return self.peeked.take();
    }

    while let Some(node) = self.stack.pop() {
      if self.discovered.visit(node) {
        for succ in graph.neighbors(node) {
          if !self.discovered.is_visited(&succ) {
            self.stack.push(succ);
          }
        }
        return Some(node);
      }
    }
    None
  }

  /// Peek at the next node
  pub fn peek<G>(&mut self, graph: G) -> Option<N>
  where
    G: IntoNeighbors<NodeId = N>,
  {
    if self.peeked.is_some() {
      return self.peeked;
    }

    self.peeked = self.next(graph);
    self.peeked
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::collect_decls;
  use swc_common::comments::SingleThreadedComments;
  use swc_common::{sync::Lrc, FileName, Globals, Mark, SourceMap};
  use swc_ecmascript::ast::FnDecl;
  use swc_ecmascript::parser::lexer::Lexer;
  use swc_ecmascript::parser::{Parser, StringInput};
  use swc_ecmascript::transforms::resolver;
  use swc_ecmascript::visit::FoldWith;

  fn parse(code: &str, cb: impl FnOnce(Collect, Module)) {
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
        let unresolved_mark = Mark::fresh(Mark::root());
        let global_mark = Mark::fresh(Mark::root());
        let module = module.fold_with(&mut resolver(unresolved_mark, global_mark, false));

        let mut collect = Collect::new(
          source_map.clone(),
          collect_decls(&module),
          Mark::fresh(Mark::root()),
          global_mark,
          true,
        );
        module.visit_with(&mut collect);

        cb(collect, module)
        // let module = module.fold_with(&mut chain!(hygiene(), fixer(Some(&comments))));
        // let code = emit(source_map, comments, &module);
        // (collect, code, res)
      }),
      Err(err) => {
        panic!("{:?}", err);
      }
    };
  }

  // fn emit(
  //     source_map: Lrc<SourceMap>,
  //     comments: SingleThreadedComments,
  //     module: &Module,
  // ) -> String {
  //     let mut src_map_buf = vec![];
  //     let mut buf = vec![];
  //     {
  //         let writer = Box::new(JsWriter::new(
  //             source_map.clone(),
  //             "\n",
  //             &mut buf,
  //             Some(&mut src_map_buf),
  //         ));
  //         let config = swc_ecmascript::codegen::Config {
  //             minify: false,
  //             ascii_only: false,
  //             target: swc_ecmascript::ast::EsVersion::Es5,
  //             omit_last_semi: false,
  //         };
  //         let mut emitter = swc_ecmascript::codegen::Emitter {
  //             cfg: config,
  //             comments: Some(&comments),
  //             cm: source_map,
  //             wr: writer,
  //         };
  //         emitter.emit_module(module).unwrap();
  //     }
  //     String::from_utf8(buf).unwrap()
  // }

  macro_rules! set (
      { $($key:expr),* } => {
          {
              #[allow(unused_mut)]
              let mut m = HashSet::new();
              $(
                  m.insert($key);
              )*
              m
          }
      };
  );

  macro_rules! w {
    ($s: expr) => {{
      let w: JsWord = $s.into();
      w
    }};
  }

  #[test]
  fn esm() {
    parse(
      r#"
let x = 1;
let y = 2;
let z = 2;
function f(){
  console.log(a, x, y);
}
function g(){
  x = 2;
  a = 2;
  y++;
  delete z.x;
}
  "#,
      |collect, module| {
        macro_rules! find_func {
          ($n: expr) => {{
            module
              .body
              .iter()
              .find_map(|v| {
                if let ModuleItem::Stmt(Stmt::Decl(Decl::Fn(FnDecl {
                  ident: Ident { sym, .. },
                  function,
                  ..
                }))) = v
                {
                  if sym == &JsWord::from($n) {
                    return Some(&**function);
                  }
                }
                None
              })
              .unwrap()
          }};
        }
        let func_f = find_func!("f");
        let func_g = find_func!("g");
        let locals_f = find_referenced_locals(func_f, &collect);
        let locals_g = find_referenced_locals(func_g, &collect);
        assert_eq!(
          locals_f
            .reads
            .into_iter()
            .map(|v| v.0)
            .collect::<HashSet<_>>(),
          set! { w!("x"), w!("y") }
        );
        assert_eq!(
          locals_f
            .writes
            .into_iter()
            .map(|v| v.0)
            .collect::<HashSet<_>>(),
          set! {}
        );
        assert_eq!(
          locals_g
            .reads
            .into_iter()
            .map(|v| v.0)
            .collect::<HashSet<_>>(),
          set! {}
        );
        assert_eq!(
          locals_g
            .writes
            .into_iter()
            .map(|v| v.0)
            .collect::<HashSet<_>>(),
          set! { w!("x"), w!("y"), w!("z") }
        );
      },
    );
  }
}
