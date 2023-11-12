// @flow
import {ParcelDb} from '../index';

let heapSymbol = global.Symbol('heap');
let heapU32Symbol = global.Symbol('heapU32');
let stringCacheSymbol = global.Symbol('stringCache');

// $FlowFixMe
ParcelDb.deserialize = serialized => {
  // $FlowFixMe
  let res = ParcelDb.deserializeNative(serialized);
  init(res);
  return res;
};

// $FlowFixMe
ParcelDb.create = options => {
  let db = new ParcelDb(options);
  init(db);
  return db;
};

// $FlowFixMe
ParcelDb.read = (filename, options) => {
  // $FlowFixMe
  let db = ParcelDb._read(filename, options);
  init(db);
  return db;
};

// $FlowFixMe
ParcelDb.fromBuffer = (buffer, options) => {
  // $FlowFixMe
  let db = ParcelDb._fromBuffer(buffer, options);
  init(db);
  return db;
};

function init(db: ParcelDb) {
  db[heapSymbol] = [];
  db[heapU32Symbol] = [];
  db[stringCacheSymbol] = new Map();
  db.starSymbol = db.getStringId('*');
  db.defaultSymbol = db.getStringId('default');
}

const PAGE_INDEX_SIZE = 16;
const PAGE_INDEX_SHIFT = 32 - PAGE_INDEX_SIZE;
const PAGE_INDEX_MASK = ((1 << PAGE_INDEX_SIZE) - 1) << PAGE_INDEX_SHIFT;
const PAGE_OFFSET_MASK = (1 << PAGE_INDEX_SHIFT) - 1;

