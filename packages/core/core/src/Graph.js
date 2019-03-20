// @flow

import type {Edge, Node, NodeId} from './types';

import type {GraphTraversalCallback, TraversalActions} from '@parcel/types';

import nullthrows from 'nullthrows';

type GraphOpts<TNode> = {|
  nodes?: Array<[NodeId, TNode]>,
  edges?: Array<Edge>,
  rootNodeId?: ?NodeId
|};

type GraphUpdates<TNode> = {|
  added: Graph<TNode>,
  removed: Graph<TNode>
|};

export default class Graph<TNode: Node> {
  nodes: Map<NodeId, TNode>;
  edges: Set<Edge>;
  rootNodeId: ?NodeId;

  constructor(
    opts: GraphOpts<TNode> = {nodes: [], edges: [], rootNodeId: null}
  ) {
    this.nodes = new Map(opts.nodes);
    this.edges = new Set(opts.edges);
    this.rootNodeId = opts.rootNodeId;
  }

  serialize(): GraphOpts<TNode> {
    return {
      nodes: [...this.nodes],
      edges: [...this.edges],
      rootNodeId: this.rootNodeId
    };
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
    this.edges.add(edge);
    return edge;
  }

  hasEdge(edge: Edge): boolean {
    for (let e of this.edges) {
      if (edge.from == e.from && edge.to === e.to && edge.type === e.type) {
        return true;
      }
    }

    return false;
  }

  getNodesConnectedTo(node: TNode, edgeType?: string): Array<TNode> {
    let edges = Array.from(this.edges).filter(
      edge => edge.to === node.id && edge.type === edgeType
    );
    return edges.map(edge => nullthrows(this.nodes.get(edge.from)));
  }

  getNodesConnectedFrom(node: TNode, edgeType?: string): Array<TNode> {
    let edges = Array.from(this.edges).filter(
      edge => edge.from === node.id && edge.type === edgeType
    );
    return edges.map(edge => nullthrows(this.nodes.get(edge.to)));
  }

  merge(graph: Graph<TNode>): void {
    for (let [, node] of graph.nodes) {
      this.addNode(node);
    }

    for (let edge of graph.edges) {
      this.addEdge(edge);
    }
  }

  // Removes node and any edges coming from that node
  removeNode(node: TNode): this {
    let removed = new this.constructor();

    this.nodes.delete(node.id);
    removed.addNode(node);

    for (let edge of this.edges) {
      if (edge.from === node.id || edge.to === node.id) {
        removed.merge(this.removeEdge(edge));
      }
    }

    return removed;
  }

  removeEdges(node: TNode): this {
    let removed = new this.constructor();

    for (let edge of this.edges) {
      if (edge.from === node.id) {
        removed.merge(this.removeEdge(edge));
      }
    }

    return removed;
  }

  // Removes edge and node the edge is to if the node is orphaned
  removeEdge(edge: Edge): this {
    let removed = new this.constructor();

    this.edges.delete(edge);
    removed.addEdge(edge);

    for (let [id, node] of this.nodes) {
      if (edge.to === id) {
        if (this.isOrphanedNode(node)) {
          removed.merge(this.removeNode(node));
        }
      }
    }

    return removed;
  }

  isOrphanedNode(node: TNode): boolean {
    for (let edge of this.edges) {
      if (edge.to === node.id) {
        return false;
      }
    }
    return true;
  }

  replaceNode(fromNode: TNode, toNode: TNode): void {
    this.addNode(toNode);

    for (let edge of this.edges) {
      if (edge.to === fromNode.id) {
        this.addEdge({from: edge.from, to: toNode.id});
        this.edges.delete(edge);
      }
    }

    this.removeNode(fromNode);
  }

  // Update a node's downstream nodes making sure to prune any orphaned branches
  // Also keeps track of all added and removed edges and nodes
  replaceNodesConnectedTo(
    fromNode: TNode,
    toNodes: Array<TNode>,
    edgeType: string
  ): GraphUpdates<TNode> {
    let removed = new this.constructor();
    let added = new this.constructor();

    let edgesBefore = Array.from(this.edges).filter(
      edge => edge.from === fromNode.id && edge.type === edgeType
    );
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

      let edge = {from: fromNode.id, to: toNode.id, type: edgeType};
      if (!this.hasEdge(edge)) {
        this.addEdge(edge);
        added.addEdge(edge);
      }
    }

    for (let edge of edgesToRemove) {
      if (edgeType && edge.type === edgeType) {
        removed.merge(this.removeEdge(edge));
      }
    }

    return {removed, added};
  }

  traverse<TContext>(
    visit: GraphTraversalCallback<TNode, TContext>,
    startNode: ?TNode
  ): ?TContext {
    return this.dfs({
      visit,
      startNode,
      getChildren: this.getNodesConnectedFrom.bind(this)
    });
  }

  traverseAncestors<TContext>(
    startNode: TNode,
    visit: GraphTraversalCallback<TNode, TContext>
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
    visit: GraphTraversalCallback<TNode, TContext>,
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
      let newContext = visit(node, context, actions);
      if (typeof newContext !== 'undefined') {
        context = newContext;
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

      let edges = Array.from(this.edges).filter(edge => edge.from === node.id);
      for (let edge of edges) {
        graph.addEdge(edge);
      }
    }, node);

    return graph;
  }

  findNodes(predicate: TNode => boolean): Array<TNode> {
    return Array.from(this.nodes.values()).filter(predicate);
  }
}
