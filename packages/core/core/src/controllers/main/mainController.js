// @flow
import * as napi from '@parcel/rust';

export class MainController {
  constructor() {
    napi.controllerMainSubscribe((_, e) => this.#on_event(e));
  }

  async #on_event(event) {
    console.log('hello', event);

    return {Ping: {}};
  }

  #emit(v) {
    return napi.controllerMainEmit(v);
  }

  assetGraphRequest() {}
}

export let mainController: MainController | null = null;

export const initMainController = (): void => {
  mainController = new MainController();
};
