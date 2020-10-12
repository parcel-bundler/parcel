// @flow strict-local

import invariant from 'assert';

import {createWorkerFarm} from '../';
import AssetGraphBuilder from '../src/AssetGraphBuilder';
import {DEFAULT_OPTIONS} from './test-utils';

describe('AssetGraphBuilder', function() {
  // This depends on spinning up a WorkerFarm, which can take some time.
  // ATLASSIAN: Use a longer timeout to shut down workers in pipelines
  this.timeout(40000);

  let builder;
  let workerFarm;

  before(() => {
    workerFarm = createWorkerFarm();
  });

  after(async () => {
    await workerFarm.end();
  });

  beforeEach(async () => {
    builder = new AssetGraphBuilder();
    await builder.init({
      name: 'test',
      options: DEFAULT_OPTIONS,
      // $FlowFixMe opaque type
      optionsRef: 1,
      entries: ['./module-b'],
      workerFarm,
    });
  });

  it('creates an AssetGraphBuilder', () => {
    invariant(builder.assetGraph.nodes.has('entry_specifier:./module-b'));
  });
});
