// @flow strict-local

import type AssetGraph from '../AssetGraph';
import type {
  Asset,
  Dependency as IDependency,
  GraphTraversalCallback,
  MainAssetGraph as IMainAssetGraph,
  MainAssetGraphTraversable
} from '@parcel/types';

import {MutableBundle} from './Bundle';

export default class MainAssetGraph implements IMainAssetGraph {
  #graph; // AssetGraph

  constructor(graph: AssetGraph) {
    this.#graph = graph;
  }

  createBundle(asset: Asset): MutableBundle {
    let assetNode = this.#graph.getNode(asset.id);
    if (!assetNode) {
      throw new Error('Cannot get bundle for non-existant asset');
    }

    let graph = this.#graph.getSubGraph(assetNode);
    graph.setRootNode({
      type: 'root',
      id: 'root',
      value: null
    });

    graph.addEdge({
      from: 'root',
      to: assetNode.id
    });
    return new MutableBundle({
      id: 'bundle:' + asset.id,
      filePath: null,
      isEntry: null,
      target: null,
      type: asset.type,
      assetGraph: graph,
      env: asset.env,
      stats: {size: 0, time: 0}
    });
  }

  getDependencyResolution(dep: IDependency): ?Asset {
    return this.#graph.getDependencyResolution(dep);
  }

  traverse<TContext>(
    visit: GraphTraversalCallback<MainAssetGraphTraversable, TContext>
  ): ?TContext {
    return this.#graph.traverse((node, ...args) => {
      if (node.type === 'asset') {
        return visit({type: 'asset', value: node.value}, ...args);
      } else if (node.type === 'dependency') {
        return visit({type: 'dependency', value: node.value}, ...args);
      }
    });
  }

  traverseAssets<TContext>(
    visit: GraphTraversalCallback<Asset, TContext>
  ): ?TContext {
    return this.#graph.traverse((node, ...args) => {
      if (node.type === 'asset') {
        return visit(node.value, ...args);
      }
    });
  }
}