function copy(db: ParcelDb, from: number, to: number, size: number) {
  let fromPage = (from & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let fromOffset = from & PAGE_OFFSET_MASK;
  let heap = db[heapSymbol];
  let fromHeapPage = (heap[fromPage] ??= db.getPage(fromPage));
  let toPage = (to & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let toOffset = to & PAGE_OFFSET_MASK;
  let toHeapPage = (heap[toPage] ??= db.getPage(toPage));
  toHeapPage.set(
    fromHeapPage.subarray(fromOffset, fromOffset + size),
    toOffset,
  );
}

function readU8(db: ParcelDb, addr: number): number {
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heap = db[heapSymbol];
  let heapPage = (heap[page] ??= db.getPage(page));
  return heapPage[offset];
}

function writeU8(db: ParcelDb, addr: number, value: number) {
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heap = db[heapSymbol];
  let heapPage = (heap[page] ??= db.getPage(page));
  return (heapPage[offset] = value);
}

function readU32(db: ParcelDb, addr: number): number {
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heap = db[heapSymbol];
  let heap_u32 = db[heapU32Symbol];
  let heapPage = (heap_u32[page] ??= new Uint32Array(
    (heap[page] ??= db.getPage(page)).buffer,
  ));
  return heapPage[offset >> 2];
}

function writeU32(db: ParcelDb, addr: number, value: number) {
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heap = db[heapSymbol];
  let heap_u32 = db[heapU32Symbol];
  let heapPage = (heap_u32[page] ??= new Uint32Array(
    (heap[page] ??= db.getPage(page)).buffer,
  ));
  return (heapPage[offset >> 2] = value);
}

export function readCachedString(db: ParcelDb, addr: number): string {
  let stringCache = db[stringCacheSymbol];
  let v = stringCache.get(addr);
  if (v != null) return v;
  v = db.readString(addr);
  stringCache.set(addr, v);
  return v;
}

interface TypeAccessor<T> {
  typeId: number;
  get(db: ParcelDb, addr: number): T;
  set(db: ParcelDb, addr: number, value: T): void;
}

class Vec<T> {
  db: ParcelDb;
  addr: number;
  size: number;
  accessor: TypeAccessor<T>;
  /*::
  @@iterator(): Iterator<T> { return ({}: any); }
  */

  constructor(
    db: ParcelDb,
    addr: number,
    size: number,
    accessor: TypeAccessor<T>,
  ) {
    this.db = db;
    this.addr = addr;
    this.size = size;
    this.accessor = accessor;
  }

  get length(): number {
    return readU32(this.db, this.addr + 4);
  }

  get capacity(): number {
    return readU32(this.db, this.addr + 8);
  }

  get(index: number): T {
    let bufAddr = readU32(this.db, this.addr + 0);
    return this.accessor.get(this.db, bufAddr + index * this.size);
  }

  set(index: number, value: T): void {
    if (index >= this.length) {
      throw new Error(`Index out of bounds: ${index} >= ${this.length}`);
    }
    let bufAddr = readU32(this.db, this.addr + 0);
    this.accessor.set(this.db, bufAddr + index * this.size, value);
  }

  reserve(count: number): void {
    if (this.length + count > this.capacity) {
      this.db.extendVec(this.accessor.typeId, this.addr, count);
    }
  }

  push(value: T): void {
    this.reserve(1);
    writeU32(this.db, this.addr + 4, readU32(this.db, this.addr + 4) + 1);
    this.set(this.length - 1, value);
  }

  extend(): T {
    this.reserve(1);
    writeU32(this.db, this.addr + 4, readU32(this.db, this.addr + 4) + 1);
    return this.get(this.length - 1);
  }

  clear(): void {
    // TODO: run Rust destructors?
    writeU32(this.db, this.addr + 4, 0);
  }

  init(): void {
    writeU32(this.db, this.addr + 4, 0);
    writeU32(this.db, this.addr + 8, 0);
    writeU32(this.db, this.addr + 0, 0);
  }

  copyFrom(from: Vec<T>): void {
    this.clear();
    this.reserve(from.length);
    let fromAddr = readU32(this.db, from.addr + 0);
    let toAddr = readU32(this.db, this.addr + 0);
    copy(this.db, fromAddr, toAddr, from.length * this.size);
    writeU32(this.db, this.addr + 4, from.length);
  }

  // $FlowFixMe
  *[globalThis.Symbol.iterator]() {
    let addr = readU32(this.db, this.addr + 0);
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {
      yield this.accessor.get(this.db, addr);
    }
  }

  find(pred: (value: T) => mixed): ?T {
    let addr = readU32(this.db, this.addr + 0);
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {
      let value = this.accessor.get(this.db, addr);
      if (pred(value)) {
        return value;
      }
    }
  }

  some(pred: (value: T) => mixed): boolean {
    let addr = readU32(this.db, this.addr + 0);
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {
      let value = this.accessor.get(this.db, addr);
      if (pred(value)) {
        return true;
      }
    }
    return false;
  }

  every(pred: (value: T) => mixed): boolean {
    let addr = readU32(this.db, this.addr + 0);
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {
      let value = this.accessor.get(this.db, addr);
      if (!pred(value)) {
        return false;
      }
    }
    return true;
  }
}

export opaque type TargetAddr = number;

export class Target {
  static typeId: number = 10;
  db: ParcelDb;
  addr: TargetAddr;

  constructor(db: ParcelDb, addr?: TargetAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(10);
  }

  static get(db: ParcelDb, addr: TargetAddr): Target {
    return new Target(db, addr);
  }

  static set(db: ParcelDb, addr: TargetAddr, value: Target): void {
    copy(db, value.addr, addr, 44);
  }

  dealloc() {
    this.db.dealloc(10, this.addr);
  }

  get env(): EnvironmentAddr {
    return readU32(this.db, this.addr + 28);
  }

  set env(value: EnvironmentAddr): void {
    writeU32(this.db, this.addr + 28, value);
  }

  get distDir(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 32));
  }

  set distDir(value: string): void {
    writeU32(this.db, this.addr + 32, this.db.getStringId(value));
  }

  get distEntry(): ?string {
    return readU32(this.db, this.addr + 0 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 0));
  }

  set distEntry(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 0 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 0, this.db.getStringId(value));
    }
  }

  get name(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 36));
  }

  set name(value: string): void {
    writeU32(this.db, this.addr + 36, this.db.getStringId(value));
  }

  get publicUrl(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 40));
  }

  set publicUrl(value: string): void {
    writeU32(this.db, this.addr + 40, this.db.getStringId(value));
  }

  get loc(): ?SourceLocation {
    return readU32(this.db, this.addr + 4 + 16) === 0
      ? null
      : SourceLocation.get(this.db, this.addr + 4);
  }

  set loc(value: ?SourceLocation): void {
    if (value == null) {
      writeU32(this.db, this.addr + 4 + 16, 0);
    } else {
      SourceLocation.set(this.db, this.addr + 4, value);
    }
  }

  get pipeline(): ?string {
    return readU32(this.db, this.addr + 24 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 24));
  }

  set pipeline(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 24 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 24, this.db.getStringId(value));
    }
  }
}

export opaque type EnvironmentAddr = number;

export class Environment {
  static typeId: number = 5;
  db: ParcelDb;
  addr: EnvironmentAddr;

  constructor(db: ParcelDb, addr?: EnvironmentAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(5);
  }

  static get(db: ParcelDb, addr: EnvironmentAddr): Environment {
    return new Environment(db, addr);
  }

  static set(db: ParcelDb, addr: EnvironmentAddr, value: Environment): void {
    copy(db, value.addr, addr, 60);
  }

  dealloc() {
    this.db.dealloc(5, this.addr);
  }

  get context(): EnvironmentContextVariants {
    return EnvironmentContext.get(this.db, this.addr + 57);
  }

  set context(value: EnvironmentContextVariants): void {
    EnvironmentContext.set(this.db, this.addr + 57, value);
  }

  get outputFormat(): OutputFormatVariants {
    return OutputFormat.get(this.db, this.addr + 58);
  }

  set outputFormat(value: OutputFormatVariants): void {
    OutputFormat.set(this.db, this.addr + 58, value);
  }

