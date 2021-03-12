// @flow

import type {Edge, Node, NodeId} from './types';
import type {TraversalActions, GraphVisitor} from '@parcel/types';

import assert from 'assert';
import nullthrows from 'nullthrows';

export type GraphOpts<TNode, TEdgeType: string | null = null> = {|
  nodes?: Map<NodeId, TNode>,
  edges?: {|
    inboundEdges: AdjacencyListMap<TEdgeType | null>,
    outboundEdges: AdjacencyListMap<TEdgeType | null>,
  |},
  rootNodeId?: ?NodeId,
|};

export const ALL_EDGE_TYPES = '@@all_edge_types';

export default class Graph<TNode: Node, TEdgeType: string | null = null> {
  nodes: Map<NodeId, TNode>;
  inboundEdges: AdjacencyList<TEdgeType | null>;
  outboundEdges: AdjacencyList<TEdgeType | null>;
  rootNodeId: ?NodeId;

  constructor(opts: GraphOpts<TNode, TEdgeType> = ({}: any)) {
    this.nodes = opts.nodes || new Map();
    this.rootNodeId = opts.rootNodeId;

    let edges = opts.edges;
    if (edges != null) {
      this.inboundEdges = new AdjacencyList(edges.inboundEdges);
      this.outboundEdges = new AdjacencyList(edges.outboundEdges);
    } else {
      this.inboundEdges = new AdjacencyList();
      this.outboundEdges = new AdjacencyList();
    }
  }

  static deserialize(
    opts: GraphOpts<TNode, TEdgeType>,
  ): Graph<TNode, TEdgeType> {
    return new this({
      nodes: opts.nodes,
      edges: opts.edges,
      rootNodeId: opts.rootNodeId,
    });
  }

  serialize(): GraphOpts<TNode, TEdgeType> {
    return {
      nodes: this.nodes,
      edges: {
        inboundEdges: this.inboundEdges.getListMap(),
        outboundEdges: this.outboundEdges.getListMap(),
      },
      rootNodeId: this.rootNodeId,
    };
  }

  // Returns a list of all edges in the graph. This can be large, so iterating
  // the complete list can be costly in large graphs. Used when merging graphs.
  getAllEdges(): Array<Edge<TEdgeType | null>> {
    let edges = [];
    for (let [from, edgeList] of this.outboundEdges.getListMap()) {
      for (let [type, toNodes] of edgeList) {
        for (let to of toNodes) {
          edges.push({from, to, type});
        }
      }
    }
    return edges;
  }

  addNode(node: TNode): TNode {
    let existingNode = this.nodes.get(node.id);
    if (existingNode) {
      existingNode.value = node.value;
    }
    this.nodes.set(node.id, existingNode ?? node);
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

    this.outboundEdges.addEdge(from, to, type);
    this.inboundEdges.addEdge(to, from, type);
  }

  hasEdge(from: NodeId, to: NodeId, type?: TEdgeType | null = null): boolean {
    return this.outboundEdges.hasEdge(from, to, type);
  }

  getNodesConnectedTo(
    node: TNode,
    type: TEdgeType | null | Array<TEdgeType | null> = null,
  ): Array<TNode> {
    assertHasNode(this, node);

    let inboundByType = this.inboundEdges.getEdgesByType(node.id);
    if (inboundByType == null) {
      return [];
    }

    let nodes;
    if (type === ALL_EDGE_TYPES) {
      nodes = new Set();
      for (let [, typeNodes] of inboundByType) {
        for (let node of typeNodes) {
          nodes.add(node);
        }
      }
    } else if (Array.isArray(type)) {
      nodes = new Set();
      for (let typeName of type) {
        for (let node of inboundByType.get(typeName)?.values() ?? []) {
          nodes.add(node);
        }
      }
    } else {
      nodes = new Set(inboundByType.get(type)?.values() ?? []);
    }

    return [...nodes].map(to => nullthrows(this.nodes.get(to)));
  }

