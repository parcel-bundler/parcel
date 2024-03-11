// @flow

import type {Asset, BundleBehavior} from '@parcel/types';
import type {Graph} from '@parcel/graph';
import type {ParcelDb, EnvironmentAddr} from '@parcel/rust';
import type {AssetGraphNode, BundleGraphNode} from './types';
import {bundleGraphEdgeTypes} from './BundleGraph';
import {requestGraphEdgeTypes} from './RequestTracker';

import path from 'path';
import fs from 'fs';
import {fromNodeId} from '@parcel/graph';
import {fromProjectPathRelative} from './projectPath';
import {
  Environment as DbEnvironment,
  Asset as DbAsset,
  Dependency as DbDependency,
  DependencyFlags,
  SymbolFlags,
  readCachedString,
} from '@parcel/rust';

const COLORS = {
  root: 'gray',
  asset: 'green',
  dependency: 'orange',
  transformer_request: 'cyan',
  file: 'gray',
  default: 'white',
};

const TYPE_COLORS = {
  // bundle graph
  bundle: 'blue',
  contains: 'grey',
  internal_async: 'orange',
  references: 'red',
  sibling: 'green',
  // asset graph
  // request graph
  invalidated_by_create: 'green',
  invalidated_by_create_above: 'orange',
  invalidate_by_update: 'cyan',
  invalidated_by_delete: 'red',
};

