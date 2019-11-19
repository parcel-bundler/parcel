// @flow strict-local

import type {Server as HTTPServer} from 'http';
import type {Server as HTTPSServer} from 'https';
import type {Socket} from 'net';
import type {FilePath, HTTPSOptions} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

import http from 'http';
import https from 'https';
import nullthrows from 'nullthrows';
import {getCertificate, generateCertificate} from '../';

type CreateHTTPServerOpts = {|
  https: ?(HTTPSOptions | boolean),
  inputFS: FileSystem,
  outputFS: FileSystem,
  cacheDir: FilePath,
  listener?: (mixed, mixed) => void
|};

// Creates either an http or https server with an awaitable dispose
// that closes any connections
export async function createHTTPServer(
  options: CreateHTTPServerOpts
): Promise<{|
  stop: () => Promise<void>,
  server: HTTPServer | HTTPSServer
|}> {
  let server;
  if (!options.https) {
    server = http.createServer(options.listener);
  } else if (options.https === true) {
    server = https.createServer(
      await generateCertificate(options.outputFS, options.cacheDir),
      options.listener
    );
  } else {
    server = https.createServer(
      await getCertificate(options.inputFS, options.https),
      options.listener
    );
  }

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
  return {
    server,
    stop() {
      return new Promise((resolve, reject) => {
        for (let socket of nullthrows(sockets)) {
          socket.destroy();
        }
        sockets = new Set();

        server.close(err => {
          if (err != null) {
            reject(err);
            return;
          }

          resolve();
        });
      });
    }
  };
}
