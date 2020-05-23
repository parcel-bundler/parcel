// @flow
import type {
  CodeSymbol,
  MutableCodeSymbols as IMutableCodeSymbols,
  CodeSymbols as ICodeSymbols,
  SourceLocation,
} from '@parcel/types';
import type {Asset, Dependency} from '../types';

import nullthrows from 'nullthrows';

const EMPTY_ITERATOR = {
  next() {
    return {done: true};
  },
};

let valueToSymbols: WeakMap<Asset, Symbols> = new WeakMap();

export class Symbols implements ICodeSymbols {
  /*::
  @@iterator(): Iterator<[CodeSymbol, {|local: CodeSymbol, loc: ?SourceLocation|}]> { return ({}: any); }
  */
  #value; // Asset

  constructor(asset: Asset) {
    let existing = valueToSymbols.get(asset);
    if (existing != null) {
      return existing;
    }

    this.#value = asset;
    valueToSymbols.set(asset, this);
  }

  get(exportSymbol: CodeSymbol): ?{|local: CodeSymbol, loc: ?SourceLocation|} {
    return this.#value.symbols?.get(exportSymbol);
  }

  hasExportSymbol(exportSymbol: CodeSymbol): boolean {
    return Boolean(this.#value.symbols?.has(exportSymbol));
  }

  hasLocalSymbol(local: CodeSymbol): boolean {
    if (this.#value.symbols) {
      for (let s of this.#value.symbols.values()) {
        if (local === s.local) return true;
      }
    }
    return false;
  }

  // $FlowFixMe
  [Symbol.iterator]() {
    return this.#value.symbols
      ? this.#value.symbols[Symbol.iterator]()
      : EMPTY_ITERATOR;
  }

  get isCleared() {
    return this.#value.symbols == null;
  }
}

let valueToMutableSymbols: WeakMap<
  Asset | Dependency,
  MutableSymbols,
> = new WeakMap();

class MutableSymbols {
  /*::
  @@iterator(): Iterator<[CodeSymbol, {|local: CodeSymbol, loc: ?SourceLocation|}]> { return ({}: any); }
  */
  #value; // Asset

  constructor(asset: Asset | Dependency) {
    this.#value = asset;
  }

  set(exportSymbol: CodeSymbol, local: CodeSymbol, loc: ?SourceLocation) {
    nullthrows(
      this.#value.symbols,
      'Cannot set symbol on cleared Symbols',
    ).set(exportSymbol, {local, loc});
  }

  get(exportSymbol: CodeSymbol): ?{|local: CodeSymbol, loc: ?SourceLocation|} {
    return this.#value.symbols?.get(exportSymbol);
  }

  hasExportSymbol(exportSymbol: CodeSymbol): boolean {
    return Boolean(this.#value.symbols?.has(exportSymbol));
  }

  hasLocalSymbol(local: CodeSymbol): boolean {
    if (this.#value.symbols) {
      for (let s of this.#value.symbols.values()) {
        if (local === s.local) return true;
      }
    }
    return false;
  }

  // $FlowFixMe
  [Symbol.iterator]() {
    return this.#value.symbols
      ? this.#value.symbols[Symbol.iterator]()
      : EMPTY_ITERATOR;
  }

  get isCleared() {
    return this.#value.symbols == null;
  }
}

export class MutableDependencySymbols extends MutableSymbols
  implements IMutableCodeSymbols {
  #dependency; // Dependency
  constructor(dependency: Dependency) {
    let existing = valueToMutableSymbols.get(dependency);
    if (existing != null) {
      return ((existing: any): MutableDependencySymbols);
    }

    super(dependency);
    this.#dependency = dependency;
  }

  clear() {
    this.#dependency.symbols.clear();
  }
}

export class MutableAssetSymbols extends MutableSymbols
  implements IMutableCodeSymbols {
  #asset; // Asset
  constructor(asset: Asset) {
    super(asset);
    let existing = valueToMutableSymbols.get(asset);
    if (existing != null) {
      return ((existing: any): MutableAssetSymbols);
    }

    this.#asset = asset;
  }

  clear() {
    this.#asset.symbols = null;
  }
}
