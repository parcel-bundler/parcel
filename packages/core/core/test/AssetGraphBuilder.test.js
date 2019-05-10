// @flow strict-local

import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {AbortController} from 'abortcontroller-polyfill/dist/cjs-ponyfill';

import AssetGraphBuilder, {BuildAbortError} from '../src/AssetGraphBuilder';
import ConfigResolver from '../src/ConfigResolver';
import Dependency from '../src/Dependency';
import Environment from '../src/Environment';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const CONFIG_DIR = path.join(FIXTURES_DIR, 'config');

const DEFAULT_ENV = new Environment({
  context: 'browser',
  engines: {
    browsers: ['> 1%']
  }
});

const TARGETS = [
  {
    name: 'test',
    distDir: 'dist',
    distEntry: 'out.js',
    env: DEFAULT_ENV
  }
];

const DEFAULT_OPTIONS = {
  cache: false,
  cacheDir: '.parcel-cache',
  entries: [],
  logLevel: 'none',
  rootDir: FIXTURES_DIR,
  targets: []
};

describe('AssetGraphBuilder', () => {
  let config;
  let builder;
  beforeEach(async () => {
    config = nullthrows(await new ConfigResolver().resolve(CONFIG_DIR));

    builder = new AssetGraphBuilder({
      options: DEFAULT_OPTIONS,
      config,
      entries: ['./module-b'],
      targets: TARGETS
    });
  });

  it('creates an AssetGraphBuilder', async () => {
    invariant(
      builder.graph.nodes.has(
        new Dependency({
          moduleSpecifier: './module-b',
          env: DEFAULT_ENV
        }).id
      )
    );
  });

  it('throws a BuildAbortError when resolving if signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();

    try {
      await builder.resolve(
        new Dependency({
          moduleSpecifier: './module-b',
          env: DEFAULT_ENV,
          sourcePath: FIXTURES_DIR + '/index'
        }),
        {
          signal: controller.signal
        }
      );
    } catch (e) {
      invariant(e instanceof BuildAbortError);
      return;
    }

    throw new Error('must throw BuildAbortError');
  });
});
