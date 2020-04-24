// @flow
import type {
  Symbol,
  MutableSymbols as IMutableSymbols,
  Symbols as ISymbols,
  SourceLocation,
} from '@parcel/types';

let parcelSymbolsToSymbols: WeakMap<
  Map<Symbol, {|local: Symbol, loc: ?SourceLocation|}>,
  Symbols,
> = new WeakMap();

export class Symbols implements ISymbols {
  #symbols; // Map<Symbol, {|local: Symbol, loc: ?SourceLocation|}>

  constructor(symbols: Map<Symbol, {|local: Symbol, loc: ?SourceLocation|}>) {
    let existing = parcelSymbolsToSymbols.get(symbols);
    if (existing != null) {
      return existing;
    }

    this.#symbols = symbols;
    parcelSymbolsToSymbols.set(symbols, this);
  }

  get(exportSymbol: Symbol): ?{|local: Symbol, loc: ?SourceLocation|} {
    return this.#symbols.get(exportSymbol);
  }

  hasExportSymbol(exportSymbol: Symbol): boolean {
    return this.#symbols.has(exportSymbol);
  }

  hasLocalSymbol(local: Symbol): boolean {
    for (let s of this.#symbols.values()) {
      if (local === s.local) return true;
    }
    return false;
  }

  getAll(): $ReadOnlyMap<Symbol, {|local: Symbol, loc: ?SourceLocation|}> {
    return this.#symbols;
  }
}

let parcelSymbolsToMutableSymbols: WeakMap<
  Map<Symbol, {|local: Symbol, loc: ?SourceLocation|}>,
  MutableSymbols,
> = new WeakMap();

export class MutableSymbols implements IMutableSymbols {
  #symbols; // Map<Symbol, {|local: Symbol, loc: ?SourceLocation|}>

  constructor(symbols: Map<Symbol, {|local: Symbol, loc: ?SourceLocation|}>) {
    let existing = parcelSymbolsToMutableSymbols.get(symbols);
    if (existing != null) {
      return existing;
    }

    this.#symbols = symbols;
    parcelSymbolsToMutableSymbols.set(symbols, this);
  }

  set(exportSymbol: Symbol, local: Symbol, loc: ?SourceLocation) {
    this.#symbols.set(exportSymbol, {local, loc});
  }

  clear() {
    this.#symbols.clear();
  }

  get(exportSymbol: Symbol): ?{|local: Symbol, loc: ?SourceLocation|} {
    return this.#symbols.get(exportSymbol);
  }

  hasExportSymbol(exportSymbol: Symbol): boolean {
    return this.#symbols.has(exportSymbol);
  }

  hasLocalSymbol(local: Symbol): boolean {
    for (let s of this.#symbols.values()) {
      if (local === s.local) return true;
    }
    return false;
  }

  getAll(): $ReadOnlyMap<Symbol, {|local: Symbol, loc: ?SourceLocation|}> {
    return this.#symbols;
  }
}
