// @flow strict-local
import type {ContentGraph, NodeId} from '@parcel/graph';
// eslint-disable-next-line monorepo/no-internal-import
import type {AssetGraphNode, BundleGraphNode} from '@parcel/core/src/types';
// eslint-disable-next-line monorepo/no-internal-import
import type {BundleGraphEdgeType} from '@parcel/core/src/BundleGraph.js';

import path from 'path';
import fs from 'fs';
import v8 from 'v8';
import repl from 'repl';
import os from 'os';
import nullthrows from 'nullthrows';
import invariant from 'assert';

// eslint-disable-next-line monorepo/no-internal-import
import AssetGraph from '@parcel/core/src/AssetGraph.js';
// eslint-disable-next-line monorepo/no-internal-import
import BundleGraph from '@parcel/core/src/BundleGraph.js';
// eslint-disable-next-line monorepo/no-internal-import
import {fromProjectPathRelative} from '@parcel/core/src/projectPath';
// eslint-disable-next-line monorepo/no-internal-import
import {bundleGraphEdgeTypes} from '@parcel/core/src/BundleGraph.js';

let args = process.argv.slice(2);
let cacheDir = path.join(process.cwd(), '.parcel-cache');
if (args[0] === '--cache') {
  cacheDir = path.resolve(process.cwd(), args[1]);
  args = args.slice(2);
}
let initialCmd = args[0];

try {
  fs.accessSync(cacheDir);
} catch (e) {
  console.error("Can't find cache dir", cacheDir);
  process.exit(1);
}

function filesBySize() {
  let files = fs
    .readdirSync(cacheDir)
    .map(f => [
      path.join(cacheDir, f),
      fs.statSync(path.join(cacheDir, f)).size,
    ]);

  files.sort(([, a], [, b]) => b - a);

  return files.map(([f]) => f);
}

console.log('Loading graphs...');
let bundleGraph, assetGraph /* , requestGraph */;
for (let f of filesBySize()) {
  if (bundleGraph && assetGraph /*  && requestGraph */) break;
  if (path.extname(f) !== '') continue;
  try {
    let obj = v8.deserialize(fs.readFileSync(f));
    if (obj.assetGraph != null && obj.assetGraph.value.hash != null) {
      assetGraph = AssetGraph.deserialize(obj.assetGraph.value);
    } else if (obj.bundleGraph != null) {
      bundleGraph = BundleGraph.deserialize(obj.bundleGraph.value);
      // } else if (obj['$$type']?.endsWith('RequestGraph')) {
      //   requestGraph = obj;
    }
  } catch (e) {
    // noop
  }
}

if (bundleGraph == null) {
  console.error('Bundle Graph could not be found');
  process.exit();
}

if (assetGraph == null) {
  console.error('Asset Graph could not be found');
  process.exit();
}

// -------------------------------------------------------

function parseAssetLocator(v: string) {
  let id: ?string = null;
  if (v.length === 16) {
    id = v;
  } else {
    for (let [assetId, publicId] of bundleGraph._publicIdByAssetId) {
      if (publicId === v) {
        id = assetId;
        break;
      }
    }
  }

  if (id == null) {
    let assetRegex = new RegExp(v);
    for (let node of assetGraph.nodes.values()) {
      if (
        node.type === 'asset' &&
        assetRegex.test(fromProjectPathRelative(node.value.filePath))
      ) {
        id = node.id;
        break;
      }
    }
  }
  return id;
}

function getAsset(v: string) {
  let id: ?string = parseAssetLocator(v);

  if (id == null) {
    console.log(null);
  } else {
    try {
      let asset = bundleGraph.getAssetById(id);
      console.log('Public id', bundleGraph.getAssetPublicId(asset));
      console.log(asset);
    } catch (e) {
      let node = nullthrows(assetGraph.getNodeByContentKey(id));
      invariant(node.type === 'asset');
      console.log(node.value);
    }
  }
}

function findAsset(v: string) {
  let assetRegex = new RegExp(v);
  for (let node of assetGraph.nodes.values()) {
    if (
      node.type === 'asset' &&
      assetRegex.test(fromProjectPathRelative(node.value.filePath))
    ) {
      try {
        console.log(
          `${bundleGraph.getAssetPublicId(
            bundleGraph.getAssetById(node.id),
          )} ${fromProjectPathRelative(node.value.filePath)}`,
        );
      } catch (e) {
        console.log(fromProjectPathRelative(node.value.filePath));
      }
    }
  }
}

function getNodeAssetGraph(v: string) {
  console.log(assetGraph.getNodeByContentKey(v));
}
function getNodeBundleGraph(v: string) {
  console.log(bundleGraph._graph.getNodeByContentKey(v));
}

