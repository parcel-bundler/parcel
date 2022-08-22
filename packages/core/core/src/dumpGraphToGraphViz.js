// @flow

import type {Asset, BundleBehavior} from '@parcel/types';
import type {Graph} from '@parcel/graph';
import type {AssetGraphNode, BundleGraphNode, Environment} from './types';
import BundleGraph from './BundleGraph';
import {bundleGraphEdgeTypes} from './BundleGraph';
import {requestGraphEdgeTypes} from './RequestTracker';

import path from 'path';
import {fromNodeId} from '@parcel/graph';
import {fromProjectPathRelative} from './projectPath';
import {SpecifierType, Priority} from './types';

const COLORS = {
  root: 'gray',
  asset: 'green',
  dependency: 'orange',
  transformer_request: 'cyan',
  file: 'gray',
  default: 'white',
};

const TYPE_COLORS = {
  bundle: 'blue',
  contains: 'grey',
  internal_async: 'orange',
  references: 'red',
  sibling: 'green',
  invalidated_by_create: 'green',
  invalidated_by_create_above: 'orange',
  invalidate_by_update: 'cyan',
  invalidated_by_delete: 'red',
};

export default async function dumpGraphToGraphViz(
  graph:
    | Graph<AssetGraphNode>
    | Graph<{|
        assets: Set<Asset>,
        sourceBundles: Set<number>,
        bundleBehavior?: ?BundleBehavior,
      |}>
    | Graph<BundleGraphNode>,
  name: string,
  bundleGraph?: BundleGraph,
  edgeTypes?: typeof bundleGraphEdgeTypes | typeof requestGraphEdgeTypes,
): Promise<void> {
  if (
    process.env.PARCEL_BUILD_ENV === 'production' ||
    process.env.PARCEL_DUMP_GRAPHVIZ == null ||
    // $FlowFixMe
    process.env.PARCEL_DUMP_GRAPHVIZ == false
  ) {
    return;
  }
  const graphviz = require('graphviz');
  const tempy = require('tempy');
  let g = graphviz.digraph('G');

  for (let [id, node] of graph.nodes) {
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
      if (bundleGraph) {
        label = bundleGraph.nodeToString(id);
      } else {
        label = graph.nodeToString(id);
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
  let tmp = tempy.file({name: `${name}.png`});
  await g.output('png', tmp);
  // eslint-disable-next-line no-console
  console.log('Dumped', tmp);
}

function nodeId(id) {
  // $FlowFixMe
  return `node${id}`;
}

function getEnvDescription(env: Environment) {
  let description;
  if (typeof env.engines.browsers === 'string') {
    description = `${env.context}: ${env.engines.browsers}`;
  } else if (Array.isArray(env.engines.browsers)) {
    description = `${env.context}: ${env.engines.browsers.join(', ')}`;
  } else if (env.engines.node) {
    description = `node: ${env.engines.node}`;
  } else if (env.engines.electron) {
    description = `electron: ${env.engines.electron}`;
  }

  return description ?? '';
}
