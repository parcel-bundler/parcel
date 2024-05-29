// @flow
import * as napi from '@parcel/rust';

export class ParcelNativeWorker {
  constructor() {
    napi.workerBootstrap((_, e) => this.#onEvent(e));
  }

  async #onEvent(event: any) {
    // handle events, e.g.
    // If event === "run resolver"
  }
}

// Using a singleton for now to avoid causing a mess with prop drilling
export let parcelNativeWorker: null | ParcelNativeWorker = null;

export const initParcelNativeWorker = () => {
  parcelNativeWorker = new ParcelNativeWorker();
};
