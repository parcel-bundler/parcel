// @flow

import type {Edge, Node, NodeId} from './types';
import type {TraversalActions, GraphVisitor} from '@parcel/types';
import nullthrows from 'nullthrows';
import {DefaultMap} from '@parcel/utils';

export type GraphOpts<TNode> = {|
  nodes?: Array<[NodeId, TNode]>,
  edges?: Array<Edge>,
  rootNodeId?: ?NodeId
|};

type GraphUpdates<TNode> = {|
  added: Graph<TNode>,
  removed: Graph<TNode>
|};

type AdjacencyList = DefaultMap<NodeId, Map<NodeId, Edge>>;

export default class Graph<TNode: Node> {
  nodes: Map<NodeId, TNode>;
  inboundEdges: AdjacencyList;
  outboundEdges: AdjacencyList;
  rootNodeId: ?NodeId;

  constructor(
    opts: GraphOpts<TNode> = {nodes: [], edges: [], rootNodeId: null}
  ) {
    this.nodes = new Map(opts.nodes);
    this.rootNodeId = opts.rootNodeId;

    let {inboundEdges, outboundEdges} = edgeListToAdjacencyLists(opts.edges);
    this.inboundEdges = inboundEdges;
    this.outboundEdges = outboundEdges;
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
    return edgeListFromAdjacencyList(this.outboundEdges);
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

  addEdge(edge: Edge): Edge {
    let outEdges = this.outboundEdges.get(edge.from);
    outEdges.set(edge.to, edge);

    let inEdges = this.inboundEdges.get(edge.to);
    inEdges.set(edge.from, edge);

    return edge;
  }

  hasEdge(edge: Edge): boolean {
    return this.outboundEdges.get(edge.from).has(edge.to);
  }

  getNodesConnectedTo(node: TNode): Array<TNode> {
    return Array.from(this.inboundEdges.get(node.id).values()).map(edge =>
      nullthrows(this.nodes.get(edge.from))
    );
  }

  getNodesConnectedFrom(node: TNode): Array<TNode> {
    return Array.from(this.outboundEdges.get(node.id).values()).map(edge =>
      nullthrows(this.nodes.get(edge.to))
    );
  }

  merge(graph: Graph<TNode>): void {
    for (let [, node] of graph.nodes) {
      this.addNode(node);
    }

    for (let edge of graph.getAllEdges()) {
      this.addEdge(edge);
    }
  }

  // Removes node and any edges coming from or to that node
  removeNode(node: TNode): this {
    let removed = new this.constructor();

    this.nodes.delete(node.id);
    removed.addNode(node);

    for (let [, edge] of this.outboundEdges.get(node.id)) {
      removed.merge(this.removeEdge(edge));
    }

    for (let [, edge] of this.inboundEdges.get(node.id)) {
      removed.merge(this.removeEdge(edge));
    }

    return removed;
  }

  removeEdges(node: TNode): this {
    let removed = new this.constructor();

    for (let [, edge] of this.outboundEdges.get(node.id)) {
      removed.merge(this.removeEdge(edge));
    }

    return removed;
  }

  // Removes edge and node the edge is to if the node is orphaned
  removeEdge(edge: Edge): this {
    let removed = new this.constructor();

    this.outboundEdges.get(edge.from).delete(edge.to);
    this.inboundEdges.get(edge.to).delete(edge.from);
    removed.addEdge(edge);

    let connectedNode = nullthrows(this.nodes.get(edge.to));
    if (this.isOrphanedNode(connectedNode)) {
      removed.merge(this.removeNode(connectedNode));
    }

    return removed;
  }

  isOrphanedNode(node: TNode): boolean {
    return this.inboundEdges.get(node.id).size === 0;
  }

  replaceNode(fromNode: TNode, toNode: TNode): void {
    this.addNode(toNode);

    for (let [, edge] of this.inboundEdges.get(fromNode.id)) {
      this.addEdge({...edge, to: toNode.id});
      this.removeEdge(edge);
    }

    this.removeNode(fromNode);
  }

  // Update a node's downstream nodes making sure to prune any orphaned branches
  // Also keeps track of all added and removed edges and nodes
  replaceNodesConnectedTo(
    fromNode: TNode,
    toNodes: Array<TNode>
  ): GraphUpdates<TNode> {
    let removed = new this.constructor();
    let added = new this.constructor();

    let edgesBefore = [];
    for (let [, edge] of this.outboundEdges.get(fromNode.id)) {
      edgesBefore.push(edge);
    }

    let edgesToRemove = edgesBefore;

    for (let toNode of toNodes) {
      let existingNode = this.getNode(toNode.id);
      if (!existingNode) {
        this.addNode(toNode);
        added.addNode(toNode);
      } else {
        existingNode.value = toNode.value;
      }

      edgesToRemove = edgesToRemove.filter(edge => edge.to !== toNode.id);

      let edge = {from: fromNode.id, to: toNode.id};
      if (!this.hasEdge(edge)) {
        this.addEdge(edge);
        added.addEdge(edge);
      }
    }

    for (let edge of edgesToRemove) {
      removed.merge(this.removeEdge(edge));
    }

    return {removed, added};
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
          let fn = visit.enter || visit;
          let value = filter(node);
          if (value != null && typeof fn === 'function') {
            return fn(value, ...args);
          }
        },
        exit: (node, ...args) => {
          let value = filter(node);
          if (value != null && typeof visit.exit === 'function') {
            return visit.exit(value, ...args);
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

      if (visit.exit) {
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

      for (let [, edge] of this.outboundEdges.get(node.id)) {
        graph.addEdge(edge);
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

function edgeListToAdjacencyLists(
  edgeList: Array<Edge> = []
): {inboundEdges: AdjacencyList, outboundEdges: AdjacencyList} {
  let inboundEdges: AdjacencyList = new DefaultMap(() => new Map());
  let outboundEdges: AdjacencyList = new DefaultMap(() => new Map());
  for (let edge of edgeList) {
    let outEdges = outboundEdges.get(edge.from);
    if (outEdges.has(edge.to)) {
      throw new Error(`Graph already has edge from ${edge.from} to ${edge.to}`);
    }
    outEdges.set(edge.to, edge);

    let inEdges = inboundEdges.get(edge.to);
    if (inEdges.has(edge.from)) {
      throw new Error(`Graph already has edge from ${edge.from} to ${edge.to}`);
    }
    inEdges.set(edge.from, edge);
  }
  return {inboundEdges, outboundEdges};
}

function edgeListFromAdjacencyList(adjacencyList: AdjacencyList): Array<Edge> {
  let edges = [];
  for (let [, edgeList] of adjacencyList) {
    for (let [, edge] of edgeList) {
      edges.push(edge);
    }
  }
  return edges;
}
