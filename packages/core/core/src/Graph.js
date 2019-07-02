// @flow

import type {Edge, Node, NodeId} from './types';
import type {TraversalActions, GraphVisitor} from '@parcel/types';

import {DefaultMap} from '@parcel/utils';
import nullthrows from 'nullthrows';

export type GraphOpts<TNode> = {|
  nodes?: Array<[NodeId, TNode]>,
  edges?: Array<Edge>,
  rootNodeId?: ?NodeId
|};

type AdjacencyList = DefaultMap<NodeId, Set<NodeId>>;

export default class Graph<TNode: Node> {
  nodes: Map<NodeId, TNode>;
  inboundEdges: AdjacencyList = new DefaultMap(() => new Set());
  outboundEdges: AdjacencyList = new DefaultMap(() => new Set());
  rootNodeId: ?NodeId;

  constructor(
    opts: GraphOpts<TNode> = {nodes: [], edges: [], rootNodeId: null}
  ) {
    this.nodes = new Map(opts.nodes);
    this.rootNodeId = opts.rootNodeId;

    if (opts.edges) {
      for (let edge of opts.edges) {
        this.addEdge(edge.from, edge.to);
      }
    }
  }

  serialize(): GraphOpts<TNode> {
    return {
      nodes: [...this.nodes],
      edges: this.getAllEdges(),
      rootNodeId: this.rootNodeId
    };
  }

  // Returns a list of all edges in the graph. This can be large, so iterating
  // the complete list can be costly in large graphs. Used in serialization and
  // copying of graphs.
  getAllEdges(): Array<Edge> {
    let edges = [];
    for (let [from, edgeList] of this.outboundEdges) {
      for (let to of edgeList) {
        edges.push({from, to});
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

  addEdge(from: NodeId, to: NodeId): void {
    this.outboundEdges.get(from).add(to);
    this.inboundEdges.get(to).add(from);
  }

  hasEdge(from: NodeId, to: NodeId): boolean {
    return this.outboundEdges.get(from).has(to);
  }

  ensureConnection(fromNode: TNode, toNode: TNode) {
    if (!this.hasNode(fromNode.id)) {
      this.addNode(fromNode);
    }

    if (!this.hasNode(toNode.id)) {
      this.addNode(toNode);
    }

    if (!this.hasEdge(fromNode.id, toNode.id)) {
      this.addEdge(fromNode.id, toNode.id);
    }
  }

  getNodesConnectedTo(node: TNode): Array<TNode> {
    return Array.from(this.inboundEdges.get(node.id).values()).map(from =>
      nullthrows(this.nodes.get(from))
    );
  }

  getNodesConnectedFrom(node: TNode): Array<TNode> {
    return Array.from(this.outboundEdges.get(node.id).values()).map(to =>
      nullthrows(this.nodes.get(to))
    );
  }

  merge(graph: Graph<TNode>): void {
    for (let [, node] of graph.nodes) {
      this.addNode(node);
    }

    for (let edge of graph.getAllEdges()) {
      this.addEdge(edge.from, edge.to);
    }
  }

  // Removes node and any edges coming from or to that node
  removeNode(node: TNode) {
    for (let from of this.inboundEdges.get(node.id)) {
      this.removeEdge(from, node.id);
    }

    for (let to of this.outboundEdges.get(node.id)) {
      this.removeEdge(node.id, to);
    }

    this.nodes.delete(node.id);
  }

  removeById(id: NodeId) {
    let node = nullthrows(this.getNode(id));
    this.removeNode(node);
  }

  removeEdges(node: TNode) {
    for (let to of this.outboundEdges.get(node.id)) {
      this.removeEdge(node.id, to);
    }
  }

  // Removes edge and node the edge is to if the node is orphaned
  removeEdge(from: NodeId, to: NodeId) {
    this.outboundEdges.get(from).delete(to);
    this.inboundEdges.get(to).delete(from);

    let connectedNode = nullthrows(this.nodes.get(to));
    if (this.isOrphanedNode(connectedNode)) {
      this.removeNode(connectedNode);
    }
  }

  isOrphanedNode(node: TNode): boolean {
    return this.inboundEdges.get(node.id).size === 0;
  }

  replaceNode(fromNode: TNode, toNode: TNode): void {
    this.addNode(toNode);

    for (let parent of this.inboundEdges.get(fromNode.id)) {
      this.addEdge(parent, toNode.id);
      this.removeEdge(parent, fromNode.id);
    }

    this.removeNode(fromNode);
  }

  // Update a node's downstream nodes making sure to prune any orphaned branches
  // Also keeps track of all added and removed edges and nodes
  replaceNodesConnectedTo(
    fromNode: TNode,
    toNodes: Array<TNode>,
    replaceFilter?: Function
  ): void {
    let outboundEdges = this.outboundEdges.get(fromNode.id);
    let childrenToRemove = new Set(
      replaceFilter
        ? [...outboundEdges].filter(toNodeId =>
            replaceFilter(nullthrows(this.nodes.get(toNodeId)))
          )
        : outboundEdges
    );
    for (let toNode of toNodes) {
      let existingNode = this.getNode(toNode.id);
      if (!existingNode) {
        this.addNode(toNode);
      } else {
        existingNode.value = toNode.value;
      }

      childrenToRemove.delete(toNode.id);

      if (!this.hasEdge(fromNode.id, toNode.id)) {
        this.addEdge(fromNode.id, toNode.id);
      }
    }

    for (let child of childrenToRemove) {
      this.removeEdge(fromNode.id, child);
    }
  }

  traverse<TContext>(visit: GraphVisitor<TNode, TContext>, startNode: ?TNode) {
    return this.dfs({
      // $FlowFixMe
      visit,
      startNode,
      getChildren: this.getNodesConnectedFrom.bind(this)
    });
  }

  filteredTraverse<TValue, TContext>(
    filter: TNode => ?TValue,
    visit: GraphVisitor<TValue, TContext>,
    startNode: ?TNode
  ): ?TContext {
    return this.traverse<TContext>(
      {
        enter: (node, ...args) => {
          let enter = typeof visit === 'function' ? visit : visit.enter;
          if (!enter) {
            return;
          }

          let value = filter(node);
          if (value != null) {
            return enter(value, ...args);
          }
        },
        exit: (node, ...args) => {
          if (typeof visit === 'function') {
            return;
          }

          let exit = visit.exit;
          if (!exit) {
            return;
          }

          let value = filter(node);
          if (value != null) {
            return exit(value, ...args);
          }
        }
      },
      startNode
    );
  }

  traverseAncestors<TContext>(
    startNode: TNode,
    visit: GraphVisitor<TNode, TContext>
  ) {
    return this.dfs({
      visit,
      startNode,
      getChildren: this.getNodesConnectedTo.bind(this)
    });
  }

  dfs<TContext>({
    visit,
    startNode,
    getChildren
  }: {
    visit: GraphVisitor<TNode, TContext>,
    getChildren(node: TNode): Array<TNode>,
    startNode?: ?TNode
  }): ?TContext {
    let root = startNode || this.getRootNode();
    if (!root) {
      return null;
    }

    let visited = new Set<TNode>();
    let stopped = false;
    let skipped = false;
    let actions: TraversalActions = {
      skipChildren() {
        skipped = true;
      },
      stop() {
        stopped = true;
      }
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
      return null;
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

    this.traverse(node => {
      graph.addNode(node);

      for (let to of this.outboundEdges.get(node.id)) {
        graph.addEdge(node.id, to);
      }
    }, node);

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
