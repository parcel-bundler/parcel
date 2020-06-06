// @flow
import type {
  Symbol as ISymbol,
  MutableSymbols as IMutableSymbols,
  Symbols as ISymbols,
  SourceLocation,
} from '@parcel/types';
import type {Asset, Dependency} from '../types';

import nullthrows from 'nullthrows';

const EMPTY_ITERABLE = {
  [Symbol.iterator]() {
    return EMPTY_ITERATOR;
  },
};

const EMPTY_ITERATOR = {
  next() {
    return {done: true};
  },
};

let valueToSymbols: WeakMap<Asset, Symbols> = new WeakMap();

export class Symbols implements ISymbols {
  /*::
  @@iterator(): Iterator<[ISymbol, {|local: ISymbol, loc: ?SourceLocation|}]> { return ({}: any); }
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

  get(exportSymbol: ISymbol): ?{|local: ISymbol, loc: ?SourceLocation|} {
    return this.#value.symbols?.get(exportSymbol);
  }

  hasExportSymbol(exportSymbol: ISymbol): boolean {
    return Boolean(this.#value.symbols?.has(exportSymbol));
  }

  hasLocalSymbol(local: ISymbol): boolean {
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

  exportSymbols(): Iterable<ISymbol> {
    // $FlowFixMe
    return this.#value.symbols ? this.#value.symbols.keys() : EMPTY_ITERABLE;
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
  @@iterator(): Iterator<[ISymbol, {|local: ISymbol, loc: ?SourceLocation|}]> { return ({}: any); }
  */
  #value: Asset | Dependency;

  constructor(asset: Asset | Dependency) {
    this.#value = asset;
  }

  set(exportSymbol: ISymbol, local: ISymbol, loc: ?SourceLocation) {
    nullthrows(
      this.#value.symbols,
      'Cannot set symbol on cleared Symbols',
    ).set(exportSymbol, {local, loc});
  }

  get(exportSymbol: ISymbol): ?{|local: ISymbol, loc: ?SourceLocation|} {
    return this.#value.symbols?.get(exportSymbol);
  }

  hasExportSymbol(exportSymbol: ISymbol): boolean {
    return Boolean(this.#value.symbols?.has(exportSymbol));
  }

  hasLocalSymbol(local: ISymbol): boolean {
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

  exportSymbols(): Iterable<ISymbol> {
    // $FlowFixMe
    return this.#value.symbols ? this.#value.symbols.keys() : EMPTY_ITERABLE;
  }

  get isCleared() {
    return this.#value.symbols == null;
  }
}

export class MutableDependencySymbols extends MutableSymbols
  implements IMutableSymbols {
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
  implements IMutableSymbols {
  #asset: Asset;
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