  getNodesConnectedFrom(
    node: TNode,
    type: TEdgeType | null | Array<TEdgeType | null> = null,
  ): Array<TNode> {
    assertHasNode(this, node);

    let outboundByType = this.outboundEdges.getEdgesByType(node.id);
    if (outboundByType == null) {
      return [];
    }

    let nodes;
    if (type === ALL_EDGE_TYPES) {
      nodes = new Set();
      for (let [, typeNodes] of outboundByType) {
        for (let node of typeNodes) {
          nodes.add(node);
        }
      }
    } else if (Array.isArray(type)) {
      nodes = new Set();
      for (let typeName of type) {
        for (let node of outboundByType.get(typeName)?.values() ?? []) {
          nodes.add(node);
        }
      }
    } else {
      nodes = new Set(outboundByType.get(type)?.values() ?? []);
    }

    return [...nodes].map(to => nullthrows(this.nodes.get(to)));
  }

  // Removes node and any edges coming from or to that node
  removeNode(node: TNode) {
    assertHasNode(this, node);

    for (let [type, nodesForType] of this.inboundEdges.getEdgesByType(
      node.id,
    )) {
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

    for (let [type, toNodes] of this.outboundEdges.getEdgesByType(node.id)) {
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

    for (let to of this.outboundEdges.getEdges(node.id, type)) {
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
    if (!this.outboundEdges.hasEdge(from, to, type)) {
      throw new Error(`Outbound edge from ${from} to ${to} not found!`);
    }

    if (!this.inboundEdges.hasEdge(to, from, type)) {
      throw new Error(`Inbound edge from ${to} to ${from} not found!`);
    }

    this.outboundEdges.removeEdge(from, to, type);
    this.inboundEdges.removeEdge(to, from, type);

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
      for (let [, inboundNodeIds] of this.inboundEdges.getEdgesByType(
        node.id,
      )) {
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

    for (let parent of this.inboundEdges.getEdges(fromNode.id, type)) {
      this.addEdge(parent, toNode.id, type);
      this.removeEdge(parent, fromNode.id, type);
    }

    this.removeNode(fromNode);
  }

  // Update a node's downstream nodes making sure to prune any orphaned branches
  replaceNodesConnectedTo(
    fromNode: TNode,
    toNodes: $ReadOnlyArray<TNode>,
    replaceFilter?: null | (TNode => boolean),
    type?: TEdgeType | null = null,
  ): void {
    assertHasNode(this, fromNode);

    let outboundEdges = this.outboundEdges.getEdges(fromNode.id, type);
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
    type: TEdgeType | null | Array<TEdgeType | null> = null,
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
    type?: TEdgeType | null | Array<TEdgeType | null>,
  ): ?TContext {
    return this.traverse(mapVisitor(filter, visit), startNode, type);
  }

  traverseAncestors<TContext>(
    startNode: TNode,
    visit: GraphVisitor<TNode, TContext>,
    type: TEdgeType | null | Array<TEdgeType | null> = null,
  ): ?TContext {
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
      if (!this.hasNode(node.id)) return;
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
      for (let [type, toNodes] of this.outboundEdges.getEdgesByType(node.id)) {
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

type AdjacencyListMap<TEdgeType> = Map<NodeId, Map<TEdgeType, Set<NodeId>>>;
class AdjacencyList<TEdgeType> {
  _listMap: AdjacencyListMap<TEdgeType>;

  constructor(listMap?: AdjacencyListMap<TEdgeType>) {
    this._listMap = listMap ?? new Map();
  }

  getListMap(): AdjacencyListMap<TEdgeType> {
    return this._listMap;
  }

  getEdges(from: NodeId, type: TEdgeType): $ReadOnlySet<NodeId> {
    return this._listMap.get(from)?.get(type) ?? new Set();
  }

  getEdgesByType(from: NodeId): $ReadOnlyMap<TEdgeType, $ReadOnlySet<NodeId>> {
    return this._listMap.get(from) ?? new Map();
  }

  hasEdge(from: NodeId, to: NodeId, type: TEdgeType): boolean {
    return Boolean(
      this._listMap
        .get(from)
        ?.get(type)
        ?.has(to),
    );
  }

  addEdge(from: NodeId, to: NodeId, type: TEdgeType): void {
    let types = this._listMap.get(from);
    if (types == null) {
      types = new Map<TEdgeType, Set<NodeId>>();
      this._listMap.set(from, types);
    }

    let adjacent = types.get(type);
    if (adjacent == null) {
      adjacent = new Set<NodeId>();
      types.set(type, adjacent);
    }
    adjacent.add(to);
  }

  removeEdge(from: NodeId, to: NodeId, type: TEdgeType): void {
    this._listMap
      .get(from)
      ?.get(type)
      ?.delete(to);
  }
}
