// @flow strict-local

import invariant from 'assert';
import path from 'path';

import ThrowableDiagnostic from '@parcel/diagnostic';
import type {NodeId} from '@parcel/graph';
import {hashString, ParcelNapi} from '@parcel/rust';
import type {Async} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';

import AssetGraph, {nodeFromAssetGroup} from '../AssetGraph';
import {createAssetIdFromOptions} from '../assetUtils';
import type {ParcelV3} from '../parcel-v3';
import {Asset as PublicAsset, MutableAsset} from '../public/Asset';
import {
  type ProjectPath,
  fromProjectPath,
  fromProjectPathRelative,
  toProjectPath,
} from '../projectPath';
import {requestTypes, type StaticRunOpts} from '../RequestTracker';
import {propagateSymbols} from '../SymbolPropagation';
import type {Asset, AssetGroup, ParcelOptions} from '../types';
import UncommittedAsset from '../UncommittedAsset';

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
      let result;
      try {
        result = await rustParcel.build();
      } catch (err) {
        throw new ThrowableDiagnostic({
          diagnostic: err,
        });
      }

      let serializedAssetGraph = result.Ok;
      let [assetGraph, changedAssets] = getAssetGraph(
        serializedAssetGraph,
        options,
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

      let asset = {
        ...node.value,
        committed: true,
        filePath: toProjectPath(options.projectRoot, node.value.filePath),
        // // backward compatibility
        // symbols:
        //   node.value.flags & AssetFlags.HAS_SYMBOLS
        //     ? new Map(node.value.symbols.map(s => [s.exported, s]))
        //     : null,
      };

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
      let dependency = {
        ...node.value,
        // specifier:
        //   node.value.flags & DependencyFlags.ENTRY
        //     ? toProjectPath(options.projectRoot, node.value.specifier)
        //     : node.value.specifier,
        sourcePath: node.value.sourcePath
          ? toProjectPath(options.projectRoot, node.value.sourcePath)
          : null,
        // flags: node.value.flags & ~DependencyFlags.HAS_SYMBOLS,
        // symbols:
        //   node.value.flags & DependencyFlags.HAS_SYMBOLS
        //     ? new Map(node.value.symbols.map(s => [s.exported, s]))
        //     : null,
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
        sideEffects: Boolean(toNode.sideEffects),
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

  return [graph, changedAssets];
}
