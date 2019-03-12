// @flow

import type {Environment, Graph, Node} from '@parcel/types';

import graphviz from 'graphviz';
import tempy from 'tempy';
import path from 'path';

export default async function dumpGraphToGraphViz(
  graph: Graph<Node>,
  name: string
): Promise<void> {
  let g = graphviz.digraph('G');

  let colors = {
    root: 'gray',
    asset: 'green',
    dependency: 'orange',
    transformer_request: 'cyan',
    file: 'gray',
    default: 'white'
  };

  let nodes: Array<Node> = Array.from(graph.nodes.values());
  for (let node of nodes) {
    let n = g.addNode(node.id);

    n.set('color', colors[node.type || 'default']);
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
        node.value.assetGraph.getRootNode()
      );
      label += rootAssets
        .map(asset => {
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
    g.addEdge(edge.from, edge.to);
  }

  let tmp = tempy.file({name: `${name}.png`});

  await g.output('png', tmp);
  console.log(`open ${tmp}`); // eslint-disable-line no-console
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
