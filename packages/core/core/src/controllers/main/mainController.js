// @flow
import * as napi from '@parcel/rust';

export class MainController {
  constructor() {
    napi.controllerMainSubscribe((_, e) => this.#onEvent(e));
  }

  async #onEvent(_event) {
    // coming soon
  }
}

export let mainController: MainController | null = null;

export const initMainController = (): void => {
  mainController = new MainController();
};
