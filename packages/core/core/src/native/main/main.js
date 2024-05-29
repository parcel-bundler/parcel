// @flow
import * as napi from '@parcel/rust';

export class ParcelNative {
  constructor() {
    napi.mainBootstrap((_, e) => this.#onEvent(e));
  }

  // eslint-disable-next-line no-unused-vars
  async #onEvent(_event: any) {
    // handle events, e.g.
    // If event === "spawn worker"
  }
}

// Using a singleton for now to avoid causing a mess with prop drilling
export let parcelNative: null | ParcelNative = null;

export const initParcelNative = () => {
  parcelNative = new ParcelNative();
};
