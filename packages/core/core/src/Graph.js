// @flow
'use strict';

export type NodeId = string;

export type Edge = {
  from: NodeId,
  to: NodeId
};

export interface Node {
  id: string;
  type?: string;
  value: any;
}

type GraphUpdates = {
  added: Graph,
  removed: Graph
};

export default class Graph {
  nodes: Map<NodeId, Node>;
  edges: Set<Edge>;
  rootNodeId: ?NodeId;

  constructor() {
    this.nodes = new Map();
    this.edges = new Set();
    this.rootNodeId = null;
  }

  addNode(node: Node) {
    this.nodes.set(node.id, node);
    return node;
  }

  hasNode(id: string) {
    return this.nodes.has(id);
  }

  getNode(id: string) {
    return this.nodes.get(id);
  }

  setRootNode(node: Node) {
    this.addNode(node);
    this.rootNodeId = node.id;
  }

  getRootNode(): ?Node {
    return this.rootNodeId ? this.getNode(this.rootNodeId) : null;
  }

  addEdge(edge: Edge) {
    this.edges.add(edge);
    return edge;
  }

  hasEdge(edge: Edge) {
    for (let e of this.edges) {
      if (edge.from == e.from && edge.to === e.to) {
        return true;
      }
    }

    return false;
  }

  getNodesConnectedTo(node: Node): Array<Node> {
    let edges = Array.from(this.edges).filter(edge => edge.to === node.id);
    return edges.map(edge => this.nodes.get(edge.from));
  }

  getNodesConnectedFrom(node: Node): Array<Node> {
    let edges = Array.from(this.edges).filter(edge => edge.from === node.id);
    return edges.map(edge => this.nodes.get(edge.to));
  }

  merge(graph: Graph) {
    for (let [, node] of graph.nodes) {
      this.addNode(node);
    }

    for (let edge of graph.edges) {
      this.addEdge(edge);
    }
  }

  // Removes node and any edges coming from that node
  removeNode(node: Node): Graph {
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

  removeEdges(node: Node): Graph {
    let removed = new this.constructor();

    for (let edge of this.edges) {
      if (edge.from === node.id) {
        removed.merge(this.removeEdge(edge));
      }
    }

    return removed;
  }

  // Removes edge and node the edge is to if the node is orphaned
  removeEdge(edge: Edge): Graph {
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

  isOrphanedNode(node: Node) {
    for (let edge of this.edges) {
      if (edge.to === node.id) {
        return false;
      }
    }
    return true;
  }

  replaceNode(fromNode: Node, toNode: Node) {
    this.addNode(toNode);

    for (let edge of this.edges) {
      if (edge.from === fromNode.id) {
        edge.from = toNode.id;
      }

      if (edge.to === fromNode.id) {
        edge.to = toNode.id;
      }
    }

    this.removeNode(fromNode);
  }

  // Update a node's downstream nodes making sure to prune any orphaned branches
  // Also keeps track of all added and removed edges and nodes
  replaceNodesConnectedTo(fromNode: Node, toNodes: Array<Node>): GraphUpdates {
    let removed = new this.constructor();
    let added = new this.constructor();

    let edgesBefore = Array.from(this.edges).filter(
      edge => edge.from === fromNode.id
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

  traverse(visit: (node: Node, context?: any) => any, startNode?: Node) {
    return this.dfs({
      visit,
      startNode,
      getChildren: this.getNodesConnectedFrom.bind(this)
    });
  }

  traverseAncestors(
    startNode: Node,
    visit: (node: Node, context?: any) => any
  ) {
    return this.dfs({
      visit,
      startNode,
      getChildren: this.getNodesConnectedTo.bind(this)
    });
  }

  dfs({
    visit,
    startNode,
    getChildren
  }: {
    visit(node: Node, context?: any): any,
    getChildren(node: Node): Array<Node>,
    startNode?: Node
  }): ?Node {
    let root = startNode || this.getRootNode();
    if (!root) {
      return null;
    }

    let visited = new Set<Node>();

    let walk = (node, context) => {
      visited.add(node);

      let newContext = visit(node, context);
      if (typeof newContext !== 'undefined') {
        context = newContext;
      }

      for (let child of getChildren(node)) {
        if (visited.has(child)) {
          continue;
        }

        visited.add(child);
        let result = walk(child, context);
        if (result) {
          return result;
        }
      }
    };

    return walk(root);
  }

  bfs(visit: (node: Node) => ?boolean): ?Node {
    let root = this.getRootNode();
    if (!root) {
      return null;
    }

    let queue: Array<Node> = [root];
    let visited = new Set<Node>([root]);

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

  getSubGraph(node: Node): Graph {
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
}