  get sourceType(): SourceTypeVariants {
    return SourceType.get(this.db, this.addr + 59);
  }

  set sourceType(value: SourceTypeVariants): void {
    SourceType.set(this.db, this.addr + 59, value);
  }

  get flags(): number {
    return readU8(this.db, this.addr + 56);
  }

  set flags(value: number): void {
    writeU8(this.db, this.addr + 56, value);
  }

  get sourceMap(): ?TargetSourceMapOptions {
    return readU8(this.db, this.addr + 24 + 4) === 2
      ? null
      : TargetSourceMapOptions.get(this.db, this.addr + 24);
  }

  set sourceMap(value: ?TargetSourceMapOptions): void {
    if (value == null) {
      writeU8(this.db, this.addr + 24 + 4, 2);
    } else {
      TargetSourceMapOptions.set(this.db, this.addr + 24, value);
    }
  }

  get loc(): ?SourceLocation {
    return readU32(this.db, this.addr + 32 + 16) === 0
      ? null
      : SourceLocation.get(this.db, this.addr + 32);
  }

  set loc(value: ?SourceLocation): void {
    if (value == null) {
      writeU32(this.db, this.addr + 32 + 16, 0);
    } else {
      SourceLocation.set(this.db, this.addr + 32, value);
    }
  }

  get includeNodeModules(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 52));
  }

  set includeNodeModules(value: string): void {
    writeU32(this.db, this.addr + 52, this.db.getStringId(value));
  }

  get engines(): Engines {
    return Engines.get(this.db, this.addr + 0);
  }

  set engines(value: Engines): void {
    Engines.set(this.db, this.addr + 0, value);
  }
}

export opaque type EnginesAddr = number;

export class Engines {
  static typeId: number = 4;
  db: ParcelDb;
  addr: EnginesAddr;

  constructor(db: ParcelDb, addr?: EnginesAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(4);
  }

  static get(db: ParcelDb, addr: EnginesAddr): Engines {
    return new Engines(db, addr);
  }

  static set(db: ParcelDb, addr: EnginesAddr, value: Engines): void {
    copy(db, value.addr, addr, 24);
  }

  dealloc() {
    this.db.dealloc(4, this.addr);
  }

  get browsers(): Vec<string> {
    return new Vec(this.db, this.addr + 0, 4, InternedString);
  }

  set browsers(value: Vec<string>): void {
    copy(this.db, value.addr, this.addr + 0, 12);
  }

  get electron(): ?string {
    return readU32(this.db, this.addr + 12 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 12));
  }

  set electron(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 12 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 12, this.db.getStringId(value));
    }
  }

  get node(): ?string {
    return readU32(this.db, this.addr + 16 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 16));
  }

  set node(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 16 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 16, this.db.getStringId(value));
    }
  }

  get parcel(): ?string {
    return readU32(this.db, this.addr + 20 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 20));
  }

  set parcel(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 20 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 20, this.db.getStringId(value));
    }
  }
}

export opaque type TargetSourceMapOptionsAddr = number;

export class TargetSourceMapOptions {
  static typeId: number = 11;
  db: ParcelDb;
  addr: TargetSourceMapOptionsAddr;

  constructor(db: ParcelDb, addr?: TargetSourceMapOptionsAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(11);
  }

  static get(
    db: ParcelDb,
    addr: TargetSourceMapOptionsAddr,
  ): TargetSourceMapOptions {
    return new TargetSourceMapOptions(db, addr);
  }

  static set(
    db: ParcelDb,
    addr: TargetSourceMapOptionsAddr,
    value: TargetSourceMapOptions,
  ): void {
    copy(db, value.addr, addr, 8);
  }

  dealloc() {
    this.db.dealloc(11, this.addr);
  }

  get sourceRoot(): ?string {
    return readU32(this.db, this.addr + 0 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 0));
  }

  set sourceRoot(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 0 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 0, this.db.getStringId(value));
    }
  }

  get inline(): boolean {
    return !!readU8(this.db, this.addr + 4);
  }

  set inline(value: boolean): void {
    writeU8(this.db, this.addr + 4, value ? 1 : 0);
  }

  get inlineSources(): boolean {
    return !!readU8(this.db, this.addr + 5);
  }

  set inlineSources(value: boolean): void {
    writeU8(this.db, this.addr + 5, value ? 1 : 0);
  }
}

export opaque type SourceLocationAddr = number;

export class SourceLocation {
  static typeId: number = 8;
  db: ParcelDb;
  addr: SourceLocationAddr;

  constructor(db: ParcelDb, addr?: SourceLocationAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(8);
  }

  static get(db: ParcelDb, addr: SourceLocationAddr): SourceLocation {
    return new SourceLocation(db, addr);
  }

  static set(
    db: ParcelDb,
    addr: SourceLocationAddr,
    value: SourceLocation,
  ): void {
    copy(db, value.addr, addr, 20);
  }

  dealloc() {
    this.db.dealloc(8, this.addr);
  }

