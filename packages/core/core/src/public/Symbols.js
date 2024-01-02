// @flow
import type {
  Symbol as ISymbol,
  MutableAssetSymbols as IMutableAssetSymbols,
  AssetSymbols as IAssetSymbols,
  MutableDependencySymbols as IMutableDependencySymbols,
  SourceLocation,
  Meta,
} from '@parcel/types';
import type {ParcelOptions} from '../types';
import type {AssetAddr, DependencyAddr} from '@parcel/rust';

import nullthrows from 'nullthrows';
import {fromInternalSourceLocation, toDbSourceLocation} from '../utils';
import {
  Dependency as DbDependency,
  DependencyFlags,
  Asset as DbAsset,
  AssetFlags,
  SymbolFlags,
  readCachedString,
} from '@parcel/rust';
import {createBuildCache} from '../buildCache';

const inspect = Symbol.for('nodejs.util.inspect.custom');

let valueToSymbols: Map<AssetAddr, AssetSymbols> = createBuildCache();
export class AssetSymbols implements IAssetSymbols {
  /*::
  @@iterator(): Iterator<[ISymbol, {|local: ISymbol, loc: ?SourceLocation, meta?: ?Meta|}]> { return ({}: any); }
  */
  #value: DbAsset;
  #options: ParcelOptions;

  constructor(options: ParcelOptions, asset: AssetAddr): AssetSymbols {
    let existing = valueToSymbols.get(asset);
    if (existing != null) {
      return existing;
    }

    this.#value = DbAsset.get(options.db, asset);
    this.#options = options;
    valueToSymbols.set(asset, this);
    return this;
  }

  hasExportSymbol(exportSymbol: ISymbol): boolean {
    let id = this.#options.db.getStringId(exportSymbol);
    return this.#value.symbols?.some(s => s.exported === id);
  }

