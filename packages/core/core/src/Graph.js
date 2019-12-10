// @flow

import type {Edge, Node, NodeId} from './types';
import type {TraversalActions, GraphVisitor} from '@parcel/types';

import assert from 'assert';
import {DefaultMap} from '@parcel/utils';
import nullthrows from 'nullthrows';

export type GraphOpts<TNode, TEdgeType: string | null = null> = {|
  nodes?: Map<NodeId, TNode>,
  edges?: Array<Edge<TEdgeType | null>>,
  rootNodeId?: ?NodeId,
|};

type AdjacencyList<TEdgeType> = DefaultMap<
  NodeId,
  DefaultMap<TEdgeType, Set<NodeId>>,
>;

export const ALL_EDGE_TYPES = '@@all_edge_types';

export default class Graph<TNode: Node, TEdgeType: string | null = null> {
  nodes: Map<NodeId, TNode>;
  inboundEdges: AdjacencyList<TEdgeType | null> = new DefaultMap(
    () => new DefaultMap(() => new Set()),
  );
  outboundEdges: AdjacencyList<TEdgeType | null> = new DefaultMap(
    () => new DefaultMap(() => new Set()),
  );
  rootNodeId: ?NodeId;

  constructor(
    opts: GraphOpts<TNode, TEdgeType> = ({}: any), // flow is dumb
  ) {
    this.nodes = opts.nodes || new Map();
    this.rootNodeId = opts.rootNodeId;

    if (opts.edges) {
      for (let edge of opts.edges) {
        this.addEdge(edge.from, edge.to, edge.type);
      }
    }
  }

  static deserialize(opts: GraphOpts<TNode, TEdgeType>) {
    return new this(opts);
  }

  serialize(): GraphOpts<TNode, TEdgeType> {
    return {
      nodes: this.nodes,
      edges: this.getAllEdges(),
      rootNodeId: this.rootNodeId,
    };
  }

  // Returns a list of all edges in the graph. This can be large, so iterating
  // the complete list can be costly in large graphs. Used in serialization and
  // copying of graphs.
  getAllEdges(): Array<Edge<TEdgeType | null>> {
    let edges = [];
    for (let [from, edgeList] of this.outboundEdges) {
      for (let [type, toNodes] of edgeList) {
        for (let to of toNodes) {
          edges.push({from, to, type});
        }
      }
    }
    return edges;
  }

