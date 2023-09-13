// @flow strict-local
/* eslint-disable monorepo/no-internal-import */

import type {IDisposable} from '@parcel/events/src/types';
import type {PluginLogger} from '@parcel/types';
import type {$Application as ExpressApp} from 'express';

import type {GraphContext} from './types';

import {Disposable} from '@parcel/events';
import watcher from '@parcel/watcher';

import express from 'express';
import fs from 'fs';
import getPort from 'get-port';
import nullthrows from 'nullthrows';
import path from 'path';
import {spawn} from 'child_process';
// $FlowFixMe[untyped-import]
import {printSchema} from 'graphql';

type GraphExplorerOptions = {|
  dev?: boolean,
  port?: number,
  verbose?: boolean,
|};

export class GraphExplorer implements IDisposable {
  #disposable: Disposable = new Disposable();
  #port: number;
  #context: GraphContext;
  #app: ExpressApp<>;
  #logger: ?PluginLogger;
  #opts: ?GraphExplorerOptions;

  constructor(
    context: GraphContext,
    logger: ?PluginLogger,
    opts: ?GraphExplorerOptions,
  ) {
    this.#context = context;
    this.#logger = logger;
    this.#opts = opts;
  }

  static printSchema(): string {
    return printSchema(require('./handler').createSchema());
  }

  get port(): number {
    return nullthrows(this.#port, 'GraphExplorer not started!');
  }

  get disposed(): boolean {
    return this.#disposable.disposed;
  }

  dispose(): Promise<void> {
    return this.#disposable.dispose();
  }

  async start(): Promise<void> {
    if (this.#app != null) {
      throw new Error('GraphExplorer already started!');
    }

    // Use a port option if provided, unless we're starting in dev mode.
    // In dev mode, the Parcel server will use the port instead.
    this.#port = await getPort({
      port: !this.#opts?.dev ? this.#opts?.port ?? 5555 : 5555,
    });

    this.#app = express();

    let handler = require('./handler').createHandler(
      this.#context,
      this.#logger,
    );

    this.#app.all('/graphql', (...args) => handler(...args));

    if (this.#opts?.dev) {
      let schemaPath = path.resolve(__dirname, '../schema.graphql');
      writeSchema(schemaPath, this.#logger);

      // Hot reload the GraphQL handler when files change.
      this.#disposable.add(
        await createHotHandler(() => {
          writeSchema(schemaPath, this.#logger);
          handler = require('./handler').createHandler(
            this.#context,
            this.#logger,
          );
          this.#logger?.verbose({
            message: 'Reloaded GraphQL handler',
          });
        }, this.#logger),
      );

      this.#disposable.add(await createHotHandler(() => {}));

      this.#disposable.add(
        await createRelayWatcher(this.#opts?.verbose, this.#logger),
      );

      this.#disposable.add(
        await createServer(
          this.#app,
          this.#port,
          this.#opts?.dev,
          this.#logger,
        ),
      );

      // Create a proxy config for the Parcel server to use.
      // This will allow transparent interaction with the Graph Explorer
      // server from the Parcel server.
      this.#disposable.add(await createProxyrc(this.#port, this.#logger));

      // Transparently use Parcel's port instead of the port
      // being used by the Graph Explorer server.
      this.#port = await getPort({port: this.#opts?.port ?? 1234});
      this.#disposable.add(
        await createParcelServer(this.#port, this.#opts?.verbose, this.#logger),
      );
    } else {
      this.#app.use(
        '/',
        express.static(path.resolve(__dirname, '../frontend')),
      );
      this.#disposable.add(
        await createServer(
          this.#app,
          this.#port,
          this.#opts?.dev,
          this.#logger,
        ),
      );
    }
  }
}

async function createHotHandler(cb: () => void, logger: ?PluginLogger) {
  logger?.info({
    message: 'Watching for changes to GraphQL handler...',
  });
  let subscription = await watcher.subscribe(
    __dirname,
    (err, events) => {
      if (err) {
        logger?.error({
          message: `Error watching for changes to GraphQL handler: ${err.message}`,
        });
        return;
      }

      for (let event of events) {
        if (event.type === 'update' || event.type === 'create') {
          logger?.verbose({
            message: `File changed: ${event.path}`,
          });
        } else if (event.type === 'delete') {
          logger?.verbose({
            message: `File deleted: ${event.path}`,
          });
        }
      }

      let mod = require.cache[require.resolve('./handler')];
      let seen = new Set();
      let stack = [mod];
      while (stack.length) {
        mod = stack.pop();
        if (seen.has(mod.id)) continue;
        seen.add(mod.id);
        for (let dep of mod.children) {
          if (!dep.id.includes('node_modules')) {
            stack.push(dep);
          }
        }
        delete require.cache[mod.id];
      }
      cb();
    },
    {
      ignore: ['dist', 'frontend', 'node_modules'],
    },
  );
  return () => subscription.unsubscribe();
}

