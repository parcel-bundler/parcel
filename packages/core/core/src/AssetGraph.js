// @flow strict-local

import invariant from 'assert';
import nullthrows from 'nullthrows';

import type {
  Dependency as IDependency,
  //AssetGroup,
  GraphVisitor,
  Symbol,
  SymbolResolution
} from '@parcel/types';
//import {md5FromString} from '@parcel/utils';

import type {/*DependencyNode,*/ AssetGraphNode, NodeId} from './types';
import type Asset from './Asset';
import Graph from './Graph';

// const hashObject = obj => {
//   return md5FromString(JSON.stringify(obj));
// };

// const nodeFromDep = (dep: IDependency): DependencyNode => ({
//   id: 'dependency:' + dep.id,
//   type: 'dependency',
//   value: dep
// });

// const nodeFromAssetGroup = (assetGroup: AssetGroup) => ({
//   id: 'asset_group:' + hashObject(assetGroup),
//   type: 'asset_group',
//   value: assetGroup
// });

// const nodeFromAsset = (asset: Asset) => ({
//   id: 'asset:' + asset.id,
//   type: 'asset',
//   value: asset
// });

export default class AssetGraph extends Graph<AssetGraphNode> {
  // resolveDependency(dependency, assetGroup) {
  //   let depNode = this.nodes.get('dependency:' + dependency.id);
  //   let assetGroupNode = nodeFromAssetGroup(assetGroup);
  //   this.replaceNodesConnectedTo(depNode, [assetGroupNode]);
  // }

  // resolveAssetGroup(assetGroup, assets) {
  //   let assetGroupNode = this.nodes.get(assetGroup.id);
  //   let assetNodes = assets.map(asset => nodeFromAsset(asset));
  //   this.replaceNodesConnectedTo(assetGroupNode, assetNodes);
  //   for (let assetNode of assetNodes) {
  //     let depNodes = [];
  //     for (let dep of assetNode.value.dependencies) {
  //       let depNode = nodeFromDep(dep);
  //       depNodes.push(this.nodes.get(depNode.id) || depNode);
  //     }
  //     this.replaceNodesConnectedTo(assetNode, depNodes);
  //   }
  // }

  getDependencies(asset: Asset): Array<IDependency> {
    let node = this.getNode(asset.id);
    if (!node) {
      return [];
    }

    return this.getNodesConnectedFrom(node).map(node => {
      invariant(node.type === 'dependency');
      return node.value;
    });
  }

  getDependencyResolution(dep: IDependency): ?Asset {
    let depNode = this.getNode(dep.id);
    if (!depNode) {
      return null;
    }

    let res: ?Asset = null;
    this.traverse((node, ctx, traversal) => {
      // Prefer real assets when resolving dependencies, but use the first
      // asset reference in absence of a real one.
      if (node.type === 'asset_reference' && !res) {
        res = node.value;
      }

      if (node.type === 'asset') {
        res = node.value;
        traversal.stop();
      }
    }, depNode);

    return res;
  }

  getAncestorDependencies(asset: Asset): Array<IDependency> {
    let node = this.getNode(asset.id);
    if (!node) {
      return [];
    }

    return this.findAncestors(node, node => node.type === 'dependency').map(
      node => {
        invariant(node.type === 'dependency');
        return node.value;
      }
    );
  }

  traverseAssets<TContext>(
    visit: GraphVisitor<Asset, TContext>,
    startNode: ?AssetGraphNode
  ): ?TContext {
    return this.filteredTraverse(
      node => (node.type === 'asset' ? node.value : null),
      visit,
      startNode
    );
  }

  getTotalSize(asset?: ?Asset): number {
    let size = 0;
    let assetNode = asset ? this.getNode(asset.id) : null;
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

  removeAsset(asset: Asset): ?NodeId {
    let assetNode = this.getNode(asset.id);
    if (!assetNode) {
      return;
    }

    let referenceId = 'asset_reference:' + assetNode.id;
    this.replaceNode(assetNode, {
      type: 'asset_reference',
      id: referenceId,
      value: asset
    });

    return referenceId;
  }

  resolveSymbol(asset: Asset, symbol: Symbol): SymbolResolution {
    if (symbol === '*') {
      return {asset, exportSymbol: '*', symbol: '*'};
    }

    let identifier = asset.symbols.get(symbol);

    let deps = this.getDependencies(asset).reverse();
    for (let dep of deps) {
      // If this is a re-export, find the original module.
      let symbolLookup = new Map(
        [...dep.symbols].map(([key, val]) => [val, key])
      );
      let depSymbol = symbolLookup.get(identifier);
      if (depSymbol != null) {
        let resolved = nullthrows(this.getDependencyResolution(dep));
        return this.resolveSymbol(resolved, depSymbol);
      }

      // If this module exports wildcards, resolve the original module.
      // Default exports are excluded from wildcard exports.
      if (dep.symbols.get('*') === '*' && symbol !== 'default') {
        let resolved = nullthrows(this.getDependencyResolution(dep));
        let result = this.resolveSymbol(resolved, symbol);
        if (result.symbol != null) {
          return result;
        }
      }
    }

    return {asset, exportSymbol: symbol, symbol: identifier};
  }
}