  get filePath(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 16));
  }

  set filePath(value: string): void {
    writeU32(this.db, this.addr + 16, this.db.getStringId(value));
  }

  get start(): Location {
    return Location.get(this.db, this.addr + 0);
  }

  set start(value: Location): void {
    Location.set(this.db, this.addr + 0, value);
  }

  get end(): Location {
    return Location.get(this.db, this.addr + 8);
  }

  set end(value: Location): void {
    Location.set(this.db, this.addr + 8, value);
  }
}

export opaque type LocationAddr = number;

export class Location {
  static typeId: number = 7;
  db: ParcelDb;
  addr: LocationAddr;

  constructor(db: ParcelDb, addr?: LocationAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(7);
  }

  static get(db: ParcelDb, addr: LocationAddr): Location {
    return new Location(db, addr);
  }

  static set(db: ParcelDb, addr: LocationAddr, value: Location): void {
    copy(db, value.addr, addr, 8);
  }

  dealloc() {
    this.db.dealloc(7, this.addr);
  }

  get line(): number {
    return readU32(this.db, this.addr + 0);
  }

  set line(value: number): void {
    writeU32(this.db, this.addr + 0, value);
  }

  get column(): number {
    return readU32(this.db, this.addr + 4);
  }

  set column(value: number): void {
    writeU32(this.db, this.addr + 4, value);
  }
}

export const EnvironmentFlags = {
  IS_LIBRARY: 0b1,
  SHOULD_OPTIMIZE: 0b10,
  SHOULD_SCOPE_HOIST: 0b100,
};

type EnvironmentContextVariants =
  | 'browser'
  | 'web-worker'
  | 'service-worker'
  | 'worklet'
  | 'node'
  | 'electron-main'
  | 'electron-renderer';

export class EnvironmentContext {
  static get(db: ParcelDb, addr: number): EnvironmentContextVariants {
    switch (readU8(db, addr + 0)) {
      case 0:
        return 'browser';
      case 1:
        return 'web-worker';
      case 2:
        return 'service-worker';
      case 3:
        return 'worklet';
      case 4:
        return 'node';
      case 5:
        return 'electron-main';
      case 6:
        return 'electron-renderer';
      default:
        throw new Error(
          `Unknown EnvironmentContext value: ${readU8(db, addr)}`,
        );
    }
  }

  static set(
    db: ParcelDb,
    addr: number,
    value: EnvironmentContextVariants,
  ): void {
    let write = writeU8;
    switch (value) {
      case 'browser':
        write(db, addr + 0, 0);
        break;
      case 'web-worker':
        write(db, addr + 0, 1);
        break;
      case 'service-worker':
        write(db, addr + 0, 2);
        break;
      case 'worklet':
        write(db, addr + 0, 3);
        break;
      case 'node':
        write(db, addr + 0, 4);
        break;
      case 'electron-main':
        write(db, addr + 0, 5);
        break;
      case 'electron-renderer':
        write(db, addr + 0, 6);
        break;
      default:
        throw new Error(`Unknown EnvironmentContext value: ${value}`);
    }
  }
}

type SourceTypeVariants = 'module' | 'script';

export class SourceType {
  static get(db: ParcelDb, addr: number): SourceTypeVariants {
    switch (readU8(db, addr + 0)) {
      case 0:
        return 'module';
      case 1:
        return 'script';
      default:
        throw new Error(`Unknown SourceType value: ${readU8(db, addr)}`);
    }
  }

  static set(db: ParcelDb, addr: number, value: SourceTypeVariants): void {
    let write = writeU8;
    switch (value) {
      case 'module':
        write(db, addr + 0, 0);
        break;
      case 'script':
        write(db, addr + 0, 1);
        break;
      default:
        throw new Error(`Unknown SourceType value: ${value}`);
    }
  }
}

type OutputFormatVariants = 'global' | 'commonjs' | 'esmodule';

export class OutputFormat {
  static get(db: ParcelDb, addr: number): OutputFormatVariants {
    switch (readU8(db, addr + 0)) {
      case 0:
        return 'global';
      case 1:
        return 'commonjs';
      case 2:
        return 'esmodule';
      default:
        throw new Error(`Unknown OutputFormat value: ${readU8(db, addr)}`);
    }
  }

  static set(db: ParcelDb, addr: number, value: OutputFormatVariants): void {
    let write = writeU8;
    switch (value) {
      case 'global':
        write(db, addr + 0, 0);
        break;
      case 'commonjs':
        write(db, addr + 0, 1);
        break;
      case 'esmodule':
        write(db, addr + 0, 2);
        break;
      default:
        throw new Error(`Unknown OutputFormat value: ${value}`);
    }
  }
}

export opaque type AssetAddr = number;

export class Asset {
  static typeId: number = 0;
  db: ParcelDb;
  addr: AssetAddr;

  constructor(db: ParcelDb, addr?: AssetAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(0);
  }

