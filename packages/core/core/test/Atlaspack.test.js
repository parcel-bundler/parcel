// @flow strict-local

import type {InitialAtlaspackOptions} from '@atlaspack/types';
import WorkerFarm from '@atlaspack/workers';
// flowlint-next-line untyped-import:off
import sinon from 'sinon';
import assert from 'assert';
import path from 'path';
import Atlaspack, {createWorkerFarm} from '../src/Atlaspack';

describe('Atlaspack', function () {
  this.timeout(75000);

  let workerFarm;
  before(() => {
    workerFarm = createWorkerFarm();
  });

  after(() => workerFarm.end());

  it('does not initialize when passed an ending farm', async () => {
    workerFarm.ending = true;
    let atlaspack = createAtlaspack({workerFarm});

    // $FlowFixMe
    await assert.rejects(() => atlaspack.run(), {
      name: 'Error',
      message: 'Supplied WorkerFarm is ending',
    });

    workerFarm.ending = false;
  });

  describe('atlaspack.end()', () => {
    let endSpy;
    beforeEach(() => {
      endSpy = sinon.spy(WorkerFarm.prototype, 'end');
    });

    afterEach(() => {
      endSpy.restore();
    });

    it('ends any WorkerFarm it creates', async () => {
      let atlaspack = createAtlaspack();
      await atlaspack.run();
      assert.equal(endSpy.callCount, 1);
    });

    it('runs and constructs another farm for subsequent builds', async () => {
      let atlaspack = createAtlaspack();

      await atlaspack.run();
      await atlaspack.run();

      assert.equal(endSpy.callCount, 2);
    });

    it('does not end passed WorkerFarms', async () => {
      let atlaspack = createAtlaspack({workerFarm});
      await atlaspack.run();
      assert.equal(endSpy.callCount, 0);

      await workerFarm.end();
    });

    it('removes shared references it creates', async () => {
      let atlaspack = createAtlaspack({workerFarm});
      await atlaspack.run();

      assert.equal(workerFarm.sharedReferences.size, 0);
      assert.equal(workerFarm.sharedReferencesByValue.size, 0);
      await workerFarm.end();
    });
  });
});

describe('AtlaspackAPI', function () {
  this.timeout(75000);

  let workerFarm;
  beforeEach(() => {
    workerFarm = createWorkerFarm();
  });

  afterEach(() => workerFarm.end());

  describe('atlaspack.unstable_transform()', () => {
    it('should transform simple file', async () => {
      let atlaspack = createAtlaspack({workerFarm});
      let res = await atlaspack.unstable_transform({
        filePath: path.join(__dirname, 'fixtures/atlaspack/index.js'),
      });
      let code = await res[0].getCode();
      assert(code.includes(`exports.default = 'test'`));
    });

    it('should transform with standalone mode', async () => {
      let atlaspack = createAtlaspack({workerFarm});
      let res = await atlaspack.unstable_transform({
        filePath: path.join(__dirname, 'fixtures/atlaspack/other.js'),
        query: 'standalone=true',
      });
      let code = await res[0].getCode();

      assert(code.includes(`require("./index.js")`));
      assert(code.includes(`new URL("index.js", "file:" + __filename);`));
      assert(code.includes(`import('index.js')`));
    });
  });

  describe('atlaspack.resolve()', () => {
    it('should resolve dependencies', async () => {
      let atlaspack = createAtlaspack({workerFarm});
      let res = await atlaspack.unstable_resolve({
        specifier: './other',
        specifierType: 'esm',
        resolveFrom: path.join(__dirname, 'fixtures/atlaspack/index.js'),
      });

      assert.deepEqual(res, {
        filePath: path.join(__dirname, 'fixtures/atlaspack/other.js'),
        code: undefined,
        query: undefined,
        sideEffects: true,
      });
    });
  });
});

function createAtlaspack(opts?: InitialAtlaspackOptions) {
  return new Atlaspack({
    entries: [path.join(__dirname, 'fixtures/atlaspack/index.js')],
    logLevel: 'info',
    defaultConfig: path.join(
      path.dirname(require.resolve('@atlaspack/test-utils')),
      '.atlaspackrc-no-reporters',
    ),
    shouldDisableCache: true,
    ...opts,
  });
}
