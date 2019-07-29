// @flow strict-local

import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';

import AssetGraphBuilder from '../src/AssetGraphBuilder';
import {resolve} from '../src/loadParcelConfig';
import Dependency from '../src/Dependency';
import Environment from '../src/Environment';
import {inputFS, outputFS} from '@parcel/test-utils';

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
    env: DEFAULT_ENV,
    publicUrl: null
  }
];

const DEFAULT_OPTIONS = {
  cache: false,
  cacheDir: '.parcel-cache',
  entries: [],
  logLevel: 'none',
  rootDir: FIXTURES_DIR,
  targets: [],
  projectRoot: '',
  lockFile: undefined,
  inputFS,
  outputFS
};

describe('AssetGraphBuilder', () => {
  let config;
  let builder;
  beforeEach(async () => {
    config = nullthrows(await resolve(inputFS, path.join(CONFIG_DIR, 'index')))
      .config;

    builder = new AssetGraphBuilder();
    await builder.init({
      options: DEFAULT_OPTIONS,
      config,
      entries: ['./module-b'],
      targets: TARGETS
    });
  });

  it('creates an AssetGraphBuilder', async () => {
    invariant(
      builder.assetGraph.nodes.has(
        new Dependency({
          moduleSpecifier: './module-b',
          env: DEFAULT_ENV
        }).id
      )
    );
  });
});
