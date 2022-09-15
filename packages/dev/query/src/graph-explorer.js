// @flow strict-local
import type {
  $Application,
  $Request as ExpressRequest,
  $Response as ExpressResponse,
} from 'express';
/* eslint-disable monorepo/no-internal-import */
import type BundleGraph from '@parcel/core/src/BundleGraph.js';
import {type BundleGraphEdgeType} from '@parcel/core/src/BundleGraph.js';
import type {AssetGraphNode, BundleGraphNode} from '@parcel/core/src/types.js';
import type {Socket} from 'net';
import type {ContentGraph, NodeId} from '@parcel/graph';

import express from 'express';
// $FlowFixMe(untyped-import)
import * as msgpack from '@msgpack/msgpack';
import getPort from 'get-port';
import nullthrows from 'nullthrows';
import {ALL_EDGE_TYPES, toNodeId} from '@parcel/graph';

import {bundleGraphEdgeTypes} from '@parcel/core/src/BundleGraph.js';

type ExpressApplication = $Application<ExpressRequest, ExpressResponse>;

let subscription: ?{|server: http$Server, sockets: Set<Socket>|} = null;
let cachedGraph = null;

export async function startGraphExplorer(
  bundleGraph: BundleGraph,
  frontendDir?: string,
) {
  // Pre-pack the serialized graph to speed up API responses.
  let pack = msgpack.encode(serialize(bundleGraph._graph), {extensionCodec});
  let app = express();
  if (frontendDir != null) {
    app.use('/', express.static(frontendDir));
  }
  app.get('/api/graph', (req, res) => {
    res.set('Content-Type', 'application/x-msgpack');
    if (cachedGraph == null) {
      cachedGraph = Buffer.from(
        msgpack.encode(serialize(bundleGraph._graph), {
          extensionCodec,
        }),
      );
    }
    res.status(200).send(cachedGraph);
  });
  app.get('/api/find-paths', (req, res) => {
    const {from, to} = req.query;
    if (from == null || to == null) {
      throw new Error('From and to not specified');
    }
    res.set('Content-Type', 'application/x-msgpack');
    //findPaths(graph,)
  });

  let port: number = await getPort({port: 5555});
  subscription = await listen(app, port);

  console.log(`Graph explorer started on http://localhost:${port}`);
  if (frontendDir == null) {
    console.log('Graph explorer frontend dir was not provided!');
    console.log('You can:');
    console.log('  - rerun the command with the path the frontend directory');
    console.log('  - run the frontend dev server with a `.proxyrc` file like:');
    console.log('    {');
    console.log('      "/api/*": {');
    console.log(`        "target": "http://localhost:${port}",`);
    console.log('      }');
    console.log('    }');
  }
}

// if a and b share a common ancestor c:
// {id: c, children: [{id: NextInPathToA, children: ...}, {id: NextInPathToB, children: ...}]}

// if a or b is an ancestor of the other:
// {id: a, children: [{id: NextInPathToB, children: ...}]}
type Path = {|id: NodeId, children: ?(Path[])|};

function createPath(ids: NodeId[]): Path {
  for (let next of ids) {
    return {id: next, children: null};
  }
}

function findPaths(
  graph:
    | ContentGraph<BundleGraphNode, BundleGraphEdgeType>
    | ContentGraph<AssetGraphNode>,
  a: string,
  b: string,
): ?Path {
  let pathsToA = new Map();
  let path = [];

  graph.traverseAncestors(
    toNodeId(parseInt(a, 10)),
    ancestorId => {
      if (String(ancestorId) === '@@root') {
        path = [];
      } else {
        path = [...path, ancestorId];
        pathsToA.set(ancestorId, path);
      }
    },
    ALL_EDGE_TYPES,
  );

  let common = null;
  let pathToB = [];
  graph.traverseAncestors(
    toNodeId(parseInt(b, 10)),
    (ancestorId, _, actions) => {
      if (String(ancestorId) === '@@root') {
        pathToB = [];
      } else {
        pathToB = [...pathToB, ancestorId];
        if (pathsToA.has(ancestorId)) {
          common = ancestorId;
          actions.stop();
        }
      }
    },
    ALL_EDGE_TYPES,
  );

  if (common == null) {
    return null;
  }
  let pathToA = nullthrows(pathsToA.get(common));
  if (common === a) {
    return {id: common, children: [createPath(pathToB)]};
  } else if (common === b) {
    return {id: common, children: [createPath(pathToA)]};
  } else {
    return {id: common, children: [createPath(pathToA), createPath(pathToB)]};
  }
}

export async function stopGraphExplorer() {
  if (subscription) {
    await close(subscription);
    subscription = null;
    cachedGraph = null;
  }
}

function listen(
  app: ExpressApplication,
  port: number,
): Promise<{|server: http$Server, sockets: Set<Socket>|}> {
  return new Promise((resolve, reject) => {
    let server = nullthrows(
      app.listen(port, (err?: ?Error) => {
        if (err != null) {
          reject(err);
        } else {
          // HTTPServer#close only stops accepting new connections, and does not close existing ones.
          // Before closing, destroy any active connections through their sockets. Additionally, remove sockets when they close:
          // https://stackoverflow.com/questions/18874689/force-close-all-connections-in-a-node-js-http-server
          // https://stackoverflow.com/questions/14626636/how-do-i-shutdown-a-node-js-https-server-immediately/14636625#14636625
          let sockets: Set<Socket> = new Set();
          server.on('connection', (socket: Socket) => {
            nullthrows(sockets).add(socket);
            socket.on('close', () => {
              nullthrows(sockets).delete(socket);
            });
          });
          resolve({server, sockets});
        }
      }),
    );
  });
}

function close({
  server,
  sockets,
}: {|
  server: http$Server,
  sockets: Set<Socket>,
|}): Promise<void> {
  return new Promise((resolve, reject) => {
    for (let socket of sockets) {
      socket.destroy();
    }
    for (let socket of sockets) {
      sockets.delete(socket);
    }

    server.close(err => {
      if (err != null) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

type EdgeTypeName = string;

let bundleGraphEdgeTypesReverse = new Map(
  Object.entries(bundleGraphEdgeTypes).map(([a, b]) => [b, a]),
);

function serialize(
  graph: ContentGraph<BundleGraphNode, BundleGraphEdgeType>,
): {|
  nodes: Map<NodeId, BundleGraphNode>,
  edges: Map<NodeId, Map<EdgeTypeName, Set<NodeId>>>,
|} {
  let edges = new Map<NodeId, Map<EdgeTypeName, Set<NodeId>>>();
  for (let {from, to, type} of graph.getAllEdges()) {
    let types = edges.get(from);
    let typeName = nullthrows(bundleGraphEdgeTypesReverse.get(type));
    if (!types) {
      types = new Map();
      edges.set(from, types);
    }
    let tos = types.get(typeName);
    if (!tos) {
      tos = new Set();
      types.set(typeName, tos);
    }
    tos.add(to);
  }

  return {
    nodes: graph.nodes,
    edges,
  };
}

// Derived from
// https://github.com/msgpack/msgpack-javascript#extension-types
const extensionCodec = new msgpack.ExtensionCodec();
extensionCodec.register({
  type: 0,
  encode(value) {
    return value instanceof Set
      ? msgpack.encode([...value], {extensionCodec})
      : null;
  },
});

extensionCodec.register({
  type: 1,
  encode(value) {
    return value instanceof Map
      ? msgpack.encode([...value], {extensionCodec})
      : null;
  },
});