  static get(db: ParcelDb, addr: AssetAddr): Asset {
    return new Asset(db, addr);
  }

  static set(db: ParcelDb, addr: AssetAddr, value: Asset): void {
    copy(db, value.addr, addr, 100);
  }

  dealloc() {
    this.db.dealloc(0, this.addr);
  }

  get id(): number {
    return readU32(this.db, this.addr + 76);
  }

  set id(value: number): void {
    writeU32(this.db, this.addr + 76, value);
  }

  get filePath(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 80));
  }

  set filePath(value: string): void {
    writeU32(this.db, this.addr + 80, this.db.getStringId(value));
  }

  get env(): EnvironmentAddr {
    return readU32(this.db, this.addr + 84);
  }

  set env(value: EnvironmentAddr): void {
    writeU32(this.db, this.addr + 84, value);
  }

  get query(): ?string {
    return readU32(this.db, this.addr + 40 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 40));
  }

  set query(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 40 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 40, this.db.getStringId(value));
    }
  }

  get assetType(): AssetTypeVariants {
    return AssetType.get(this.db, this.addr + 32);
  }

  set assetType(value: AssetTypeVariants): void {
    AssetType.set(this.db, this.addr + 32, value);
  }

  get contentKey(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 88));
  }

  set contentKey(value: string): void {
    writeU32(this.db, this.addr + 88, this.db.getStringId(value));
  }

  get mapKey(): ?string {
    return readU32(this.db, this.addr + 44 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 44));
  }

  set mapKey(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 44 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 44, this.db.getStringId(value));
    }
  }

  get outputHash(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 92));
  }

  set outputHash(value: string): void {
    writeU32(this.db, this.addr + 92, this.db.getStringId(value));
  }

  get pipeline(): ?string {
    return readU32(this.db, this.addr + 48 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 48));
  }

  set pipeline(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 48 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 48, this.db.getStringId(value));
    }
  }

  get meta(): ?string {
    return readU32(this.db, this.addr + 52 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 52));
  }

  set meta(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 52 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 52, this.db.getStringId(value));
    }
  }

  get stats(): AssetStats {
    return AssetStats.get(this.db, this.addr + 0);
  }

  set stats(value: AssetStats): void {
    AssetStats.set(this.db, this.addr + 0, value);
  }

  get bundleBehavior(): BundleBehaviorVariants {
    return BundleBehavior.get(this.db, this.addr + 96);
  }

  set bundleBehavior(value: BundleBehaviorVariants): void {
    BundleBehavior.set(this.db, this.addr + 96, value);
  }

  get flags(): number {
    return readU32(this.db, this.addr + 56);
  }

  set flags(value: number): void {
    writeU32(this.db, this.addr + 56, value);
  }

  get symbols(): Vec<Symbol> {
    return new Vec(this.db, this.addr + 60, 32, Symbol);
  }

  set symbols(value: Vec<Symbol>): void {
    copy(this.db, value.addr, this.addr + 60, 12);
  }

  get uniqueKey(): ?string {
    return readU32(this.db, this.addr + 72 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 72));
  }

  set uniqueKey(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 72 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 72, this.db.getStringId(value));
    }
  }

  get ast(): ?AssetAst {
    return readU32(this.db, this.addr + 8 + 4) === 0
      ? null
      : AssetAst.get(this.db, this.addr + 8);
  }

  set ast(value: ?AssetAst): void {
    if (value == null) {
      writeU32(this.db, this.addr + 8 + 4, 0);
    } else {
      AssetAst.set(this.db, this.addr + 8, value);
    }
  }
}

export opaque type AssetAstAddr = number;

export class AssetAst {
  static typeId: number = 1;
  db: ParcelDb;
  addr: AssetAstAddr;

  constructor(db: ParcelDb, addr?: AssetAstAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(1);
  }

  static get(db: ParcelDb, addr: AssetAstAddr): AssetAst {
    return new AssetAst(db, addr);
  }

  static set(db: ParcelDb, addr: AssetAstAddr, value: AssetAst): void {
    copy(db, value.addr, addr, 24);
  }

  dealloc() {
    this.db.dealloc(1, this.addr);
  }

  get key(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 4));
  }

  set key(value: string): void {
    writeU32(this.db, this.addr + 4, this.db.getStringId(value));
  }

  get plugin(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 8));
  }

  set plugin(value: string): void {
    writeU32(this.db, this.addr + 8, this.db.getStringId(value));
  }

  get configPath(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 12));
  }

  set configPath(value: string): void {
    writeU32(this.db, this.addr + 12, this.db.getStringId(value));
  }

  get configKeyPath(): ?string {
    return readU32(this.db, this.addr + 0 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 0));
  }

  set configKeyPath(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 0 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 0, this.db.getStringId(value));
    }
  }

  get generator(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 16));
  }

  set generator(value: string): void {
    writeU32(this.db, this.addr + 16, this.db.getStringId(value));
  }

  get version(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 20));
  }

  set version(value: string): void {
    writeU32(this.db, this.addr + 20, this.db.getStringId(value));
  }
}