class Paths<T> {
  value: T;
  label: ?string;
  children: Array<Paths<T>> = [];
  constructor(value: T, label: ?string) {
    this.value = value;
    this.label = label;
  }
  add(v: T, label: ?string): Paths<T> {
    let next = new Paths(v, label);
    this.children.push(next);
    return next;
  }
  print(format: T => string, prefix = '') {
    console.log(prefix + (this.label ?? '-') + ' ' + format(this.value));
    for (let i = 0; i < this.children.length; i++) {
      this.children[i].print(format, prefix + '  ');
    }
  }
}

function _findEntries(
  graph:
    | ContentGraph<BundleGraphNode, BundleGraphEdgeType>
    | ContentGraph<AssetGraphNode>,
  v: string,
) {
  let asset = nullthrows(parseAssetLocator(v), 'Asset not found');

  let paths = new Paths<NodeId>(graph.getNodeIdByContentKey(asset));
  for (let parent of graph.getNodeIdsConnectedTo(
    graph.getNodeIdByContentKey(asset),
  )) {
    let cb = (id, _ctx) => {
      let ctx = _ctx ?? paths;
      let node = nullthrows(graph.getNode(id));
      if (node.id === asset) return;
      if (node.type === 'asset') {
        ctx = ctx.add(id);
      }
      return ctx;
    };
    graph.traverseAncestors(parent, cb);
  }

  paths.print(id => {
    let node = nullthrows(graph.getNode(id));
    invariant(node.type === 'asset');
    return fromProjectPathRelative(node.value.filePath);
  });
}

function findEntriesAssetGraph(v: string) {
  _findEntries(assetGraph, v);
}
function findEntriesBundleGraph(v: string) {
  _findEntries(bundleGraph._graph, v);
}
function findEntries(v: string) {
  findEntriesBundleGraph(v);
}

function getBundlesWithAsset(v: string) {
  let asset = nullthrows(parseAssetLocator(v), 'Asset not found');

  for (let b of bundleGraph.getBundlesWithAsset(
    bundleGraph.getAssetById(asset),
  )) {
    console.log(
      `${b.id} ${String(b.name)} ${
        b.mainEntryId != null ? `(main: ${b.mainEntryId})` : ''
      }`,
    );
  }
}

function getBundlesWithDependency(v: string) {
  let node = nullthrows(bundleGraph._graph.getNodeByContentKey(v));
  invariant(node.type === 'dependency');

  for (let b of bundleGraph.getBundlesWithDependency(node.value)) {
    console.log(
      `${b.id} ${String(b.name)} ${
        b.mainEntryId != null ? `(main: ${b.mainEntryId})` : ''
      }`,
    );
  }
}

// eslint-disable-next-line no-unused-vars
function getBundles(_) {
  for (let b of bundleGraph.getBundles()) {
    console.log(
      `${b.id} ${String(b.name)} ${
        b.mainEntryId != null ? `(main: ${b.mainEntryId})` : ''
      }`,
    );
  }
}

function getReferencingBundles(bundleId: string) {
  let bundleNodeId = bundleGraph._graph.getNodeIdByContentKey(bundleId);
  let bundleNode = nullthrows(
    bundleGraph._graph.getNode(bundleNodeId),
    'Bundle not found',
  );
  invariant(bundleNode.type === 'bundle', 'Not a bundle');

  for (let b of bundleGraph.getReferencingBundles(bundleNode.value)) {
    console.log(
      `${b.id} ${String(b.name)} ${
        b.mainEntryId != null ? `(main: ${b.mainEntryId})` : ''
      }`,
    );
  }
}

function getIncomingDependenciesAssetGraph(v: string) {
  let asset = nullthrows(parseAssetLocator(v), 'Asset not found');
  let node = nullthrows(assetGraph.getNodeByContentKey(asset));
  invariant(node.type === 'asset');

  console.log(assetGraph.getIncomingDependencies(node.value));
}
function getIncomingDependenciesBundleGraph(v: string) {
  let asset = nullthrows(parseAssetLocator(v), 'Asset not found');
  let value = nullthrows(bundleGraph.getAssetById(asset));

  console.log(bundleGraph.getIncomingDependencies(value));
}

function getIncomingDependencies(v: string) {
  getIncomingDependenciesBundleGraph(v);
}

function getResolvedAsset(v: string) {
  let node = nullthrows(
    bundleGraph._graph.getNodeByContentKey(v),
    'Dependency not found',
  );
  invariant(
    node.type === 'dependency',
    'Node is not a dependency, but a ' + node.type,
  );
  console.log(bundleGraph.getResolvedAsset(node.value));
}

