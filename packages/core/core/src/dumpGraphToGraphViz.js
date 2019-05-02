// @flow

import type {Environment} from '@parcel/types';

import type Graph from './Graph';
import type {AssetGraphNode, BundleGraphNode} from './types';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';
import BundleGraph from './BundleGraph';

const COLORS = {
  root: 'gray',
  asset: 'green',
  dependency: 'orange',
  transformer_request: 'cyan',
  file: 'gray',
  default: 'white'
};

export default async function dumpGraphToGraphViz(
  // $FlowFixMe
  graph: Graph<AssetGraphNode> | Graph<BundleGraphNode>,
  name: string
): Promise<void> {
  // if (
  //   process.env.PARCEL_BUILD_ENV === 'production' ||
  //   process.env.PARCEL_DUMP_GRAPHVIZ == null
  // ) {
  //   return;
  // }

  const graphviz = require('graphviz');
  const tempy = require('tempy');

  let g = graphviz.digraph('G');

  let nodes = Array.from(graph.nodes.values());
  for (let node of nodes) {
    let n = g.addNode(node.id);

    // $FlowFixMe default is fine. Not every type needs to be in the map.
    n.set('color', COLORS[node.type || 'default']);
    n.set('shape', 'box');
    n.set('style', 'filled');

    let label = `${node.type || 'No Type'}: `;

    if (node.type === 'dependency') {
      label += node.value.moduleSpecifier;
      let parts = [];
      if (node.value.isEntry) parts.push('entry');
      if (node.value.isAsync) parts.push('async');
      if (node.value.isOptional) parts.push('optional');
      if (parts.length) label += ' (' + parts.join(', ') + ')';
      if (node.value.env) label += ` (${getEnvDescription(node.value.env)})`;
    } else if (node.type === 'asset' || node.type === 'asset_reference') {
      label += path.basename(node.value.filePath) + '#' + node.value.type;
    } else if (node.type === 'file') {
      label += path.basename(node.value.filePath);
    } else if (node.type === 'transformer_request') {
      label +=
        path.basename(node.value.filePath) +
        ` (${getEnvDescription(node.value.env)})`;
    } else if (node.type === 'bundle') {
      let rootAssets = node.value.assetGraph.getNodesConnectedFrom(
        nullthrows(node.value.assetGraph.getRootNode())
      );
      label += rootAssets
        .map(asset => {
          invariant(asset.type === 'asset' || asset.type === 'asset_reference');
          let parts = asset.value.filePath.split(path.sep);
          let index = parts.lastIndexOf('node_modules');
          if (index >= 0) {
            return parts[index + 1];
          }

          return path.basename(asset.value.filePath);
        })
        .join(', ');
    } else {
      // label += node.id;
      label = node.type;
    }

    n.set('label', label);
  }

  for (let edge of graph.edges) {
    let e = g.addEdge(edge.from, edge.to);
    if (edge.type && edge.type.startsWith('invalidated')) {
      e.set('color', 'red');
    }
  }

  let tmp = tempy.file({name: `${name}.png`});

  await g.output('png', tmp);
  // eslint-disable-next-line no-console
  console.log('Dumped', tmp);

  if (graph instanceof BundleGraph) {
    graph.traverseBundles(bundle => {
      dumpGraphToGraphViz(bundle.assetGraph, bundle.id);
    });
  }
}

function getEnvDescription(env: Environment) {
  let description = '';
  if (env.engines.browsers) {
    description = `${env.context}: ${env.engines.browsers.join(', ')}`;
  } else if (env.engines.node) {
    description = `node: ${env.engines.node}`;
  }

  return description;
}
