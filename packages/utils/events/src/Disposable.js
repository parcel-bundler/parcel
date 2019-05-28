// @flow strict-local

import type {IDisposable} from './types';

type DisposableLike = IDisposable | (() => mixed);

/*
 * A general-purpose disposable class. It can normalize disposable-like values
 * (such as single functions or IDisposables), as well as hold multiple
 * disposable-like values to be disposed of at once.
 */
export default class Disposable implements IDisposable {
  #disposables; // Set<DisposableLike>

  constructor(...disposables: Array<DisposableLike>) {
    this.#disposables = new Set(disposables);
  }

  add(...disposables: Array<DisposableLike>) {
    for (let disposable of disposables) {
      this.#disposables.add(disposable);
    }
  }

  dispose() {
    for (let disposable of this.#disposables) {
      if (typeof disposable === 'function') {
        disposable();
      } else {
        disposable.dispose();
      }
    }
  }
}