type AssetTypeVariants = 'js' | 'jsx' | 'ts' | 'tsx' | 'css' | 'html' | string;

export class AssetType {
  static get(db: ParcelDb, addr: number): AssetTypeVariants {
    switch (readU32(db, addr + 0)) {
      case 0:
        return 'js';
      case 1:
        return 'jsx';
      case 2:
        return 'ts';
      case 3:
        return 'tsx';
      case 4:
        return 'css';
      case 5:
        return 'html';
      case 6:
        return readCachedString(db, readU32(db, addr + 4));
      default:
        throw new Error(`Unknown AssetType value: ${readU32(db, addr)}`);
    }
  }

  static set(db: ParcelDb, addr: number, value: AssetTypeVariants): void {
    let write = writeU32;
    switch (value) {
      case 'js':
        write(db, addr + 0, 0);
        break;
      case 'jsx':
        write(db, addr + 0, 1);
        break;
      case 'ts':
        write(db, addr + 0, 2);
        break;
      case 'tsx':
        write(db, addr + 0, 3);
        break;
      case 'css':
        write(db, addr + 0, 4);
        break;
      case 'html':
        write(db, addr + 0, 5);
        break;
      default:
        write(db, addr + 0, 6);
        writeU32(db, addr + 4, db.getStringId(value));
        break;
    }
  }
}

type BundleBehaviorVariants = 'none' | 'inline' | 'isolated';

export class BundleBehavior {
  static get(db: ParcelDb, addr: number): BundleBehaviorVariants {
    switch (readU8(db, addr + 0)) {
      case 0:
        return 'none';
      case 1:
        return 'inline';
      case 2:
        return 'isolated';
      default:
        throw new Error(`Unknown BundleBehavior value: ${readU8(db, addr)}`);
    }
  }

  static set(db: ParcelDb, addr: number, value: BundleBehaviorVariants): void {
    let write = writeU8;
    switch (value) {
      case 'none':
        write(db, addr + 0, 0);
        break;
      case 'inline':
        write(db, addr + 0, 1);
        break;
      case 'isolated':
        write(db, addr + 0, 2);
        break;
      default:
        throw new Error(`Unknown BundleBehavior value: ${value}`);
    }
  }
}

export opaque type AssetStatsAddr = number;

export class AssetStats {
  static typeId: number = 2;
  db: ParcelDb;
  addr: AssetStatsAddr;

  constructor(db: ParcelDb, addr?: AssetStatsAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(2);
  }

  static get(db: ParcelDb, addr: AssetStatsAddr): AssetStats {
    return new AssetStats(db, addr);
  }

  static set(db: ParcelDb, addr: AssetStatsAddr, value: AssetStats): void {
    copy(db, value.addr, addr, 8);
  }

  dealloc() {
    this.db.dealloc(2, this.addr);
  }

  get size(): number {
    return readU32(this.db, this.addr + 0);
  }

  set size(value: number): void {
    writeU32(this.db, this.addr + 0, value);
  }

  get time(): number {
    return readU32(this.db, this.addr + 4);
  }

  set time(value: number): void {
    writeU32(this.db, this.addr + 4, value);
  }
}

export const AssetFlags = {
  IS_SOURCE: 0b1,
  SIDE_EFFECTS: 0b10,
  IS_BUNDLE_SPLITTABLE: 0b100,
  LARGE_BLOB: 0b1000,
  HAS_CJS_EXPORTS: 0b10000,
  STATIC_EXPORTS: 0b100000,
  SHOULD_WRAP: 0b1000000,
  IS_CONSTANT_MODULE: 0b10000000,
  HAS_NODE_REPLACEMENTS: 0b100000000,
  HAS_SYMBOLS: 0b1000000000,
};

export const ExportsCondition = {
  IMPORT: 0b1,
  REQUIRE: 0b10,
  MODULE: 0b100,
  STYLE: 0b1000000000000,
  SASS: 0b10000000000000,
  LESS: 0b100000000000000,
  STYLUS: 0b1000000000000000,
};

export opaque type DependencyAddr = number;

export class Dependency {
  static typeId: number = 3;
  db: ParcelDb;
  addr: DependencyAddr;

  constructor(db: ParcelDb, addr?: DependencyAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(3);
  }

  static get(db: ParcelDb, addr: DependencyAddr): Dependency {
    return new Dependency(db, addr);
  }

  static set(db: ParcelDb, addr: DependencyAddr, value: Dependency): void {
    copy(db, value.addr, addr, 112);
  }

  dealloc() {
    this.db.dealloc(3, this.addr);
  }

  get id(): number {
    return readU32(this.db, this.addr + 96);
  }

  set id(value: number): void {
    writeU32(this.db, this.addr + 96, value);
  }

  get sourceAssetId(): ?AssetAddr {
    return readU32(this.db, this.addr + 0 + 0) === 0
      ? null
      : readU32(this.db, this.addr + 0);
  }

