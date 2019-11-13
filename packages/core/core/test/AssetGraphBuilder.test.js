// @flow strict-local

import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';

import {createWorkerFarm} from '../';
import AssetGraphBuilder from '../src/AssetGraphBuilder';
import {resolveParcelConfig} from '../src/loadParcelConfig';
import {DEFAULT_OPTIONS} from './utils';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const CONFIG_DIR = path.join(FIXTURES_DIR, 'config');

describe('AssetGraphBuilder', function() {
  // This depends on spinning up a WorkerFarm, which can take some time.
  this.timeout(20000);

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
    config = nullthrows(
      await resolveParcelConfig(path.join(CONFIG_DIR, 'index'), DEFAULT_OPTIONS)
    ).config;

    builder = new AssetGraphBuilder();
    await builder.init({
      name: 'test',
      options: DEFAULT_OPTIONS,
      config,
      entries: ['./module-b'],
      workerFarm
    });
  });

  it('creates an AssetGraphBuilder', () => {
    invariant(builder.assetGraph.nodes.has('entry_specifier:./module-b'));
  });
});
