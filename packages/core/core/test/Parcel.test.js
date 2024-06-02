// @flow strict-local

import type {InitialParcelOptions} from '@parcel/types';
import WorkerFarm from '@parcel/workers';
// flowlint-next-line untyped-import:off
import sinon from 'sinon';
import assert from 'assert';
import path from 'path';
import Parcel, {createWorkerFarm} from '../src/Parcel';

describe('Parcel', function () {
  this.timeout(75000);

  let workerFarm;
  before(() => {
    workerFarm = createWorkerFarm();
  });

  after(() => workerFarm.end());

  it('does not initialize when passed an ending farm', async () => {
    workerFarm.ending = true;
    let parcel = createParcel({workerFarm});

    // $FlowFixMe
    await assert.rejects(() => parcel.run(), {
      name: 'Error',
      message: 'Supplied WorkerFarm is ending',
    });

    workerFarm.ending = false;
  });

  describe('parcel.end()', () => {
    let endSpy;
    beforeEach(() => {
      endSpy = sinon.spy(WorkerFarm.prototype, 'end');
    });

    afterEach(() => {
      endSpy.restore();
    });

    it('ends any WorkerFarm it creates', async () => {
      let parcel = createParcel();
      await parcel.run();
      assert.equal(endSpy.callCount, 1);
    });

    it('runs and constructs another farm for subsequent builds', async () => {
      let parcel = createParcel();

      await parcel.run();
      await parcel.run();

      assert.equal(endSpy.callCount, 2);
    });

    it('does not end passed WorkerFarms', async () => {
      let parcel = createParcel({workerFarm});
      await parcel.run();
      assert.equal(endSpy.callCount, 0);

      await workerFarm.end();
    });

    it('removes shared references it creates', async () => {
      let parcel = createParcel({workerFarm});
      await parcel.run();

      assert.equal(workerFarm.sharedReferences.size, 0);
      assert.equal(workerFarm.sharedReferencesByValue.size, 0);
      await workerFarm.end();
    });
  });
});

describe('ParcelAPI', function () {
  this.timeout(75000);

  let workerFarm;
  beforeEach(() => {
    workerFarm = createWorkerFarm();
  });

  afterEach(() => workerFarm.end());

  describe('parcel.unstable_transform()', () => {
    it('should transform simple file', async () => {
      let parcel = createParcel({workerFarm});
      let res = await parcel.unstable_transform({
        filePath: path.join(__dirname, 'fixtures/parcel/index.js'),
      });
      let code = await res[0].getCode();
      assert(code.includes(`exports.default = 'test'`));
    });

    it('should transform with standalone mode', async () => {
      let parcel = createParcel({workerFarm});
      let res = await parcel.unstable_transform({
        filePath: path.join(__dirname, 'fixtures/parcel/other.js'),
        query: 'standalone=true',
      });
      let code = await res[0].getCode();

      assert(code.includes(`require("./index.js")`));
      assert(code.includes(`new URL("index.js", "file:" + __filename);`));
      assert(code.includes(`import('index.js')`));
    });
  });

  describe('parcel.resolve()', () => {
    it('should resolve dependencies', async () => {
      let parcel = createParcel({workerFarm});
      let res = await parcel.unstable_resolve({
        specifier: './other',
        specifierType: 'esm',
        resolveFrom: path.join(__dirname, 'fixtures/parcel/index.js'),
      });

      assert.deepEqual(res, {
        filePath: path.join(__dirname, 'fixtures/parcel/other.js'),
        code: undefined,
        query: undefined,
        sideEffects: true,
      });
    });
  });
});

function createParcel(opts?: InitialParcelOptions) {
  return new Parcel({
    entries: [path.join(__dirname, 'fixtures/parcel/index.js')],
    logLevel: 'info',
    defaultConfig: path.join(
      path.dirname(require.resolve('@parcel/test-utils')),
      '.parcelrc-no-reporters',
    ),
    shouldDisableCache: true,
    ...opts,
  });
}
