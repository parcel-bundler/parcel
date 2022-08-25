// @flow

import type {Asset, BundleBehavior} from '@parcel/types';
import type {Graph} from '@parcel/graph';
import type {AssetGraphNode, BundleGraphNode} from './types';
import BundleGraph from './BundleGraph';
import {bundleGraphEdgeTypes} from './BundleGraph';
import {requestGraphEdgeTypes} from './RequestTracker';
import fs from 'fs';
import nullthrows from 'nullthrows';

const COLORS = {
  root: 'gray',
  asset: 'green',
  dependency: 'orange',
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
  bundleGraph: ?BundleGraph,
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
  let pGraph = bundleGraph ? bundleGraph : graph;
  for (let [id, node] of graph.nodes) {
    let label;

    label = getLabel(id, node, pGraph);
    let n;
    if (process.env.PARCEL_DUMP_GRAPHVIZ?.endsWith('dot')) {
      n = g.addNode(label);
    } else {
      n = g.addNode(nodeId(id));
      // $FlowFixMe default is fine. Not every type needs to be in the map.
      n.set('color', COLORS[node.type || 'default']);
      n.set('shape', 'box');
      n.set('style', 'filled');
      n.set('label', label);
    }
  }

  let edgeNames;
  if (edgeTypes) {
    edgeNames = Object.fromEntries(
      Object.entries(edgeTypes).map(([k, v]) => [v, k]),
    );
  }

  for (let edge of graph.getAllEdges()) {
    let gEdge;
    if (process.env.PARCEL_DUMP_GRAPHVIZ?.endsWith('dot')) {
      gEdge = g.addEdge(
        getLabel(edge.from, nullthrows(graph.nodes.get(edge.from)), pGraph),
        getLabel(edge.to, nullthrows(graph.nodes.get(edge.to)), pGraph),
      );
      if (edge.type != 1 && edgeNames) {
        gEdge.set('label', edgeNames[edge.type]);
      }
    } else {
      gEdge = g.addEdge(nodeId(edge.from), nodeId(edge.to));
      let color = null;
      if (edge.type != 1 && edgeNames) {
        color = TYPE_COLORS[edgeNames[edge.type]];
      }
      if (color != null) {
        gEdge.set('color', color);
      }
    }
  }

  let tmp;
  if (process.env.PARCEL_DUMP_GRAPHVIZ?.endsWith('dot')) {
    tmp = tempy.file({name: `${name}.dot`});
    await g.output('canon', tmp);
  } else {
    //Make legend
    let legend_cluster = g.addCluster('cluster_0'); //Must be "cluster_number"
    legend_cluster.set('rankdir', 'LR');
    // legend_cluster.set('style', 'filled');
    legend_cluster.set('color', 'black');
    legend_cluster.set('label', 'Legend');
    legend_cluster.set('shape', 'plaintext');

    legend_cluster.setNodeAttribut('style', 'filled');
    legend_cluster.setNodeAttribut('color', 'white');
    legend_cluster.setNodeAttribut('shape', 'plaintext');

    for (let prop in edgeTypes) {
      let l = legend_cluster.addNode(prop);
      let r = legend_cluster.addNode(prop + 'down');
      r.set('style', 'invis');
      let e = legend_cluster.addEdge(l, r);
      e.set('color', TYPE_COLORS[prop]);
    }

    tmp = tempy.file({name: `${name}.png`});
    await g.output('png', tmp);
  }

  // eslint-disable-next-line no-console
  console.log('Dumped', tmp);
}

function nodeId(id) {
  // $FlowFixMe
  return `node${id}`;
}
function getLabel(id, node, graph) {
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
  } else {
    if (process.env.PARCEL_DUMP_GRAPHVIZ === 'dot') {
      switch (node.type) {
        case 'bundle':
          label = `Bundle[${String(node.value.name || node.id)}]`;
          break;
        case 'asset':
          label = `Asset[${String(node.value.filePath)}]`;
          break;
        case 'dependency':
          label = `Dependency[${node.value.specifier}]`;
          break;
        case 'root':
          label = `Root`;
          break;
        case 'entry_specifier':
          label = `EntrySpecifier[${String(node.value)}]`;
          break;
        case 'entry_file':
          label = `EntryFile[${String(node.value.filePath)}]`;
          break;
        case 'asset_group':
          label = `AssetGroup[${String(node.value.filePath)}]`;
          break;
        case 'bundle_group':
          label = `BundleGroup[${String(node.value.target.env.context)}]`;
          break;
        default:
          label = graph.nodeToString(id);
          break;
      }
    } else {
      label = graph.nodeToString(id);
    }
  }
  return label;
}