function getAssetWithDependency(v: string) {
  let node = nullthrows(
    bundleGraph._graph.getNodeByContentKey(v),
    'Dependency not found',
  );
  invariant(
    node.type === 'dependency',
    'Node is not a dependency, but a ' + node.type,
  );
  console.log(bundleGraph.getAssetWithDependency(node.value));
}

function traverseAssets(v: string) {
  let node = nullthrows(
    bundleGraph._graph.getNodeByContentKey(v),
    'Bundle not found',
  );
  invariant(node.type === 'bundle', 'Node is not a bundle, but a ' + node.type);

  bundleGraph.traverseAssets(node.value, asset => {
    console.log(asset.id, asset.filePath);
  });
}
function traverseBundle(v: string) {
  let node = nullthrows(
    bundleGraph._graph.getNodeByContentKey(v),
    'Bundle not found',
  );
  invariant(node.type === 'bundle', 'Node is not a bundle, but a ' + node.type);

  bundleGraph.traverseBundle(node.value, node => {
    if (node.type === 'asset') {
      console.log(node.id, node.value.filePath);
    } else {
      console.log(
        node.id,
        node.value.sourcePath,
        '->',
        node.value.specifier,
        node.value.symbols
          ? `(${[...node.value.symbols.keys()].join(',')})`
          : '',
        node.excluded ? `- excluded` : '',
      );
    }
  });
}

function getBundle(v: string) {
  for (let b of bundleGraph.getBundles()) {
    if (b.name?.startsWith(v) || b.id === v) {
      console.log(b);
    }
  }
}

function findBundleReason(bundleId: string, asset: string) {
  let bundleNodeId = bundleGraph._graph.getNodeIdByContentKey(bundleId);
  let bundleNode = nullthrows(
    bundleGraph._graph.getNode(bundleNodeId),
    'Bundle not found',
  );
  invariant(bundleNode.type === 'bundle', 'Not a bundle');
  let assetId = nullthrows(parseAssetLocator(asset), 'Asset not found');
  let assetNodeId = bundleGraph._graph.getNodeIdByContentKey(assetId);
  let assetNode = nullthrows(
    bundleGraph._graph.getNode(assetNodeId),
    'Asset not found',
  );
  invariant(assetNode.type === 'asset', 'Not an asset');

  invariant(
    bundleGraph._graph.hasEdge(
      bundleNodeId,
      assetNodeId,
      bundleGraphEdgeTypes.contains,
    ),
    'Asset is not part of the bundle',
  );

  console.log(
    '# Asset is main entry of bundle:',
    bundleNode.value.mainEntryId === assetId,
  );

  console.log(
    '# Asset is an entry of bundle:',
    bundleNode.value.entryAssetIds.includes(assetId),
  );

  console.log('# Incoming dependencies contained in the bundle:');
  for (let incoming of bundleGraph._graph.getNodeIdsConnectedTo(assetNodeId)) {
    if (
      bundleGraph._graph.hasEdge(
        bundleNodeId,
        incoming,
        bundleGraphEdgeTypes.contains,
      )
    ) {
      console.log(bundleGraph._graph.getNode(incoming));
    }
  }

  console.log(
    '# Incoming dependencies contained in referencing bundles (using this bundle as a shared bundle)',
  );
  let referencingBundles = bundleGraph.getReferencingBundles(bundleNode.value);
  for (let incoming of bundleGraph._graph.getNodeIdsConnectedTo(assetNodeId)) {
    if (
      referencingBundles.some(ref =>
        bundleGraph._graph.hasEdge(
          bundleGraph._graph.getNodeIdByContentKey(ref.id),
          incoming,
          bundleGraphEdgeTypes.contains,
        ),
      )
    ) {
      console.log(bundleGraph._graph.getNode(incoming));
    }
  }
}

// eslint-disable-next-line no-unused-vars
function stats(_) {
  let ag = {
    asset: 0,
    dependency: 0,
    asset_group: 0,
  };

  for (let [, n] of assetGraph.nodes) {
    if (n.type in ag) {
      // $FlowFixMe
      ag[n.type]++;
    }
  }

  let bg = {
    dependency: 0,
    bundle: 0,
    asset: 0,
    asset_node_modules: 0,
    asset_source: 0,
  };
  for (let [, n] of bundleGraph._graph.nodes) {
    if (n.type in bg) {
      // $FlowFixMe
      bg[n.type]++;
    }
    if (n.type === 'asset') {
      if (fromProjectPathRelative(n.value.filePath).includes('node_modules')) {
        bg.asset_node_modules++;
      } else {
        bg.asset_source++;
      }
    }
  }

  console.log('# Asset Graph Node Counts');
  for (let k in ag) {
    console.log(k, ag[k]);
  }
  console.log();

  console.log('# Bundle Graph Node Counts');
  for (let k in bg) {
    console.log(k, bg[k]);
  }
}

