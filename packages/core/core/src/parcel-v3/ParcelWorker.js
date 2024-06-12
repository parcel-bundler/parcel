// @flow
import {parentPort} from 'worker_threads';
import * as napi from '@parcel/rust';

export class ParcelWorker {
  constructor() {
    napi.workerCallback(async (err, id, data, done) => {
      try {
        if (err) {
          done({Err: err});
          return;
        }
        done({Ok: (await this.#on_event(id, data)) ?? undefined});
      } catch (error) {
        done({Err: error});
      }
    });
    parentPort?.postMessage(null);
  }

  // eslint-disable-next-line no-unused-vars
  #on_event(id, data: any) {
    switch (id) {
      // Ping
      case 0:
        return;
      default:
        throw new Error('Unknown message');
    }
  }
}