  set sourceAssetId(value: ?AssetAddr): void {
    if (value == null) {
      writeU32(this.db, this.addr + 0 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 0, value);
    }
  }

  get env(): EnvironmentAddr {
    return readU32(this.db, this.addr + 100);
  }

  set env(value: EnvironmentAddr): void {
    writeU32(this.db, this.addr + 100, value);
  }

  get specifier(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 104));
  }

  set specifier(value: string): void {
    writeU32(this.db, this.addr + 104, this.db.getStringId(value));
  }

  get specifierType(): SpecifierTypeVariants {
    return SpecifierType.get(this.db, this.addr + 109);
  }

  set specifierType(value: SpecifierTypeVariants): void {
    SpecifierType.set(this.db, this.addr + 109, value);
  }

  get resolveFrom(): ?string {
    return readU32(this.db, this.addr + 4 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 4));
  }

  set resolveFrom(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 4 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 4, this.db.getStringId(value));
    }
  }

  get range(): ?string {
    return readU32(this.db, this.addr + 8 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 8));
  }

  set range(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 8 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 8, this.db.getStringId(value));
    }
  }

  get priority(): PriorityVariants {
    return Priority.get(this.db, this.addr + 110);
  }

  set priority(value: PriorityVariants): void {
    Priority.set(this.db, this.addr + 110, value);
  }

  get bundleBehavior(): BundleBehaviorVariants {
    return BundleBehavior.get(this.db, this.addr + 111);
  }

  set bundleBehavior(value: BundleBehaviorVariants): void {
    BundleBehavior.set(this.db, this.addr + 111, value);
  }

  get flags(): number {
    return readU8(this.db, this.addr + 108);
  }

  set flags(value: number): void {
    writeU8(this.db, this.addr + 108, value);
  }

  get loc(): ?SourceLocation {
    return readU32(this.db, this.addr + 12 + 16) === 0
      ? null
      : SourceLocation.get(this.db, this.addr + 12);
  }

  set loc(value: ?SourceLocation): void {
    if (value == null) {
      writeU32(this.db, this.addr + 12 + 16, 0);
    } else {
      SourceLocation.set(this.db, this.addr + 12, value);
    }
  }

  get placeholder(): ?string {
    return readU32(this.db, this.addr + 32 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 32));
  }

  set placeholder(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 32 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 32, this.db.getStringId(value));
    }
  }

  get target(): ?TargetAddr {
    return readU32(this.db, this.addr + 36 + 0) === 0
      ? null
      : readU32(this.db, this.addr + 36);
  }

  set target(value: ?TargetAddr): void {
    if (value == null) {
      writeU32(this.db, this.addr + 36 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 36, value);
    }
  }

  get symbols(): Vec<Symbol> {
    return new Vec(this.db, this.addr + 40, 32, Symbol);
  }

  set symbols(value: Vec<Symbol>): void {
    copy(this.db, value.addr, this.addr + 40, 12);
  }

  get promiseSymbol(): ?string {
    return readU32(this.db, this.addr + 52 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 52));
  }

  set promiseSymbol(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 52 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 52, this.db.getStringId(value));
    }
  }

  get importAttributes(): Vec<ImportAttribute> {
    return new Vec(this.db, this.addr + 56, 8, ImportAttribute);
  }

  set importAttributes(value: Vec<ImportAttribute>): void {
    copy(this.db, value.addr, this.addr + 56, 12);
  }

  get pipeline(): ?string {
    return readU32(this.db, this.addr + 68 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 68));
  }

  set pipeline(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 68 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 68, this.db.getStringId(value));
    }
  }

  get meta(): ?string {
    return readU32(this.db, this.addr + 72 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 72));
  }

  set meta(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 72 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 72, this.db.getStringId(value));
    }
  }

  get resolverMeta(): ?string {
    return readU32(this.db, this.addr + 76 + 0) === 0
      ? null
      : readCachedString(this.db, readU32(this.db, this.addr + 76));
  }

  set resolverMeta(value: ?string): void {
    if (value == null) {
      writeU32(this.db, this.addr + 76 + 0, 0);
    } else {
      writeU32(this.db, this.addr + 76, this.db.getStringId(value));
    }
  }

  get packageConditions(): number {
    return readU32(this.db, this.addr + 80);
  }

  set packageConditions(value: number): void {
    writeU32(this.db, this.addr + 80, value);
  }

  get customPackageConditions(): Vec<string> {
    return new Vec(this.db, this.addr + 84, 4, InternedString);
  }

  set customPackageConditions(value: Vec<string>): void {
    copy(this.db, value.addr, this.addr + 84, 12);
  }
}

export opaque type ImportAttributeAddr = number;

export class ImportAttribute {
  static typeId: number = 6;
  db: ParcelDb;
  addr: ImportAttributeAddr;

  constructor(db: ParcelDb, addr?: ImportAttributeAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(6);
  }