  addNode(node: TNode): TNode {
    this.nodes.set(node.id, node);
    return node;
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  getNode(id: string): ?TNode {
    return this.nodes.get(id);
  }

  setRootNode(node: TNode): void {
    this.addNode(node);
    this.rootNodeId = node.id;
  }

  getRootNode(): ?TNode {
    return this.rootNodeId ? this.getNode(this.rootNodeId) : null;
  }

  addEdge(from: NodeId, to: NodeId, type: TEdgeType | null = null): void {
    if (!this.getNode(from)) {
      throw new Error(`"from" node '${from}' not found`);
    }

    if (!this.getNode(to)) {
      throw new Error(`"to" node '${to}' not found`);
    }

    this.outboundEdges
      .get(from)
      .get(type)
      .add(to);
    this.inboundEdges
      .get(to)
      .get(type)
      .add(from);
  }

  hasEdge(from: NodeId, to: NodeId, type?: TEdgeType | null = null): boolean {
    return this.outboundEdges
      .get(from)
      .get(type)
      .has(to);
  }

  getNodesConnectedTo(
    node: TNode,
    type: TEdgeType | null = null,
  ): Array<TNode> {
    assertHasNode(this, node);

    let nodes;
    if (type === ALL_EDGE_TYPES) {
      nodes = new Set();
      for (let [, typeNodes] of this.inboundEdges.get(node.id)) {
        for (let node of typeNodes) {
          nodes.add(node);
        }
      }
    } else {
      nodes = this.inboundEdges
        .get(node.id)
        .get(type)
        .values();
    }

    return [...nodes].map(to => nullthrows(this.nodes.get(to)));
  }

  getNodesConnectedFrom(
    node: TNode,
    type: TEdgeType | null = null,
  ): Array<TNode> {
    assertHasNode(this, node);

    let nodes;
    if (type === ALL_EDGE_TYPES) {
      nodes = new Set();
      for (let [, typeNodes] of this.outboundEdges.get(node.id)) {
        for (let node of typeNodes) {
          nodes.add(node);
        }
      }
    } else {
      nodes = this.outboundEdges
        .get(node.id)
        .get(type)
        .values();
    }

    return [...nodes].map(to => nullthrows(this.nodes.get(to)));
  }

  merge(graph: Graph<TNode>): void {
    for (let [, node] of graph.nodes) {
      this.addNode(node);
    }

    for (let edge of graph.getAllEdges()) {
      this.addEdge(edge.from, edge.to, edge.type);
    }
  }

  // Removes node and any edges coming from or to that node
  removeNode(node: TNode) {
    assertHasNode(this, node);

    for (let [type, nodesForType] of this.inboundEdges.get(node.id)) {
      for (let from of nodesForType) {
        this.removeEdge(
          from,
          node.id,
          type,
          // Do not allow orphans to be removed as this node could be one
          // and is already being removed.
          false /* removeOrphans */,
        );
      }
    }

    for (let [type, toNodes] of this.outboundEdges.get(node.id)) {
      for (let to of toNodes) {
        this.removeEdge(node.id, to, type);
      }
    }

    let wasRemoved = this.nodes.delete(node.id);
    assert(wasRemoved);
  }

  removeById(id: NodeId) {
    let node = nullthrows(this.getNode(id));
    this.removeNode(node);
  }

  removeEdges(node: TNode, type: TEdgeType | null = null) {
    assertHasNode(this, node);

    for (let to of this.outboundEdges.get(node.id).get(type)) {
      this.removeEdge(node.id, to, type);
    }
  }

  // Removes edge and node the edge is to if the node is orphaned
  removeEdge(
    from: NodeId,
    to: NodeId,
    type: TEdgeType | null = null,
    removeOrphans: boolean = true,
  ) {
    if (
      !this.outboundEdges
        .get(from)
        .get(type)
        .has(to)
    ) {
      throw new Error(`Outbound edge from ${from} to ${to} not found!`);
    }

    if (
      !this.inboundEdges
        .get(to)
        .get(type)
        .has(from)
    ) {
      throw new Error(`Inbound edge from ${to} to ${from} not found!`);
    }

    this.outboundEdges
      .get(from)
      .get(type)
      .delete(to);

    this.inboundEdges
      .get(to)
      .get(type)
      .delete(from);

    let connectedNode = nullthrows(this.nodes.get(to));
    if (removeOrphans && this.isOrphanedNode(connectedNode)) {
      this.removeNode(connectedNode);
    }
  }

  isOrphanedNode(node: TNode): boolean {
    assertHasNode(this, node);

    let rootNode = this.getRootNode();
    if (rootNode == null) {
      // If the graph does not have a root, and there are inbound edges,
      // this node should not be considered orphaned.
      // return false;
      for (let [, inboundNodeIds] of this.inboundEdges.get(node.id)) {
        if (inboundNodeIds.size > 0) {
          return false;
        }
      }

      return true;
    }

    // Otherwise, attempt to traverse backwards to the root. If there is a path,
    // then this is not an orphaned node.
    let hasPathToRoot = false;
    this.traverseAncestors(
      node,
      (ancestor, _, actions) => {
        if (ancestor.id === rootNode.id) {
          hasPathToRoot = true;
          actions.stop();
        }
      },
      // $FlowFixMe
      ALL_EDGE_TYPES,
    );

    if (hasPathToRoot) {
      return false;
    }

    return true;
  }

  replaceNode(
    fromNode: TNode,
    toNode: TNode,
    type: TEdgeType | null = null,
  ): void {
    assertHasNode(this, fromNode);

    this.addNode(toNode);

    for (let parent of this.inboundEdges.get(fromNode.id).get(type)) {
      this.addEdge(parent, toNode.id, type);
      this.removeEdge(parent, fromNode.id, type);
    }

    this.removeNode(fromNode);
  }

  // Update a node's downstream nodes making sure to prune any orphaned branches
  replaceNodesConnectedTo(
    fromNode: TNode,
    toNodes: Array<TNode>,
    replaceFilter?: null | (TNode => boolean),
    type?: TEdgeType | null = null,
  ): void {
    assertHasNode(this, fromNode);

    let outboundEdges = this.outboundEdges.get(fromNode.id).get(type);
    let childrenToRemove = new Set(
      replaceFilter
        ? [...outboundEdges].filter(toNodeId =>
            replaceFilter(nullthrows(this.nodes.get(toNodeId))),
          )
        : outboundEdges,
    );
    for (let toNode of toNodes) {
      this.addNode(toNode);
      childrenToRemove.delete(toNode.id);

      if (!this.hasEdge(fromNode.id, toNode.id, type)) {
        this.addEdge(fromNode.id, toNode.id, type);
      }
    }

    for (let child of childrenToRemove) {
      this.removeEdge(fromNode.id, child, type);
    }
  }

  traverse<TContext>(
    visit: GraphVisitor<TNode, TContext>,
    startNode: ?TNode,
    type: TEdgeType | null = null,
  ): ?TContext {
    return this.dfs({
      visit,
      startNode,
      getChildren: node => this.getNodesConnectedFrom(node, type),
    });
  }

  filteredTraverse<TValue, TContext>(
    filter: (TNode, TraversalActions) => ?TValue,
    visit: GraphVisitor<TValue, TContext>,
    startNode: ?TNode,
    type?: TEdgeType | null,
  ): ?TContext {
    return this.traverse(mapVisitor(filter, visit), startNode, type);
  }

  traverseAncestors<TContext>(
    startNode: TNode,
    visit: GraphVisitor<TNode, TContext>,
    type: TEdgeType | null = null,
  ) {
    return this.dfs({
      visit,
      startNode,
      getChildren: node => this.getNodesConnectedTo(node, type),
    });
  }

  dfs<TContext>({
    visit,
    startNode,
    getChildren,
  }: {|
    visit: GraphVisitor<TNode, TContext>,
    getChildren(node: TNode): Array<TNode>,
    startNode?: ?TNode,
  |}): ?TContext {
    let root = startNode ?? this.getRootNode();
    if (root == null) {
      throw new Error('A start node is required to traverse');
    }
    assertHasNode(this, root);

    let visited = new Set<TNode>();
    let stopped = false;
    let skipped = false;
    let actions: TraversalActions = {
      skipChildren() {
        skipped = true;
      },
      stop() {
        stopped = true;
      },
    };

    let walk = (node, context) => {
      visited.add(node);

      skipped = false;
      let enter = typeof visit === 'function' ? visit : visit.enter;
      if (enter) {
        let newContext = enter(node, context, actions);
        if (typeof newContext !== 'undefined') {
          context = newContext;
        }
      }

      if (skipped) {
        return;
      }

      if (stopped) {
        return context;
      }

      for (let child of getChildren(node)) {
        if (visited.has(child)) {
          continue;
        }

        visited.add(child);
        let result = walk(child, context);
        if (stopped) {
          return result;
        }
      }

      if (typeof visit !== 'function' && visit.exit) {
        let newContext = visit.exit(node, context, actions);
        if (typeof newContext !== 'undefined') {
          context = newContext;
        }
      }

      if (skipped) {
        return;
      }

      if (stopped) {
        return context;
      }
    };

    return walk(root);
  }

  bfs(visit: (node: TNode) => ?boolean): ?TNode {
    let root = this.getRootNode();
    if (!root) {
      throw new Error('A root node is required to traverse');
    }

    let queue: Array<TNode> = [root];
    let visited = new Set<TNode>([root]);

    while (queue.length > 0) {
      let node = queue.shift();
      let stop = visit(node);
      if (stop === true) {
        return node;
      }

      for (let child of this.getNodesConnectedFrom(node)) {
        if (!visited.has(child)) {
          visited.add(child);
          queue.push(child);
        }
      }
    }

    return null;
  }

  getSubGraph(node: TNode): this {
    let graph = new this.constructor();
    graph.setRootNode(node);

    let nodes = [];
    this.traverse(node => {
      nodes.push(node);
      graph.addNode(node);
    }, node);

    for (let node of nodes) {
      for (let [type, toNodes] of this.outboundEdges.get(node.id)) {
        for (let to of toNodes) {
          graph.addEdge(node.id, to, type);
        }
      }
    }

    return graph;
  }

  findAncestor(node: TNode, fn: (node: TNode) => boolean): ?TNode {
    let res = null;
    this.traverseAncestors(node, (node, ctx, traversal) => {
      if (fn(node)) {
        res = node;
        traversal.stop();
      }
    });
    return res;
  }

  findAncestors(node: TNode, fn: (node: TNode) => boolean): Array<TNode> {
    let res = [];
    this.traverseAncestors(node, (node, ctx, traversal) => {
      if (fn(node)) {
        res.push(node);
        traversal.skipChildren();
      }
    });
    return res;
  }

  findDescendant(node: TNode, fn: (node: TNode) => boolean): ?TNode {
    let res = null;
    this.traverse((node, ctx, traversal) => {
      if (fn(node)) {
        res = node;
        traversal.stop();
      }
    }, node);
    return res;
  }

  findDescendants(node: TNode, fn: (node: TNode) => boolean): Array<TNode> {
    let res = [];
    this.traverse((node, ctx, traversal) => {
      if (fn(node)) {
        res.push(node);
        traversal.skipChildren();
      }
    }, node);
    return res;
  }

  findNode(predicate: TNode => boolean): ?TNode {
    return Array.from(this.nodes.values()).find(predicate);
  }

  findNodes(predicate: TNode => boolean): Array<TNode> {
    return Array.from(this.nodes.values()).filter(predicate);
  }
}

export function mapVisitor<TNode, TValue, TContext>(
  filter: (TNode, TraversalActions) => ?TValue,
  visit: GraphVisitor<TValue, TContext>,
): GraphVisitor<TNode, TContext> {
  return {
    enter: (node, context, actions) => {
      let enter = typeof visit === 'function' ? visit : visit.enter;
      if (!enter) {
        return;
      }

      let value = filter(node, actions);
      if (value != null) {
        return enter(value, context, actions);
      }
    },
    exit: (node, context, actions) => {
      if (typeof visit === 'function') {
        return;
      }

      let exit = visit.exit;
      if (!exit) {
        return;
      }

      let value = filter(node, actions);
      if (value != null) {
        return exit(value, context, actions);
      }
    },
  };
}

function assertHasNode<TNode: Node>(graph: Graph<TNode, *>, node: TNode) {
  if (!graph.hasNode(node.id)) {
    throw new Error('Does not have node ' + node.id);
  }
}
