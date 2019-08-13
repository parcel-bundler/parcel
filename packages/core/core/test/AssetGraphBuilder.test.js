// @flow strict-local

import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';

import {createWorkerFarm} from '../';
import AssetGraphBuilder from '../src/AssetGraphBuilder';
import {resolve} from '../src/loadParcelConfig';
import {createDependency} from '../src/Dependency';
import {createEnvironment} from '../src/Environment';
import {inputFS} from '@parcel/test-utils';
import {DEFAULT_OPTIONS} from './utils';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const CONFIG_DIR = path.join(FIXTURES_DIR, 'config');

const DEFAULT_ENV = createEnvironment({
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

describe('AssetGraphBuilder', () => {
  let config;
  let builder;
  let workerFarm;

  before(() => {
    workerFarm = createWorkerFarm();
  });

  after(async () => {
    await workerFarm.end();
  });

  beforeEach(async () => {
    config = nullthrows(await resolve(inputFS, path.join(CONFIG_DIR, 'index')))
      .config;

    builder = new AssetGraphBuilder();
    await builder.init({
      options: DEFAULT_OPTIONS,
      config,
      entries: ['./module-b'],
      targets: TARGETS,
      workerFarm
    });
  });

  it('creates an AssetGraphBuilder', async () => {
    invariant(
      builder.assetGraph.nodes.has(
        createDependency({
          moduleSpecifier: './module-b',
          env: DEFAULT_ENV
        }).id
      )
    );
  });
});
