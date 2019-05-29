// @flow strict-local

import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';

import AssetGraphBuilder from '../src/AssetGraphBuilder';
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
  targets: [],
  projectRoot: ''
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
      builder.assetGraph.nodes.has(
        new Dependency({
          moduleSpecifier: './module-b',
          env: DEFAULT_ENV
        }).id
      )
    );
  });
});
