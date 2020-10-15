// @flow strict-local

import type {InitialParcelOptions} from '@parcel/types';
import WorkerFarm from '@parcel/workers';
// flowlint-next-line untyped-import:off
import sinon from 'sinon';
import assert from 'assert';
import path from 'path';
import Parcel, {createWorkerFarm} from '../src/Parcel';

describe('Parcel', function() {
  this.timeout(40000);

  let workerFarm;
  before(() => {
    workerFarm = createWorkerFarm();
  });

  after(() => workerFarm.end());

  it('can run multiple times in a row', async () => {
    // let endSpy = sinon.spy(WorkerFarm.prototype, 'end');
    let parcel = createParcel();
    await parcel.run();
    await parcel.run();
    await parcel.end();
  });

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
    it('ends any WorkerFarm it creates', async () => {
      let endSpy = sinon.spy(WorkerFarm.prototype, 'end');
      let parcel = createParcel();
      await parcel.run();
      await parcel.end();
      assert.equal(endSpy.callCount, 1);
      endSpy.restore();
    });

    it('does not end passed WorkerFarms', async () => {
      let endSpy = sinon.spy(WorkerFarm.prototype, 'end');

      let parcel = createParcel({workerFarm});
      await parcel.run();
      assert.equal(endSpy.callCount, 0);
      endSpy.restore();

      await workerFarm.end();
    });

    it('removes shared references it creates', async () => {
      let parcel = createParcel({workerFarm});
      await parcel.run();
      assert(workerFarm.sharedReferences.size > 0);
      assert(workerFarm.sharedReferencesByValue.size > 0);

      await parcel.end();
      assert.equal(workerFarm.sharedReferences.size, 0);
      assert.equal(workerFarm.sharedReferencesByValue.size, 0);

      await workerFarm.end();
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
    ...opts,
  });
}
