// @flow strict-local

import invariant from 'assert';

import ThrowableDiagnostic from '@parcel/diagnostic';
import type {Async} from '@parcel/types';

import AssetGraph, {nodeFromAssetGroup} from '../AssetGraph';
import type {ParcelV3} from '../parcel-v3';
import {toProjectPath} from '../projectPath';
import {requestTypes, type StaticRunOpts} from '../RequestTracker';
import {propagateSymbols} from '../SymbolPropagation';

import type {
  AssetGraphRequestInput,
  AssetGraphRequestResult,
} from './AssetGraphRequest';

type RunInput = {|
  input: AssetGraphRequestInput,
  ...StaticRunOpts<AssetGraphRequestResult>,
|};

type AssetGraphRequest = {|
  id: string,
  +type: typeof requestTypes.asset_graph_request,
  run: RunInput => Async<AssetGraphRequestResult>,
  input: AssetGraphRequestInput,
|};

export function createAssetGraphRequestRust(
  rustParcel: ParcelV3,
): (input: AssetGraphRequestInput) => AssetGraphRequest {
  return input => ({
    type: requestTypes.asset_graph_request,
    id: input.name,
    run: async input => {
      let options = input.options;
      let serializedAssetGraph;
      try {
        serializedAssetGraph = await rustParcel.buildAssetGraph();
      } catch (err) {
        throw new ThrowableDiagnostic({
          diagnostic: err,
        });
      }

      let {assetGraph, cachedAssets, changedAssets} = getAssetGraph(
        serializedAssetGraph,
        options,
      );

      // TODO: Make it a bulk transaction
      await Promise.all(
        Array.from(cachedAssets.entries(), ([id, code]) =>
          options.cache.setBlob(id, Buffer.from(code)),
        ),
      );

      let changedAssetsPropagation = new Set(changedAssets.keys());
      let errors = propagateSymbols({
        options,
        assetGraph,
        changedAssetsPropagation,
        assetGroupsWithRemovedParents: new Set(),
        previousErrors: new Map(), //this.previousSymbolPropagationErrors,
      });

      if (errors.size > 0) {
        // Just throw the first error. Since errors can bubble (e.g. reexporting a reexported symbol also fails),
        // determining which failing export is the root cause is nontrivial (because of circular dependencies).
        throw new ThrowableDiagnostic({
          diagnostic: [...errors.values()][0],
        });
      }

      return {
        assetGraph,
        assetRequests: [],
        assetGroupsWithRemovedParents: new Set(),
        changedAssets,
        changedAssetsPropagation,
        previousSymbolPropagationErrors: undefined,
      };
    },
    input,
  });
}

function getAssetGraph(serializedGraph, options) {
  let graph = new AssetGraph({
    _contentKeyToNodeId: new Map(),
    _nodeIdToContentKey: new Map(),
  });

  graph.safeToIncrementallyBundle = false;

  let cachedAssets = new Map();
  let changedAssets = new Map();
  let entry = 0;
  for (let node of serializedGraph.nodes) {
    if (node.type === 'root') {
      let index = graph.addNodeByContentKey('@@root', {
        id: '@@root',
        type: 'root',
        value: null,
      });

      graph.setRootNodeId(index);
    } else if (node.type === 'entry') {
      let id = 'entry:' + ++entry;

      graph.addNodeByContentKey(id, {
        id: id,
        type: 'root',
        value: null,
      });
    } else if (node.type === 'asset') {
      let id = node.value.id;
      let asset = node.value.asset;

      asset = {
        ...asset,
        id,
        committed: true,
        contentKey: id,
        filePath: toProjectPath(options.projectRoot, asset.filePath),
        symbols: asset.hasSymbols
          ? new Map(
              asset.symbols.map(({exported, ...symbol}) => [exported, symbol]),
            )
          : null,
      };

      cachedAssets.set(id, asset.code);
      changedAssets.set(id, asset);

      graph.addNodeByContentKey(id, {
        id,
        type: 'asset',
        usedSymbols: new Set(),
        usedSymbolsDownDirty: true,
        usedSymbolsUpDirty: true,
        value: asset,
      });
    } else if (node.type === 'dependency') {
      let id = node.value.id;
      let dependency = node.value.dependency;

      dependency = {
        ...dependency,
        id,
        contentKey: id,
        sourcePath: dependency.sourcePath
          ? toProjectPath(options.projectRoot, dependency.sourcePath)
          : null,
        symbols: dependency.hasSymbols
          ? new Map(
              dependency.symbols.map(({exported, ...symbol}) => [
                exported,
                symbol,
              ]),
            )
          : null,
      };
      let usedSymbolsDown = new Set();
      let usedSymbolsUp = new Map();
      if (dependency.isEntry && dependency.isLibrary) {
        usedSymbolsDown.add('*');
        usedSymbolsUp.set('*', undefined);
      }

      graph.addNodeByContentKey(id, {
        id,
        type: 'dependency',
        deferred: false,
        excluded: false,
        hasDeferred: node.has_deferred,
        usedSymbolsDown,
        usedSymbolsDownDirty: true,
        usedSymbolsUp,
        usedSymbolsUpDirtyDown: true,
        usedSymbolsUpDirtyUp: true,
        value: dependency,
      });
    }
  }

  for (let i = 0; i < serializedGraph.edges.length; i += 2) {
    let from = serializedGraph.edges[i];
    let to = serializedGraph.edges[i + 1];
    let fromNode = graph.getNode(from);
    if (fromNode?.type === 'dependency') {
      let toNode = graph.getNode(to);
      invariant(toNode?.type === 'asset');

      // For backwards compatibility, create asset group node if needed.
      let assetGroupNode = nodeFromAssetGroup({
        filePath: toNode.value.filePath,
        env: fromNode.value.env,
        pipeline: toNode.value.pipeline,
        sideEffects: Boolean(toNode.value.sideEffects),
      });

      let index = graph.addNodeByContentKeyIfNeeded(
        assetGroupNode.id,
        assetGroupNode,
      );

      graph.addEdge(from, index);
      graph.addEdge(index, to);
    } else {
      graph.addEdge(from, to);
    }
  }

  return {
    assetGraph: graph,
    cachedAssets,
    changedAssets,
  };
}