  static get(db: ParcelDb, addr: ImportAttributeAddr): ImportAttribute {
    return new ImportAttribute(db, addr);
  }

  static set(
    db: ParcelDb,
    addr: ImportAttributeAddr,
    value: ImportAttribute,
  ): void {
    copy(db, value.addr, addr, 8);
  }

  dealloc() {
    this.db.dealloc(6, this.addr);
  }

  get key(): string {
    return readCachedString(this.db, readU32(this.db, this.addr + 0));
  }

  set key(value: string): void {
    writeU32(this.db, this.addr + 0, this.db.getStringId(value));
  }

  get value(): boolean {
    return !!readU8(this.db, this.addr + 4);
  }

  set value(value: boolean): void {
    writeU8(this.db, this.addr + 4, value ? 1 : 0);
  }
}

export const DependencyFlags = {
  ENTRY: 0b1,
  OPTIONAL: 0b10,
  NEEDS_STABLE_NAME: 0b100,
  SHOULD_WRAP: 0b1000,
  IS_ESM: 0b10000,
  IS_WEBWORKER: 0b100000,
  HAS_SYMBOLS: 0b1000000,
};

type SpecifierTypeVariants = 'esm' | 'commonjs' | 'url' | 'custom';

export class SpecifierType {
  static get(db: ParcelDb, addr: number): SpecifierTypeVariants {
    switch (readU8(db, addr + 0)) {
      case 0:
        return 'esm';
      case 1:
        return 'commonjs';
      case 2:
        return 'url';
      case 3:
        return 'custom';
      default:
        throw new Error(`Unknown SpecifierType value: ${readU8(db, addr)}`);
    }
  }

  static set(db: ParcelDb, addr: number, value: SpecifierTypeVariants): void {
    let write = writeU8;
    switch (value) {
      case 'esm':
        write(db, addr + 0, 0);
        break;
      case 'commonjs':
        write(db, addr + 0, 1);
        break;
      case 'url':
        write(db, addr + 0, 2);
        break;
      case 'custom':
        write(db, addr + 0, 3);
        break;
      default:
        throw new Error(`Unknown SpecifierType value: ${value}`);
    }
  }
}

type PriorityVariants = 'sync' | 'parallel' | 'lazy';

export class Priority {
  static get(db: ParcelDb, addr: number): PriorityVariants {
    switch (readU8(db, addr + 0)) {
      case 0:
        return 'sync';
      case 1:
        return 'parallel';
      case 2:
        return 'lazy';
      default:
        throw new Error(`Unknown Priority value: ${readU8(db, addr)}`);
    }
  }

  static set(db: ParcelDb, addr: number, value: PriorityVariants): void {
    let write = writeU8;
    switch (value) {
      case 'sync':
        write(db, addr + 0, 0);
        break;
      case 'parallel':
        write(db, addr + 0, 1);
        break;
      case 'lazy':
        write(db, addr + 0, 2);
        break;
      default:
        throw new Error(`Unknown Priority value: ${value}`);
    }
  }
}

export opaque type SymbolAddr = number;

export class Symbol {
  static typeId: number = 9;
  db: ParcelDb;
  addr: SymbolAddr;

  constructor(db: ParcelDb, addr?: SymbolAddr) {
    this.db = db;
    this.addr = addr ?? db.alloc(9);
  }

  static get(db: ParcelDb, addr: SymbolAddr): Symbol {
    return new Symbol(db, addr);
  }

  static set(db: ParcelDb, addr: SymbolAddr, value: Symbol): void {
    copy(db, value.addr, addr, 32);
  }

  dealloc() {
    this.db.dealloc(9, this.addr);
  }

  get exported(): number {
    return readU32(this.db, this.addr + 20);
  }

  set exported(value: number): void {
    writeU32(this.db, this.addr + 20, value);
  }

  get local(): number {
    return readU32(this.db, this.addr + 24);
  }

  set local(value: number): void {
    writeU32(this.db, this.addr + 24, value);
  }

  get loc(): ?SourceLocation {
    return readU32(this.db, this.addr + 0 + 16) === 0
      ? null
      : SourceLocation.get(this.db, this.addr + 0);
  }

  set loc(value: ?SourceLocation): void {
    if (value == null) {
      writeU32(this.db, this.addr + 0 + 16, 0);
    } else {
      SourceLocation.set(this.db, this.addr + 0, value);
    }
  }

  get flags(): number {
    return readU8(this.db, this.addr + 28);
  }

  set flags(value: number): void {
    writeU8(this.db, this.addr + 28, value);
  }
}

export const SymbolFlags = {
  IS_WEAK: 0b1,
  IS_ESM: 0b10,
};

class InternedString {
  static typeId: number = 12;

  static get(db: ParcelDb, addr: number): string {
    return readCachedString(db, readU32(db, addr));
  }

  static set(db: ParcelDb, addr: number, value: string): void {
    writeU32(db, addr, db.getStringId(value));
  }
}