// -------------------------------------------------------

if (initialCmd != null) {
  eval(initialCmd);
  process.exit(0);
} else {
  console.log(
    'See .help. The graphs can be accessed via `assetGraph` and `bundleGraph`.',
  );
  process.on('uncaughtException', function (err) {
    console.error(err);
    server.displayPrompt();
  });

  const server = repl.start({useColors: true, useGlobal: true});
  // $FlowFixMe[prop-missing]
  server.setupHistory(
    path.join(os.homedir(), '.parcel_query_history'),
    () => {},
  );

  // $FlowFixMe[prop-missing]
  server.context.bundleGraph = bundleGraph;
  // $FlowFixMe[prop-missing]
  server.context.assetGraph = assetGraph;

  for (let [name, cmd] of new Map([
    [
      'getAsset',
      {
        help: 'args: <id | public id | filepath>',
        action: getAsset,
      },
    ],
    [
      'getNodeAssetGraph',
      {
        help: 'args: <content key>. Find node by content key in the asset graph',
        action: getNodeAssetGraph,
      },
    ],
    [
      'getNodeBundleGraph',
      {
        help: 'args: <content key>. Find node by content key in the bundle graph',
        action: getNodeBundleGraph,
      },
    ],
    [
      'findEntriesAssetGraph',
      {
        help: 'args: <id | public id | filepath>. List paths from an asset to entry points (in asset graph)',
        action: findEntriesAssetGraph,
      },
    ],
    [
      'findEntriesBundleGraph',
      {
        help: 'args: <id | public id | filepath>. List paths from an asset to entry points (in bundle graph)',
        action: findEntriesBundleGraph,
      },
    ],
    [
      'findEntries',
      {
        help: '= findEntriesBundleGraph',
        action: findEntries,
      },
    ],
    [
      'getBundlesWithAsset',
      {
        help: 'args: <id | public id | filepath>. Gets bundles containing the asset',
        action: getBundlesWithAsset,
      },
    ],
    [
      'getBundlesWithDependency',
      {
        help: 'args: <id>. Gets bundles containing the dependency',
        action: getBundlesWithDependency,
      },
    ],
    [
      'getIncomingDependenciesAssetGraph',
      {
        help: 'args: <asset: id | public id | filepath regex>',
        action: getIncomingDependenciesAssetGraph,
      },
    ],
    [
      'getIncomingDependenciesBundleGraph',
      {
        help: 'args: <asset: id | public id | filepath regex>',
        action: getIncomingDependenciesBundleGraph,
      },
    ],
    [
      'getIncomingDependencies',
      {
        help: '= getIncomingDependenciesBundleGraph',
        action: getIncomingDependencies,
      },
    ],
    [
      'getResolvedAsset',
      {
        help: 'args: <dependency id>. Resolve the dependency',
        action: getResolvedAsset,
      },
    ],
    [
      'getAssetWithDependency',
      {
        help: 'args: <dependency id>. Show which asset created the dependency',
        action: getAssetWithDependency,
      },
    ],
    [
      'traverseAssets',
      {
        help: 'args: <bundle id>. List assets in bundle',
        action: traverseAssets,
      },
    ],
    [
      'traverseBundle',
      {
        help: 'args: <bundle id>. List assets and dependencies in bundle',
        action: traverseBundle,
      },
    ],
    [
      'getBundle',
      {
        help: 'args: <name prefix|bundle id>. List matching bundles',
        action: getBundle,
      },
    ],
    [
      'findBundleReason',
      {
        help: 'args: <bundle> <asset>. Why is the asset in the bundle',
        action: v => findBundleReason(...v.split(' ')),
      },
    ],
    [
      'getBundles',
      {
        help: 'List all bundles',
        action: getBundles,
      },
    ],
    [
      'getReferencingBundles',
      {
        help: 'args: <bundle>. List bundles that reference the bundle',
        action: getReferencingBundles,
      },
    ],
    [
      'stats',
      {
        help: 'Statistics',
        action: stats,
      },
    ],
    [
      'findAsset',
      {
        help: 'args: <regex>. Lsit assets matching the filepath regex',
        action: findAsset,
      },
    ],
  ])) {
    // $FlowFixMe
    server.context[name] = cmd.action;
    // $FlowFixMe
    server.defineCommand(name, {
      // $FlowFixMe
      help: '📦 ' + cmd.help,
      action: v => {
        // $FlowFixMe
        server.clearBufferedCommand();
        // $FlowFixMe
        try {
          cmd.action(v);
        } finally {
          server.displayPrompt();
        }
      },
    });
  }
}
