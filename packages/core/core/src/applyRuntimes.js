// @flow strict-local

import type {Dependency, NamedBundle as INamedBundle} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type {
  AssetGroup,
  Bundle as InternalBundle,
  NodeId,
  ParcelOptions,
} from './types';
import type ParcelConfig from './ParcelConfig';
import type PluginOptions from './public/PluginOptions';
import type RequestTracker from './RequestTracker';

import assert from 'assert';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import AssetGraph, {nodeFromAssetGroup} from './AssetGraph';
import BundleGraph from './public/BundleGraph';
import InternalBundleGraph from './BundleGraph';
import {NamedBundle} from './public/Bundle';
import {PluginLogger} from '@parcel/logger';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import {dependencyToInternalDependency} from './public/Dependency';
import createAssetGraphRequest from './requests/AssetGraphRequest';

type RuntimeConnection = {|
  bundle: InternalBundle,
  assetGroup: AssetGroup,
  dependency: ?Dependency,
  isEntry: ?boolean,
|};

export default async function applyRuntimes({
  bundleGraph,
  config,
  options,
  pluginOptions,
  requestTracker,
  optionsRef,
}: {|
  bundleGraph: InternalBundleGraph,
  config: ParcelConfig,
  options: ParcelOptions,
  optionsRef: SharedReference,
  pluginOptions: PluginOptions,
  requestTracker: RequestTracker,
|}): Promise<void> {
  let connections: Array<RuntimeConnection> = [];

  for (let bundle of bundleGraph.getBundles()) {
    let runtimes = await config.getRuntimes(bundle.env.context);
    for (let runtime of runtimes) {
      try {
        let applied = await runtime.plugin.apply({
          bundle: NamedBundle.get(bundle, bundleGraph, options),
          bundleGraph: new BundleGraph<INamedBundle>(
            bundleGraph,
            NamedBundle.get,
            options,
          ),
          options: pluginOptions,
          logger: new PluginLogger({origin: runtime.name}),
        });

        if (applied) {
          let runtimeAssets = Array.isArray(applied) ? applied : [applied];
          for (let {code, dependency, filePath, isEntry} of runtimeAssets) {
            let assetGroup = {
              code,
              filePath,
              env: bundle.env,
              // Runtime assets should be considered source, as they should be
              // e.g. compiled to run in the target environment
              isSource: true,
            };

            connections.push({
              bundle,
              assetGroup,
              dependency: dependency,
              isEntry,
            });
          }
        }
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, {
            origin: runtime.name,
            filePath: bundle.filePath,
          }),
        });
      }
    }
  }

  let runtimesAssetGraph = await reconcileNewRuntimes(
    requestTracker,
    connections,
    optionsRef,
  );

  let runtimesGraph = InternalBundleGraph.fromAssetGraph(
    runtimesAssetGraph,
    bundleGraph._publicIdByAssetId,
    bundleGraph._assetPublicIds,
  );

  // Merge the runtimes graph into the main bundle graph.
  bundleGraph.merge(runtimesGraph);
  for (let [assetId, publicId] of runtimesGraph._publicIdByAssetId) {
    bundleGraph._publicIdByAssetId.set(assetId, publicId);
    bundleGraph._assetPublicIds.add(publicId);
  }

  for (let {bundle, assetGroup, dependency, isEntry} of connections) {
    let assetGroupNode = nodeFromAssetGroup(assetGroup);
    let assetGroupAssets = runtimesAssetGraph.getNodesConnectedFrom(
      assetGroupNode,
    );
    invariant(assetGroupAssets.length === 1);
    let runtimeNode = assetGroupAssets[0];
    invariant(runtimeNode.type === 'asset');

    let resolution =
      dependency &&
      bundleGraph.getDependencyResolution(
        dependencyToInternalDependency(dependency),
        bundle,
      );
    let duplicatedAssetIds: Set<NodeId> = new Set();
    let runtimeGraphRuntimeNodeId = runtimesGraph._graph.getNodeIdByContentKey(
      runtimeNode.id,
    );
    let bundleNodeId = bundleGraph._graph.getNodeIdByContentKey(bundle.id);
    let bundleGraphRuntimeNodeId = bundleGraph._graph.getNodeIdByContentKey(
      runtimeNode.id,
    );
    runtimesGraph._graph.traverse((node, _, actions) => {
      if (node.type !== 'dependency') {
        return;
      }

      let assets = runtimesGraph._graph
        .getNodeIdsConnectedFrom(
          runtimesGraph._graph.getNodeIdByContentKey(node.id),
        )
        .map(assetNodeId => {
          let assetNode = nullthrows(runtimesGraph._graph.getNode(assetNodeId));
          invariant(assetNode.type === 'asset');
          return assetNode.value;
        });

      for (let asset of assets) {
        if (
          bundleGraph.isAssetReachableFromBundle(asset, bundle) ||
          resolution?.id === asset.id
        ) {
          duplicatedAssetIds.add(asset.id);
          actions.skipChildren();
        }
      }
    }, runtimeGraphRuntimeNodeId);

    runtimesGraph._graph.traverse((node, _, actions) => {
      if (node.type === 'asset' || node.type === 'dependency') {
        if (duplicatedAssetIds.has(node.id)) {
          actions.skipChildren();
          return;
        }

        bundleGraph._graph.addEdge(
          bundleNodeId,
          bundleGraph._graph.getNodeIdByContentKey(node.id),
          'contains',
        );
      }
    }, runtimeGraphRuntimeNodeId);

    if (isEntry) {
      bundleGraph._graph.addEdge(bundleNodeId, bundleGraphRuntimeNodeId);
      bundle.entryAssetIds.unshift(runtimeNode.value.id);
    }

    if (dependency == null) {
      // Verify this asset won't become an island
      assert(
        bundleGraph._graph.getNodeIdsConnectedTo(bundleGraphRuntimeNodeId)
          .length > 0,
        'Runtime must have an inbound dependency or be an entry',
      );
    } else {
      bundleGraph._graph.addEdge(
        bundleGraph._graph.getNodeIdByContentKey(dependency.id),
        bundleGraphRuntimeNodeId,
      );
    }
  }
}

async function reconcileNewRuntimes(
  requestTracker: RequestTracker,
  connections: Array<RuntimeConnection>,
  optionsRef: SharedReference,
): Promise<AssetGraph> {
  let assetGroups = connections.map(t => t.assetGroup);
  let request = createAssetGraphRequest({
    name: 'Runtimes',
    assetGroups,
    optionsRef,
  });

  // rebuild the graph
  return (await requestTracker.runRequest(request, {force: true})).assetGraph;
}
