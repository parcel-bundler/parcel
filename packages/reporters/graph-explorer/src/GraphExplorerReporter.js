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

const graphs: Map<InstanceId, Graph<*, *>> = new Map();

export function debug(instanceId: InstanceId, graph: Graph<*, *>) {
  graphs.set(instanceId, graph);
}

const servers: Map<InstanceId, Disposable> = new Map();

export default (new Reporter({
  async report({event, logger, options}) {
    switch (event.type) {
      case 'buildSuccess': {
        invariant(!servers.has(options.instanceId));
        let app = createApp(options.instanceId);
        let port: number = await getPort();
        let listenPromise = listen(app, port);

        servers.set(
          options.instanceId,
          new Disposable(async () => {
            await close(await listenPromise);
          }),
        );

        await listenPromise;
        // Writing this to stdout for now so it doesn't get swallowed by other
        // reporters
        process.stdout.write(
          `Graph explorer started on http://localhost:${port}\n`,
        );

        break;
      }

      case 'watchEnd': {
        await nullthrows(servers.get(options.instanceId)).dispose();
        break;
      }
    }
  },
}): Reporter);

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
