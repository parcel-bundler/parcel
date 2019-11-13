// @flow strict-local

import type {Dependency} from '@parcel/types';
import type {
  AssetRequestDesc,
  Bundle as InternalBundle,
  NodeId,
  ParcelOptions
} from './types';
import type InternalBundleGraph from './BundleGraph';
import type AssetGraphBuilder from './AssetGraphBuilder';
import type ParcelConfig from './ParcelConfig';
import type PluginOptions from './public/PluginOptions';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import AssetGraph, {nodeFromAssetGroup} from './AssetGraph';
import BundleGraph from './public/BundleGraph';
import {removeAssetGroups} from './BundleGraph';
import {NamedBundle} from './public/Bundle';
import {setDifference} from '@parcel/utils';
import {PluginLogger} from '@parcel/logger';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';

type RuntimeConnection = {|
  bundle: InternalBundle,
  assetRequest: AssetRequestDesc,
  dependency: ?Dependency,
  isEntry: ?boolean
|};

export default async function applyRuntimes({
  bundleGraph,
  config,
  options,
  pluginOptions,
  runtimesBuilder
}: {|
  bundleGraph: InternalBundleGraph,
  config: ParcelConfig,
  options: ParcelOptions,
  pluginOptions: PluginOptions,
  runtimesBuilder: AssetGraphBuilder
|}): Promise<void> {
  let connections: Array<RuntimeConnection> = [];

  for (let bundle of bundleGraph.getBundles()) {
    let runtimes = await config.getRuntimes(bundle.env.context);
    for (let runtime of runtimes) {
      try {
        let applied = await runtime.plugin.apply({
          bundle: new NamedBundle(bundle, bundleGraph, options),
          bundleGraph: new BundleGraph(bundleGraph, options),
          options: pluginOptions,
          logger: new PluginLogger({origin: runtime.name})
        });

        if (applied) {
          let runtimeAssets = Array.isArray(applied) ? applied : [applied];
          for (let {code, dependency, filePath, isEntry} of runtimeAssets) {
            let assetRequest = {
              code,
              filePath,
              env: bundle.env
            };
            connections.push({
              bundle,
              assetRequest,
              dependency: dependency,
              isEntry
            });
          }
        }
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, runtime.name)
        });
      }
    }
  }

  let runtimesAssetGraph = await reconcileNewRuntimes(
    runtimesBuilder,
    connections
  );

  let runtimesGraph = removeAssetGroups(runtimesAssetGraph);

  // merge the transformed asset into the bundle's graph, and connect
  // the node to it.
  bundleGraph._graph.merge(runtimesGraph);

  for (let {bundle, assetRequest, dependency, isEntry} of connections) {
    let assetGroupNode = nodeFromAssetGroup(assetRequest);
    let assetGroupAssets = runtimesAssetGraph.getNodesConnectedFrom(
      assetGroupNode
    );
    invariant(assetGroupAssets.length === 1);
    let runtimeNode = assetGroupAssets[0];
    invariant(runtimeNode.type === 'asset');

    let duplicatedAssetIds: Set<NodeId> = new Set();
    runtimesGraph.traverse((node, _, actions) => {
      if (node.type !== 'dependency') {
        return;
      }

      let assets = runtimesGraph.getNodesConnectedFrom(node).map(assetNode => {
        invariant(assetNode.type === 'asset');
        return assetNode.value;
      });

      for (let asset of assets) {
        if (bundleGraph.isAssetInAncestorBundles(bundle, asset)) {
          duplicatedAssetIds.add(asset.id);
          actions.skipChildren();
        }
      }
    }, runtimeNode);

    runtimesGraph.traverse((node, _, actions) => {
      if (node.type === 'asset' || node.type === 'dependency') {
        if (duplicatedAssetIds.has(node.id)) {
          actions.skipChildren();
          return;
        }

        bundleGraph._graph.addEdge(bundle.id, node.id, 'contains');
      }
    }, runtimeNode);

    bundleGraph._graph.addEdge(
      dependency
        ? dependency.id
        : nullthrows(bundleGraph._graph.getNode(bundle.id)).id,
      runtimeNode.id
    );

    if (isEntry) {
      bundle.entryAssetIds.unshift(runtimeNode.id);
    }
  }
}

async function reconcileNewRuntimes(
  runtimesBuilder: AssetGraphBuilder,
  connections: Array<RuntimeConnection>
): Promise<AssetGraph> {
  let {assetGraph} = runtimesBuilder;

  let assetRequestNodesById = new Map(
    connections
      .map(t => t.assetRequest)
      .map(request => {
        let node = nodeFromAssetGroup(request);
        return [node.id, node];
      })
  );
  let newRequestIds = new Set(assetRequestNodesById.keys());
  let oldRequestIds = new Set(
    assetGraph.getEntryAssetGroupNodes().map(node => node.id)
  );

  let toAdd = setDifference(newRequestIds, oldRequestIds);
  let toRemove = setDifference(oldRequestIds, newRequestIds);

  assetGraph.replaceNodesConnectedTo(
    nullthrows(assetGraph.getRootNode()),
    [...toAdd].map(requestId =>
      nullthrows(assetRequestNodesById.get(requestId))
    ),
    node => toRemove.has(node.id)
  );

  // rebuild the graph
  return (await runtimesBuilder.build()).assetGraph;
}