function createServer(
  app: ExpressApp<>,
  port: number,
  dev: ?boolean,
  logger: ?PluginLogger,
): Promise<Disposable> {
  return new Promise((resolve, reject) => {
    logger?.verbose({
      message: `Starting server on port ${port}...`,
    });
    let server = nullthrows(
      app.listen(port, (err?: ?Error) => {
        if (err != null) {
          reject(err);
        } else {
          if (!dev) {
            logger?.info({
              message: `Graph Explorer started on http://localhost:${port}`,
            });
            logger?.info({
              message: `GraphQL API at http://localhost:${port}/graphql`,
            });
          }

          resolve(
            new Disposable(() => {
              logger?.verbose({
                message: `Stopping server on port ${port}...`,
              });
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
        }
      }),
    );
  });
}

async function createProxyrc(
  port: number,
  logger: ?PluginLogger,
): Promise<Disposable> {
  const proxyrc = path.resolve(__dirname, '../.proxyrc');
  logger?.verbose({
    message: `Creating ${proxyrc}`,
  });
  await fs.promises.writeFile(
    proxyrc,
    `{"/graphql": {"target": "http://localhost:${port}"}}`,
  );
  return new Disposable(() => {
    logger?.verbose({
      message: `Removing ${proxyrc}`,
    });
    return fs.promises.unlink(proxyrc);
  });
}

function writeSchema(schemaPath: string, logger: ?PluginLogger): void {
  fs.writeFileSync(
    schemaPath,
    printSchema(require('./handler').createSchema()),
  );
  logger?.verbose({
    message: `Wrote GraphQL schema to ${schemaPath}`,
  });
}

function createRelayWatcher(
  verbose?: boolean,
  logger: ?PluginLogger,
): Promise<Disposable> {
  let cmd = require.resolve('.bin/relay-compiler');
  let cwd = path.resolve(__dirname, '..');

  let args = ['--watch'];
  if (!verbose) {
    args.push('--output', 'quiet-with-errors');
  }

  return new Promise((resolve, reject) => {
    logger?.verbose({
      message: `$ ${cmd} ${args.join(' ')}`,
    });

    let relay = spawn(cmd, args, {cwd, stdio: 'inherit'});

    function handleClose(code) {
      if (code != null && code !== 0) {
        reject(new Error(`Relay exited with code ${code}`));
      }
    }

    relay.once('close', handleClose);

    relay.once('spawn', () => {
      relay.off('close', handleClose);

      logger?.info({
        message: 'Watching for changes to GraphQL queries...',
      });

      resolve(
        new Disposable(() => {
          logger?.verbose({
            message: 'Stopping Relay watcher...',
          });
          return new Promise((resolve, reject) => {
            relay.on('close', code => {
              if (code != null && code !== 0) {
                reject(new Error(`Relay exited with code ${code}`));
              } else {
                resolve();
              }
            });
            relay.kill();
          });
        }),
      );
    });
  });
}

function createParcelServer(
  port: number,
  verbose: ?boolean,
  logger: ?PluginLogger,
): Promise<Disposable> {
  let cmd = require.resolve('parcel/src/bin.js');
  let cwd = path.resolve(__dirname, '..');

  let args = ['--port', port.toString(10)];
  if (verbose) {
    args.push('--log-level', 'verbose');
  }

  return new Promise((resolve, reject) => {
    logger?.verbose({message: `$ ${cmd} ${args.join(' ')}`});

    let parcel = spawn(cmd, args, {cwd, stdio: 'inherit'});

    function handleClose(code) {
      if (code != null && code !== 0) {
        reject(new Error(`Parcel exited with code ${code}`));
      }
    }

    parcel.once('close', handleClose);

    parcel.once('spawn', () => {
      parcel.off('close', handleClose);

      logger?.info({
        message: `Graph Explorer started on http://localhost:${port}`,
      });
      logger?.info({
        message: `GraphQL API at http://localhost:${port}/graphql`,
      });

      resolve(
        new Disposable(() => {
          logger?.verbose({
            message: `Stopping Parcel server on port ${port}...`,
          });
          return new Promise((resolve, reject) => {
            parcel.on('close', code => {
              if (code != null && code !== 0) {
                reject(new Error(`Parcel exited with code ${code}`));
              } else {
                resolve();
              }
            });
            parcel.kill();
          });
        }),
      );
    });
  });
}
