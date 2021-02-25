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
  nextNodeId: number = 0;

  constructor(opts: GraphOpts<TNode, TEdgeType> = ({}: any)) {
    this.nodes = opts.nodes || new Map();
    this.rootNodeId = opts.rootNodeId;

    if (opts.edges) {
      this.inboundEdges = new AdjacencyList(opts.edges.inboundEdges);
      this.outboundEdges = new AdjacencyList(opts.edges.outboundEdges);
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

  // ## Possible new API Proposal
  // * createId in addNode instead of using user generated id
  // * addNode2 should ultimately only accept the value rather than TNode
  // * we want to make sure nodeId is opaque

  addNode2(node: TNode): NodeId {
    let id = String(this.nextNodeId++);
    this.nodes.set(id, node);
    return id;
  }

  hasNode(id: NodeId): boolean {
    return this.nodes.has(id);
  }

  getNode(id: NodeId): ?TNode {
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
      nodes = inboundByType.get(type)?.values() ?? [];
    }

    return [...nodes].map(to => nullthrows(this.nodes.get(to)));
  }

  getNodeIdsConnectedTo(
    nodeId: NodeId,
    type: TEdgeType | null | Array<TEdgeType | null> = null,
  ): Array<NodeId> {
    this._assertHasNodeId(nodeId);

    let inboundByType = this.inboundEdges.getEdgesByType(nodeId);
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
      nodes = inboundByType.get(type)?.values() ?? [];
    }

    return [...nodes];
  }

  getNodesConnectedFrom(
    node: TNode | NodeId,
    type: TEdgeType | null | Array<TEdgeType | null> = null,
  ): Array<TNode> {
    // assertHasNode(this, node);
    let nodeId = typeof node === 'string' ? node : node.id;
    let outboundByType = this.outboundEdges.getEdgesByType(nodeId);
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
      nodes = outboundByType.get(type)?.values() ?? [];
    }

    return [...nodes].map(to => nullthrows(this.nodes.get(to)));
  }

  getNodeIdsConnectedFrom(
    nodeId: NodeId,
    type: TEdgeType | null | Array<TEdgeType | null> = null,
  ): Array<NodeId> {
    this._assertHasNodeId(nodeId);
    let outboundByType = this.outboundEdges.getEdgesByType(nodeId);
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
      nodes = outboundByType.get(type)?.values() ?? [];
    }

    return [...nodes];
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

    if (removeOrphans && this._isOrphanedNode(to)) {
      this.removeById(to);
    }
  }

  _isOrphanedNode(nodeId: NodeId): boolean {
    this._assertHasNodeId(nodeId);

    let rootNode = this.getRootNode();
    if (rootNode == null) {
      // If the graph does not have a root, and there are inbound edges,
      // this node should not be considered orphaned.
      // return false;
      for (let [, inboundNodeIds] of this.inboundEdges.getEdgesByType(nodeId)) {
        if (inboundNodeIds.size > 0) {
          return false;
        }
      }

      return true;
    }

    // Otherwise, attempt to traverse backwards to the root. If there is a path,
    // then this is not an orphaned node.
    let hasPathToRoot = false;
    // go back to traverseAncestors
    this.traverseAncestors(
      nodeId,
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

  // Update a node's downstream nodes making sure to prune any orphaned branches
  replaceNodeIdsConnectedTo(
    fromNodeId: NodeId,
    toNodeIds: $ReadOnlyArray<NodeId>,
    replaceFilter?: null | (NodeId => boolean),
    type?: TEdgeType | null = null,
  ): void {
    this._assertHasNodeId(fromNodeId);

    let outboundEdges = this.outboundEdges.getEdges(fromNodeId, type);
    let childrenToRemove = new Set(
      replaceFilter
        ? [...outboundEdges].filter(toNodeId => replaceFilter(toNodeId))
        : outboundEdges,
    );
    for (let toNodeId of toNodeIds) {
      childrenToRemove.delete(toNodeId);

      if (!this.hasEdge(fromNodeId, toNodeId, type)) {
        this.addEdge(fromNodeId, toNodeId, type);
      }
    }

    for (let child of childrenToRemove) {
      this.removeEdge(fromNodeId, child, type);
    }
  }

  traverse<TContext>(
    visit: GraphVisitor<TNode, TContext>,
    startNode: ?(TNode | NodeId),
    type: TEdgeType | null | Array<TEdgeType | null> = null,
  ): ?TContext {
    return this.dfs({
      visit,
      startNode,
      getChildren: node => this.getNodeIdsConnectedFrom(node, type),
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
    startNode: ?(TNode | NodeId),
    visit: GraphVisitor<TNode, TContext>,
    type: TEdgeType | null | Array<TEdgeType | null> = null,
  ): ?TContext {
    return this.dfs({
      visit,
      startNode,
      getChildren: node => this.getNodeIdsConnectedTo(node, type),
    });
  }

  dfs<TContext>({
    visit,
    startNode,
    getChildren,
  }: {|
    visit: GraphVisitor<TNode, TContext>,
    getChildren(nodeId: NodeId): Array<NodeId>,
    startNode?: ?(TNode | NodeId),
  |}): ?TContext {
    let startNodeId;
    if (startNode == null) {
      startNodeId = this.rootNodeId;
    } else if (typeof startNode === 'string') {
      startNodeId = startNode;
    } else {
      startNodeId = startNode.id;
    }
    //let root = startNodeId ?? this.getRootNode();
    if (startNodeId == null) {
      throw new Error('A start node is required to traverse');
    }
    // assertHasNode(this, root);

    let visited = new Set<NodeId>();
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

    let walk = (nodeId, context) => {
      let node = nullthrows(this.nodes.get(nodeId));
      // if (!this.hasNode(node.id)) return;
      visited.add(nodeId);

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

      for (let child of getChildren(nodeId)) {
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

    return walk(startNodeId);
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

  // getSubGraph(node: TNode): this {
  //   let graph = new this.constructor();
  //   graph.setRootNode(node);

  //   let nodes = [];
  //   this.traverse(node => {
  //     nodes.push(node);
  //     graph.addNode(node);
  //   }, node);

  //   for (let node of nodes) {
  //     for (let [type, toNodes] of this.outboundEdges.getEdgesByType(node.id)) {
  //       for (let to of toNodes) {
  //         graph.addEdge(node.id, to, type);
  //       }
  //     }
  //   }

  //   return graph;
  // }

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

  _assertHasNodeId(nodeId: NodeId) {
    if (!this.hasNode(nodeId)) {
      throw new Error('Does not have node ' + nodeId);
    }
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
