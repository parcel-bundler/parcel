// @flow strict-local

import type {
  $Application,
  $Request as ExpressRequest,
  $Response as ExpressResponse,
} from 'express';
import type {Socket} from 'net';
// This is a private type and will be removed when compiled.
// eslint-disable-next-line monorepo/no-internal-import
import type {Graph, NodeId, EdgeTypeName, NullEdgeType} from '@parcel/graph';

import {Reporter} from '@parcel/plugin';
import invariant from 'assert';
import express from 'express';
// flowlint-next-line untyped-import:off
import getPort from 'get-port';
import nullthrows from 'nullthrows';
import {Disposable} from '@parcel/events';
// flowlint-next-line untyped-import:off
import * as msgpack from '@msgpack/msgpack';
import path from 'path';

type InstanceId = string;
type ExpressApplication = $Application<ExpressRequest, ExpressResponse>;

let subscription: ?{|server: http$Server, sockets: Set<Socket>|} = null;
let cachedGraph = null;

export async function startGraphExplorer(
  bundleGraph: BundleGraph,
  frontendDir: string,
) {
  let app = express();
  app.use('/', express.static(frontendDir));
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

  let port: number = await getPort({port: 5555});
  subscription = await listen(app, port);

  console.log(`Graph explorer started on http://localhost:${port}`);
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

function serialize<TNode, TEdgeType: number = 1>(
  graph: Graph<TNode, TEdgeType>,
): {|
  nodes: Map<NodeId, TNode>,
  edges: Map<NodeId, Map<EdgeTypeName, Set<NodeId>>>,
|} {
  let edges = new Map<NodeId, Map<EdgeTypeName, Set<NodeId>>>();
  for (let {from, to, type} of graph.getAllEdges()) {
    let types = edges.get(from);
    let typeName = graph.getEdgeTypeName(type);
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

function createApp(instanceId: InstanceId): ExpressApplication {
  let app = express();
  app.use('/', express.static(path.join(__dirname, '../frontend')));

  app.get('/api/graph', (req, res) => {
    res.set('Content-Type', 'application/x-msgpack');
    res.status(200).send(
      Buffer.from(
        msgpack.encode(serialize(nullthrows(graphs.get(instanceId))), {
          extensionCodec,
        }),
      ),
    );
  });
  return app;
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
