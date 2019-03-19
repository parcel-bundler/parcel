// @flow
import Graph from './Graph';
import type {
  Graph as IGraph,
  AssetGraph as IAssetGraph,
  MutableAssetGraph as IMutableAssetGraph,
  AssetGraphNode,
  Dependency,
  Asset,
  GraphTraversalCallback,
  Bundle,
  TransformerRequest,
  Node
} from '@parcel/types';

export class BaseGraph<T: Node> implements IGraph<T> {
  #graph;

  constructor(graph: Graph<T>) {
    this.#graph = graph;
  }

  traverse(visit: GraphTraversalCallback<T>): any {
    return this.#graph.traverse(visit);
  }

  hasNode(id: string): boolean {
    return this.#graph.hasNode(id);
  }

  getNode(id: string): ?T {
    return this.#graph.getNode(id);
  }

  findNodes(callback: (node: T) => boolean): Array<T> {
    return this.#graph.findNodes(callback);
  }
}

export class AssetGraph extends BaseGraph<AssetGraphNode>
  implements IAssetGraph {
  #graph;

  constructor(graph: Graph<AssetGraphNode>) {
    super(graph);
    this.#graph = graph;
  }

  // static deserialize(opts) {
  //   return new AssetGraph(new Graph(opts));
  // }

  serialize() {
    return this.#graph;
  }

  traverseAssets(
    visit: GraphTraversalCallback<Asset>,
    startNode: ?AssetGraphNode
  ) {
    return this.#graph.traverse((node, ...args) => {
      if (node.type === 'asset') {
        return visit(node.value, ...args);
      }
    }, startNode);
  }

  getDependencies(asset: Asset): Array<Dependency> {
    let node = this.#graph.getNode(asset.id);
    if (!node) {
      return [];
    }

    return this.#graph
      .getNodesConnectedFrom(node)
      .map(node => (node.value: any));
  }

  getDependencyResolution(dep: Dependency): ?Asset {
    let depNode = this.#graph.getNode(dep.id);
    if (!depNode || depNode.type !== 'dependency') {
      return null;
    }

    let res = null;
    this.#graph.traverse((node, ctx, traversal) => {
      if (node.type === 'asset' || node.type === 'asset_reference') {
        res = node.value;
        traversal.stop();
      }
    }, depNode);

    return res;
  }

  createBundle(asset: Asset): Bundle {
    let assetNode = this.#graph.getNode(asset.id);
    if (!assetNode || assetNode.type !== 'asset') {
      throw new Error('Cannot get bundle for non-existant asset');
    }

    let graph = this.#graph.getSubGraph(assetNode);
    graph.setRootNode({
      type: 'root',
      id: 'root',
      value: 'root'
    });

    graph.addEdge({from: 'root', to: assetNode.id});
    return {
      id: 'bundle:' + asset.id,
      type: asset.type,
      assetGraph: new MutableAssetGraph(graph),
      env: asset.env,
      filePath: '',
      stats: {
        size: 0,
        time: 0
      }
    };
  }

  getTotalSize(asset?: Asset): number {
    let size = 0;
    let assetNode = asset ? this.#graph.getNode(asset.id) : null;
    this.traverseAssets(asset => {
      size += asset.stats.size;
    }, assetNode);

    return size;
  }

  getEntryAssets(): Array<Asset> {
    let entries = [];
    this.traverseAssets((asset, ctx, traversal) => {
      entries.push(asset);
      traversal.skipChildren();
    });

    return entries;
  }
}

export class MutableAssetGraph extends AssetGraph
  implements IMutableAssetGraph {
  #graph;

  constructor(graph: Graph<AssetGraphNode>) {
    super(graph);
    this.#graph = graph;
  }

  async addAsset(parentNode: AssetGraphNode, req: TransformerRequest) {}

  removeAsset(asset: Asset) {
    let assetNode = this.#graph.getNode(asset.id);
    if (!assetNode || assetNode.type !== 'asset') {
      return;
    }

    this.#graph.replaceNode(assetNode, {
      type: 'asset_reference',
      id: 'asset_reference:' + assetNode.id,
      value: asset
    });
  }

  merge(graph: IAssetGraph): void {
    this.#graph.merge(graph);
  }

  freeze() {
    return new AssetGraph(this.#graph);
  }
}
