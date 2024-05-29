// @flow
import * as napi from '@parcel/rust';

export class WorkerController {
  constructor() {
    napi.controllerWorkerSubscribe((_, e) => this.#onEvent(e));
  }

  async #onEvent(_event) {
    // coming soon
  }
}

export let workerController: WorkerController | null = null;

export const initWorkerController = (): void => {
  workerController = new WorkerController();
};