export default async function dumpGraphToGraphViz(
  db: ParcelDb,
  graph:
    | Graph<AssetGraphNode>
    | Graph<{|
        assets: Set<Asset>,
        sourceBundles: Set<number>,
        bundleBehavior?: ?BundleBehavior,
      |}>
    | Graph<BundleGraphNode>,
  name: string,
  edgeTypes?: typeof bundleGraphEdgeTypes | typeof requestGraphEdgeTypes,
): Promise<void> {
  if (
    process.env.PARCEL_BUILD_ENV === 'production' &&
    !process.env.PARCEL_BUILD_REPL
  ) {
    return;
  }

  let mode: ?string = process.env.PARCEL_BUILD_REPL
    ? // $FlowFixMe
      globalThis.PARCEL_DUMP_GRAPHVIZ?.mode
    : process.env.PARCEL_DUMP_GRAPHVIZ;

  // $FlowFixMe[invalid-compare]
  if (mode == null || mode == false) {
    return;
  }

  let detailedSymbols = mode === 'symbols';

  let GraphVizGraph = require('graphviz/lib/deps/graph').Graph;
  let g = new GraphVizGraph(null, 'G');
  g.type = 'digraph';
  // $FlowFixMe
  for (let [id, node] of graph.nodes.entries()) {
    if (node == null) continue;
    let n = g.addNode(nodeId(id));
    // $FlowFixMe default is fine. Not every type needs to be in the map.
    n.set('color', COLORS[node.type || 'default']);
    n.set('shape', 'box');
    n.set('style', 'filled');
    let label;
    if (typeof node === 'string') {
      label = node;
    } else if (node.assets) {
      label = `(${nodeId(id)}), (assetIds: ${[...node.assets]
        .map(a => {
          let arr = a.filePath.split('/');
          return arr[arr.length - 1];
        })
        .join(', ')}) (sourceBundles: ${[...node.sourceBundles].join(
        ', ',
      )}) (bb ${node.bundleBehavior ?? 'none'})`;
    } else if (node.type) {
      label = `[${fromNodeId(id)}] ${node.type || 'No Type'}: [${node.id}]: `;
      if (node.type === 'dependency') {
        let dep = DbDependency.get(db, node.value);
        label += dep.specifier;
        let parts = [];
        if (dep.priority !== 'sync') {
          parts.push(dep.priority);
        }
        if (dep.flags & DependencyFlags.OPTIONAL) parts.push('optional');
        if (dep.specifierType === 'url') parts.push('url');
        if (node.hasDeferred) parts.push('deferred');
        if (node.deferred) parts.push('deferred');
        if (node.excluded) parts.push('excluded');
        if (parts.length) label += ' (' + parts.join(', ') + ')';
        if (dep.env) label += ` (${getEnvDescription(db, dep.env)})`;
        let depSymbols = dep.symbols;
        if (detailedSymbols) {
          if (depSymbols) {
            if (depSymbols.length) {
              label +=
                '\\nsymbols: ' +
                [...depSymbols]
                  .map(({exported, local}) => [
                    readCachedString(db, exported),
                    readCachedString(db, local),
                  ])
                  .join(';');
            }
            let weakSymbols = [...depSymbols]
              .filter(({flags}) => flags & SymbolFlags.IS_WEAK)
              .map(({exported}) => readCachedString(db, exported));
            if (weakSymbols.length) {
              label += '\\nweakSymbols: ' + weakSymbols.join(',');
            }
            if (node.usedSymbolsUp.size > 0) {
              label +=
                '\\nusedSymbolsUp: ' +
                [...node.usedSymbolsUp]
                  .map(([s, sAsset]) =>
                    sAsset
                      ? `${s}(${sAsset.asset}.${
                          sAsset.symbol != null
                            ? readCachedString(db, sAsset.symbol)
                            : ''
                        })`
                      : sAsset === null
                      ? `${s}(external)`
                      : `${s}(ambiguous)`,
                  )
                  .join(',');
            }
            if (node.usedSymbolsDown.size > 0) {
              label +=
                '\\nusedSymbolsDown: ' +
                [...node.usedSymbolsDown]
                  .map(s => readCachedString(db, s))
                  .join(',');
            }
            // if (node.usedSymbolsDownDirty) label += '\\nusedSymbolsDownDirty';
            // if (node.usedSymbolsUpDirtyDown)
            //   label += '\\nusedSymbolsUpDirtyDown';
            // if (node.usedSymbolsUpDirtyUp) label += '\\nusedSymbolsUpDirtyUp';
          } else {
            label += '\\nsymbols: cleared';
          }
        }
      } else if (node.type === 'asset') {
        let asset = DbAsset.get(db, node.value);
        label +=
          path.basename(fromProjectPathRelative(asset.filePath)) +
          '#' +
          asset.assetType;
        if (detailedSymbols) {
          if (!asset.symbols) {
            label += '\\nsymbols: cleared';
          } else if (asset.symbols.length) {
            label +=
              '\\nsymbols: ' +
              [...asset.symbols]
                .map(({exported, local}) => [
                  readCachedString(db, exported),
                  readCachedString(db, local),
                ])
                .join(';');
          }
          if (node.usedSymbols.size) {
            label +=
              '\\nusedSymbols: ' +
              [...node.usedSymbols].map(s => readCachedString(db, s)).join(',');
          }
          // if (node.usedSymbolsDownDirty) label += '\\nusedSymbolsDownDirty';
          // if (node.usedSymbolsUpDirty) label += '\\nusedSymbolsUpDirty';
        } else {
          label += '\\nsymbols: cleared';
        }
      } else if (node.type === 'asset_group') {
        if (node.deferred) label += '(deferred)';
      } else if (node.type === 'file') {
        label += path.basename(node.id);
      } else if (node.type === 'transformer_request') {
        label +=
          path.basename(node.value.filePath) +
          ` (${getEnvDescription(db, node.value.env)})`;
      } else if (node.type === 'bundle') {
        let parts = [];
        if (node.value.needsStableName) parts.push('stable name');
        parts.push(node.value.name);
        parts.push('bb:' + (node.value.bundleBehavior ?? 'null'));
        if (node.value.isPlaceholder) parts.push('placeholder');
        if (parts.length) label += ' (' + parts.join(', ') + ')';
        if (node.value.env)
          label += ` (${getEnvDescription(db, node.value.env)})`;
      } else if (node.type === 'request') {
        label = node.requestType + ':' + node.id;
      }
    }
    n.set('label', label);
  }

  let edgeNames;
  if (edgeTypes) {
    edgeNames = Object.fromEntries(
      Object.entries(edgeTypes).map(([k, v]) => [v, k]),
    );
  }

  for (let edge of graph.getAllEdges()) {
    let gEdge = g.addEdge(nodeId(edge.from), nodeId(edge.to));
    let color = null;
    if (edge.type != 1 && edgeNames) {
      color = TYPE_COLORS[edgeNames[edge.type]];
    }
    if (color != null) {
      gEdge.set('color', color);
    }
  }

  if (process.env.PARCEL_BUILD_REPL) {
    // $FlowFixMe
    globalThis.PARCEL_DUMP_GRAPHVIZ?.(name, g.to_dot());
  } else {
    let render = await require('@mischnic/dot-svg')();
    let svg = render(g.to_dot());
    // const tempy = require('tempy');
    // let tmp = tempy.file({name: `parcel-${name}.svg`});
    let tmp = `parcel-${name}.svg`;

    fs.writeFileSync(tmp, svg);
    // eslint-disable-next-line no-console
    console.log('Dumped', tmp);
  }
}

function nodeId(id) {
  // $FlowFixMe
  return `node${id}`;
}

function getEnvDescription(db: ParcelDb, envId: EnvironmentAddr) {
  let description;
  let env = DbEnvironment.get(db, envId);
  let engines = env.engines;
  if (engines.browsers.length) {
    description = `${env.context}: ${Array.from(engines.browsers).join(', ')}`;
  } else if (engines.node) {
    description = `node: ${engines.node}`;
  } else if (engines.electron) {
    description = `electron: ${engines.electron}`;
  }

  return description ?? '';
}
