// @flow strict-local

import type AssetGraph from '../AssetGraph';
import type {
  Asset as IAsset,
  Dependency,
  GraphVisitor,
  MainAssetGraph as IMainAssetGraph,
  MainAssetGraphTraversable
} from '@parcel/types';

import {Asset, assetToInternalAsset} from './Asset';
import {MutableBundle} from './Bundle';
import {assetGraphVisitorToInternal} from './utils';

export default class MainAssetGraph implements IMainAssetGraph {
  #graph; // AssetGraph

  constructor(graph: AssetGraph) {
    this.#graph = graph;
  }

  createBundle(asset: IAsset): MutableBundle {
    let assetNode = this.#graph.getNode(asset.id);
    if (!assetNode) {
      throw new Error('Cannot get bundle for non-existent asset');
    }

    let graph = this.#graph.getSubGraph(assetNode);
    graph.setRootNode({
      type: 'root',
      id: 'root',
      value: null
    });

    graph.addEdge('root', assetNode.id);

    // Prune assets that don't match the bundle type when including the asset's
    // subgraph. These are replaced with asset references, but the concrete assets
    // cannot exist in this bundle.
    //
    // The concrete assets are visited when traversing the MainAssetGraph, so they
    // will have their own opportunity to be bundled in a bundle of the appropriate
    // type.
    graph.traverseAssets(currentAsset => {
      if (currentAsset.type !== asset.type) {
        graph.removeAsset(currentAsset);
      }
    });

    // Prune assets that don't match the bundle type when including the asset's
    // subgraph. These are replaced with asset references, but the concrete assets
    // cannot exist in this bundle.
    //
    // The concrete assets are visited when traversing the MainAssetGraph, so they
    // will have their own opportunity to be bundled in a bundle of the appropriate
    // type.
    graph.traverseAssets(currentAsset => {
      if (currentAsset.type !== asset.type) {
        graph.removeAsset(currentAsset);
      }
    });

    return new MutableBundle({
      id: 'bundle:' + asset.id,
      filePath: null,
      isEntry: null,
      target: null,
      name: null,
      type: asset.type,
      assetGraph: graph,
      env: asset.env,
      stats: {size: 0, time: 0}
    });
  }

  getDependencies(asset: IAsset): Array<Dependency> {
    return this.#graph.getDependencies(assetToInternalAsset(asset));
  }

  getDependencyResolution(dep: Dependency): ?IAsset {
    let resolution = this.#graph.getDependencyResolution(dep);
    if (resolution) {
      return new Asset(resolution);
    }
  }

  traverse<TContext>(
    visit: GraphVisitor<MainAssetGraphTraversable, TContext>
  ): ?TContext {
    return this.#graph.filteredTraverse(node => {
      if (node.type === 'asset') {
        return {type: 'asset', value: new Asset(node.value)};
      } else if (node.type === 'dependency') {
        return {type: 'dependency', value: node.value};
      }
    }, visit);
  }

  traverseAssets<TContext>(visit: GraphVisitor<IAsset, TContext>): ?TContext {
    return this.#graph.traverseAssets(assetGraphVisitorToInternal(visit));
  }
}
