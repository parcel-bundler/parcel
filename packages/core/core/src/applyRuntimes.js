// @flow strict-local

import type {Dependency} from '@parcel/types';
import type {
  AssetRequestDesc,
  Bundle as InternalBundle,
  NodeId,
  ParcelOptions,
} from './types';
import type InternalBundleGraph from './BundleGraph';
import type AssetGraphBuilder from './AssetGraphBuilder';
import type ParcelConfig from './ParcelConfig';
import type PluginOptions from './public/PluginOptions';

import assert from 'assert';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import AssetGraph, {nodeFromAssetGroup, nodeFromDep} from './AssetGraph';
import {createDependency} from './Dependency';
import {dependencyToInternalDependency} from './public/Dependency';
import {environmentToInternalEnvironment} from './public/Environment';
import {targetToInternalTarget} from './public/Target';
import BundleGraph from './public/BundleGraph';
import {removeAssetGroups} from './BundleGraph';
import {NamedBundle} from './public/Bundle';
import {setDifference} from '@parcel/utils';
import {PluginLogger} from '@parcel/logger';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import {HASH_REF_PREFIX, HASH_REF_REGEX} from './constants';

type RuntimeConnection = {|
  bundle: InternalBundle,
  assetRequest: AssetRequestDesc,
  dependencyFrom: ?Dependency,
  dependencyReplace: ?Dependency,
  isEntry: ?boolean,
|};

export default async function applyRuntimes({
  bundleGraph,
  config,
  options,
  pluginOptions,
  runtimesBuilder,
}: {|
  bundleGraph: InternalBundleGraph,
  config: ParcelConfig,
  options: ParcelOptions,
  pluginOptions: PluginOptions,
  runtimesBuilder: AssetGraphBuilder,
|}): Promise<void> {
  let connections: Array<RuntimeConnection> = [];
  let bundleReferences = [];

  for (let bundle of bundleGraph.getBundles()) {
    let runtimes = await config.getRuntimes(bundle.env.context);
    for (let runtime of runtimes) {
      try {
        let applied = await runtime.plugin.apply({
          bundle: new NamedBundle(bundle, bundleGraph, options),
          bundleGraph: new BundleGraph(bundleGraph, options),
          options: pluginOptions,
          logger: new PluginLogger({origin: runtime.name}),
        });

        if (applied) {
          let runtimeAssets = Array.isArray(applied) ? applied : [applied];
          for (let {
            code,
            dependencyFrom,
            dependencyReplace,
            filePath,
            isEntry,
          } of runtimeAssets) {
            let assetRequest = {
              code,
              filePath,
              env: bundle.env,
            };
            connections.push({
              bundle,
              assetRequest,
              dependencyFrom,
              dependencyReplace,
              isEntry,
            });
            let hashRefs = code.match(HASH_REF_REGEX) ?? [];
            for (let hashRef of hashRefs) {
              bundleReferences.push({
                from: bundle.id,
                to: hashRef.slice(HASH_REF_PREFIX.length),
              });
            }
          }
        }
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, runtime.name),
        });
      }
    }
  }

  let runtimesAssetGraph = await reconcileNewRuntimes(
    runtimesBuilder,
    connections,
  );

  let runtimesGraph = removeAssetGroups(runtimesAssetGraph);

  // merge the transformed asset into the bundle's graph, and connect
  // the node to it.
  bundleGraph._graph.merge(runtimesGraph);

  for (let {
    bundle,
    assetRequest,
    dependencyFrom,
    dependencyReplace,
    isEntry,
  } of connections) {
    let assetGroupNode = nodeFromAssetGroup(assetRequest);
    let assetGroupAssets = runtimesAssetGraph.getNodesConnectedFrom(
      assetGroupNode,
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

    if (isEntry) {
      bundleGraph._graph.addEdge(
        nullthrows(bundleGraph._graph.getNode(bundle.id)).id,
        runtimeNode.id,
      );
      bundle.entryAssetIds.unshift(runtimeNode.id);
    }

    if (dependencyFrom != null) {
      bundleGraph._graph.addEdge(dependencyFrom.id, runtimeNode.id);
    }

    if (dependencyReplace != null) {
      let [dst] = bundleGraph._graph.getNodesConnectedFrom(
        nodeFromDep(dependencyToInternalDependency(dependencyReplace)),
      );
      dependencyToInternalDependency(dependencyReplace).isAsync = false;

      bundleGraph._graph.removeEdge(dependencyReplace.id, dst.id);

      let newDep = bundleGraph._graph.addNode(
        nodeFromDep(
          createDependency({
            sourceAssetId: runtimeNode.id,
            sourcePath: runtimeNode.value.filePath,
            moduleSpecifier: dependencyReplace.moduleSpecifier,
            env: environmentToInternalEnvironment(dependencyReplace.env),
            target:
              // $FlowFixMe
              dependencyReplace.target &&
              targetToInternalTarget(dependencyReplace.target),
            isAsync: dependencyReplace.isAsync,
            isEntry: dependencyReplace.isEntry,
            isOptional: dependencyReplace.isOptional,
            isURL: dependencyReplace.isURL,
            isWeak: dependencyReplace.isWeak,
            // $FlowFixMe
            loc: dependencyReplace.loc,
            meta: dependencyReplace.meta,
            symbols: dependencyReplace.symbols,
            pipeline: dependencyReplace.pipeline,
          }),
        ),
      );
      bundleGraph._graph.addEdge(bundle.id, newDep.id, 'contains');
      bundleGraph._graph.addEdge(dependencyReplace.id, runtimeNode.id);
      bundleGraph._graph.addEdge(runtimeNode.id, newDep.id);
      bundleGraph._graph.addEdge(newDep.id, dst.id);
    }

    // Verify this asset won't become an island
    assert(
      bundleGraph._graph.getNodesConnectedTo(runtimeNode).length > 0,
      'Runtime must have an inbound dependency or be an entry',
    );
  }

  for (let {from, to} of bundleReferences) {
    bundleGraph._graph.addEdge(from, to, 'references');
  }
}

async function reconcileNewRuntimes(
  runtimesBuilder: AssetGraphBuilder,
  connections: Array<RuntimeConnection>,
): Promise<AssetGraph> {
  let {assetGraph} = runtimesBuilder;

  let assetRequestNodesById = new Map(
    connections
      .map(t => t.assetRequest)
      .map(request => {
        let node = nodeFromAssetGroup(request);
        return [node.id, node];
      }),
  );
  let newRequestIds = new Set(assetRequestNodesById.keys());
  let oldRequestIds = new Set(
    assetGraph.getEntryAssetGroupNodes().map(node => node.id),
  );

  let toAdd = setDifference(newRequestIds, oldRequestIds);
  let toRemove = setDifference(oldRequestIds, newRequestIds);

  assetGraph.replaceNodesConnectedTo(
    nullthrows(assetGraph.getRootNode()),
    [...toAdd].map(requestId =>
      nullthrows(assetRequestNodesById.get(requestId)),
    ),
    node => toRemove.has(node.id),
  );

  // rebuild the graph
  return (await runtimesBuilder.build()).assetGraph;
}