  hasLocalSymbol(local: ISymbol): boolean {
    if (!(this.#value.flags & AssetFlags.HAS_SYMBOLS)) {
      return false;
    }
    let id = this.#options.db.getStringId(local);
    return this.#value.symbols.some(s => s.local === id);
  }

  get(
    exportSymbol: ISymbol,
  ): ?{|local: ISymbol, loc: ?SourceLocation, meta?: ?Meta|} {
    let id = this.#options.db.getStringId(exportSymbol);
    return fromInternalAssetSymbolDb(
      this.#options.db,
      this.#options.projectRoot,
      this.#value.symbols?.find(s => s.exported === id),
    );
  }

  get isCleared(): boolean {
    return !(this.#value.flags & AssetFlags.HAS_SYMBOLS);
  }

  exportSymbols(): Iterable<ISymbol> {
    return [...this.#value.symbols].map(s =>
      readCachedString(this.#options.db, s.exported),
    );
  }
  // $FlowFixMe
  *[Symbol.iterator]() {
    for (let s of this.#value.symbols) {
      yield [
        readCachedString(this.#options.db, s.exported),
        fromInternalAssetSymbolDb(
          this.#options.db,
          this.#options.projectRoot,
          s,
        ),
      ];
    }
  }

  // $FlowFixMe
  [inspect]() {
    return `AssetSymbols(${
      this.#value.symbols
        ? [...this.#value.symbols]
            .map(
              ({exported, local}) =>
                `${readCachedString(
                  this.#options.db,
                  exported,
                )}:${readCachedString(this.#options.db, local)}`,
            )
            .join(', ')
        : null
    })`;
  }
}

let valueToMutableAssetSymbols: Map<AssetAddr, MutableAssetSymbols> =
  createBuildCache();
export class MutableAssetSymbols implements IMutableAssetSymbols {
  /*::
  @@iterator(): Iterator<[ISymbol, {|local: ISymbol, loc: ?SourceLocation, meta?: ?Meta|}]> { return ({}: any); }
  */
  #value: DbAsset;
  #options: ParcelOptions;

  constructor(options: ParcelOptions, asset: AssetAddr): MutableAssetSymbols {
    let existing = valueToMutableAssetSymbols.get(asset);
    if (existing != null) {
      return existing;
    }
    this.#value = DbAsset.get(options.db, asset);
    this.#options = options;
    return this;
  }

  // immutable

  hasExportSymbol(exportSymbol: ISymbol): boolean {
    let id = this.#options.db.getStringId(exportSymbol);
    return this.#value.symbols?.some(s => s.exported === id);
  }

  hasLocalSymbol(local: ISymbol): boolean {
    if (!(this.#value.flags & AssetFlags.HAS_SYMBOLS)) {
      return false;
    }
    let id = this.#options.db.getStringId(local);
    return this.#value.symbols.some(s => s.local === id);
  }

  get(
    exportSymbol: ISymbol,
  ): ?{|local: ISymbol, loc: ?SourceLocation, meta?: ?Meta|} {
    let id = this.#options.db.getStringId(exportSymbol);
    return fromInternalAssetSymbolDb(
      this.#options.db,
      this.#options.projectRoot,
      this.#value.symbols?.find(s => s.exported === id),
    );
  }

  get isCleared(): boolean {
    return !(this.#value.flags & AssetFlags.HAS_SYMBOLS);
  }

  exportSymbols(): Iterable<ISymbol> {
    return [...this.#value.symbols].map(s =>
      readCachedString(this.#options.db, s.exported),
    );
  }

  // $FlowFixMe
  *[Symbol.iterator]() {
    for (let s of this.#value.symbols) {
      yield [
        readCachedString(this.#options.db, s.exported),
        fromInternalAssetSymbolDb(
          this.#options.db,
          this.#options.projectRoot,
          s,
        ),
      ];
    }
  }

  // $FlowFixMe
  [inspect]() {
    return `MutableAssetSymbols(${
      this.#value.symbols
        ? [...this.#value.symbols]
            .map(
              ({exported, local}) =>
                `${readCachedString(
                  this.#options.db,
                  exported,
                )}:${readCachedString(this.#options.db, local)}`,
            )
            .join(', ')
        : null
    })`;
  }

  // mutating

  ensure(): void {
    this.#value.flags |= AssetFlags.HAS_SYMBOLS;
  }

  set(
    exportSymbol: ISymbol,
    local: ISymbol,
    loc: ?SourceLocation,
    meta: ?Meta,
  ) {
    // nullthrows(this.#value.symbols).set(exportSymbol, {
    //   local,
    //   loc: toInternalSourceLocation(this.#options.projectRoot, loc),
    //   meta,
    // });
    let symbols = nullthrows(this.#value.symbols);
    let id = this.#options.db.getStringId(exportSymbol);
    let sym = symbols.find(s => s.exported === id);
    if (!sym) {
      sym = symbols.extend();
    }
    sym.local = this.#options.db.getStringId(local);
    sym.exported = id;
    sym.loc = toDbSourceLocation(
      this.#options.db,
      this.#options.projectRoot,
      loc,
    );
    sym.flags = meta?.isEsm === true ? SymbolFlags.IS_ESM : 0;
  }

  delete(exportSymbol: ISymbol) {
    let symbols = this.#value.symbols;
    let id = this.#options.db.getStringId(exportSymbol);
    let index = symbols.findIndex(s => s.exported === id);
    if (index !== -1) {
      symbols.delete(index);
    }
  }
}

let valueToMutableDependencySymbols: Map<
  DependencyAddr,
  MutableDependencySymbols,
> = createBuildCache();
export class MutableDependencySymbols implements IMutableDependencySymbols {
  /*::
  @@iterator(): Iterator<[ISymbol, {|local: ISymbol, loc: ?SourceLocation, isWeak: boolean, meta?: ?Meta|}]> { return ({}: any); }
  */
  #value: DbDependency;
  #options: ParcelOptions;

  constructor(
    options: ParcelOptions,
    dep: DependencyAddr,
  ): MutableDependencySymbols {
    let existing = valueToMutableDependencySymbols.get(dep);
    if (existing != null) {
      return existing;
    }
    this.#value = DbDependency.get(options.db, dep);
    this.#options = options;
    return this;
  }

  // immutable:

  hasExportSymbol(exportSymbol: ISymbol): boolean {
    let id = this.#options.db.getStringId(exportSymbol);
    return this.#value.symbols?.some(s => s.exported === id);
  }

  hasLocalSymbol(local: ISymbol): boolean {
    if (this.#value.flags & AssetFlags.HAS_SYMBOLS) {
      let id = this.#options.db.getStringId(local);
      return this.#value.symbols?.some(s => s.local === id);
    }
    return false;
  }

  get(
    exportSymbol: ISymbol,
  ): ?{|local: ISymbol, loc: ?SourceLocation, isWeak: boolean, meta?: ?Meta|} {
    let id = this.#options.db.getStringId(exportSymbol);
    return fromInternalDependencySymbol(
      this.#options.db,
      this.#options.projectRoot,
      nullthrows(this.#value.symbols).find(s => s.exported === id),
    );
  }

  get isCleared(): boolean {
    return !(this.#value.flags & DependencyFlags.HAS_SYMBOLS);
  }

  exportSymbols(): Iterable<ISymbol> {
    return [...this.#value.symbols].map(s =>
      readCachedString(this.#options.db, s.exported),
    );
  }

  // $FlowFixMe
  *[Symbol.iterator]() {
    let symbols = this.#value.symbols;
    if (symbols) {
      for (let sym of symbols) {
        yield [
          readCachedString(this.#options.db, sym.exported),
          fromInternalDependencySymbol(
            this.#options.db,
            this.#options.projectRoot,
            sym,
          ),
        ];
      }
    }
  }

  // $FlowFixMe
  [inspect]() {
    return `MutableDependencySymbols(${
      this.#value.symbols
        ? [...this.#value.symbols]
            .map(
              ({exported, local, flags}) =>
                `${readCachedString(
                  this.#options.db,
                  exported,
                )}:${readCachedString(this.#options.db, local)}${
                  flags & SymbolFlags.IS_WEAK ? '?' : ''
                }`,
            )
            .join(', ')
        : null
    })`;
  }

  // mutating:

  ensure(): void {
    this.#value.flags |= DependencyFlags.HAS_SYMBOLS;
  }

  set(
    exportSymbol: ISymbol,
    local: ISymbol,
    loc: ?SourceLocation,
    isWeak: ?boolean,
  ) {
    isWeak ??= false;
    let symbols = nullthrows(this.#value.symbols);
    let id = this.#options.db.getStringId(exportSymbol);
    let sym = symbols.find(s => s.exported === id);
    if (!sym) {
      sym = symbols.extend();
    } else {
      isWeak = !!(sym.flags & SymbolFlags.IS_WEAK) && isWeak;
    }
    sym.local = this.#options.db.getStringId(local);
    sym.exported = id;
    sym.flags = isWeak ? SymbolFlags.IS_WEAK : 0;
    sym.loc = toDbSourceLocation(
      this.#options.db,
      this.#options.projectRoot,
      loc,
    );
    // console.log('set symbol', sym, local, exportSymbol);
    // symbols.set(exportSymbol, {
    //   local,
    //   loc: toInternalSourceLocation(this.#options.projectRoot, loc),
    //   isWeak: (symbols.get(exportSymbol)?.isWeak ?? true) && (isWeak ?? false),
    // });
  }

  delete(exportSymbol: ISymbol) {
    let symbols = this.#value.symbols;
    let id = this.#options.db.getStringId(exportSymbol);
    let index = symbols.findIndex(s => s.exported === id);
    if (index !== -1) {
      symbols.delete(index);
    }
  }
}

function fromInternalAssetSymbolDb(db, projectRoot: string, value) {
  return (
    value && {
      local: readCachedString(db, value.local),
      meta: {
        isEsm: !!(value.flags & SymbolFlags.IS_ESM),
      },
      loc: fromInternalSourceLocation(projectRoot, value.loc),
    }
  );
}

function fromInternalDependencySymbol(db, projectRoot: string, value) {
  return (
    value && {
      local: readCachedString(db, value.local),
      meta: {
        isEsm: !!(value.flags & SymbolFlags.IS_ESM),
      },
      isWeak: !!(value.flags & SymbolFlags.IS_WEAK),
      loc: fromInternalSourceLocation(projectRoot, value.loc),
    }
  );
}
