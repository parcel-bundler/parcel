// @flow strict-local

import {Reporter} from '@parcel/plugin';
import invariant from 'assert';
import express from 'express';
// flowlint-next-line untyped-import:off
import getPort from 'get-port';
import nullthrows from 'nullthrows';
import {Disposable} from '@parcel/events';

const servers: Map<string, Disposable> = new Map();

export default (new Reporter({
  async report({event, logger, options}) {
    switch (event.type) {
      case 'watchStart': {
        invariant(!servers.has(options.instanceId));
        let app = express();
        let port: number = await getPort();
        let listenPromise = new Promise((resolve, reject) => {
          let server = nullthrows(
            app.listen(port, (err?: ?Error) => {
              if (err != null) {
                reject(err);
              } else {
                logger.info({
                  message: `Graph explorer started on http://localhost:${port}`,
                });
                resolve(server);
              }
            }),
          );
        });

        servers.set(
          options.instanceId,
          new Disposable(async () => {
            let server = await listenPromise;
            return new Promise((resolve, reject) => {
              server.close(err => {
                if (err != null) {
                  reject(err);
                } else {
                  resolve();
                }
              });
            });
          }),
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
