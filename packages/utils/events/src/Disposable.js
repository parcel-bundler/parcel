// @flow strict-local

import type {IDisposable} from './types';

import invariant from 'assert';
import {AlreadyDisposedError} from './errors';

type DisposableLike = IDisposable | (() => mixed);

/*
 * A general-purpose disposable class. It can normalize disposable-like values
 * (such as single functions or IDisposables), as well as hold multiple
 * disposable-like values to be disposed of at once.
 */
export default class Disposable implements IDisposable {
  disposed: boolean = false;
  #disposables; // ?Set<DisposableLike>

  constructor(...disposables: Array<DisposableLike>) {
    this.#disposables = new Set(disposables);
  }

  add(...disposables: Array<DisposableLike>): void {
    if (this.disposed) {
      throw new AlreadyDisposedError(
        'Cannot add new disposables after disposable has been disposed'
      );
    }

    invariant(this.#disposables != null);
    for (let disposable of disposables) {
      this.#disposables.add(disposable);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    invariant(this.#disposables != null);
    for (let disposable of this.#disposables) {
      if (typeof disposable === 'function') {
        disposable();
      } else {
        disposable.dispose();
      }
    }

    this.#disposables = null;
    this.disposed = true;
  }
}
