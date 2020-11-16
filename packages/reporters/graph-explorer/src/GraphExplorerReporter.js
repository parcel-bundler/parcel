// @flow strict-local

import type {
  $Application,
  $Request as ExpressRequest,
  $Response as ExpressResponse,
} from 'express';
import type {Socket} from 'net';

import {Reporter} from '@parcel/plugin';
import invariant from 'assert';
import express from 'express';
// flowlint-next-line untyped-import:off
import getPort from 'get-port';
import nullthrows from 'nullthrows';
import {Disposable} from '@parcel/events';

type ExpressApplication = $Application<ExpressRequest, ExpressResponse>;

const servers: Map<string, Disposable> = new Map();

export default (new Reporter({
  async report({event, logger, options}) {
    switch (event.type) {
      case 'watchStart': {
        invariant(!servers.has(options.instanceId));
        let app = express();
        let port: number = await getPort();
        let listenPromise = listen(app, port);

        servers.set(
          options.instanceId,
          new Disposable(async () => {
            await close(await listenPromise);
          }),
        );

        await listenPromise;
        logger.info({
          message: `Graph explorer started on http://localhost:${port}`,
        });

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
