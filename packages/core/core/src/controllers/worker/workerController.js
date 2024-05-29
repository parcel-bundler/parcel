// @flow
import * as napi from '@parcel/rust';

export class WorkerController {
  constructor() {
    napi.controllerWorkerSubscribe((_, e) => this.#on_event(e));
  }

  async #on_event(event) {
    console.log('hello', event);

    return {Ping: {}};
  }
}

export let workerController: WorkerController | null = null;

export const initWorkerController = (): void => {
  workerController = new WorkerController();
};
