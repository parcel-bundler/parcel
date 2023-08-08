// @flow
import binding from '../index';

const HEAP = binding.getHeap();
const HEAP_BASE = binding.getHeapBase();
const HEAP_u32 = new Uint32Array(HEAP.buffer);
const HEAP_u64 = new BigUint64Array(HEAP.buffer);
const STRING_CACHE = new Map();

function readCachedString(addr) {
  let v = STRING_CACHE.get(addr);
  if (v != null) return v;
  v = binding.readString(addr);
  STRING_CACHE.set(addr, v);
  return v;
}

interface TypeAccessor<T> {
  get(addr: number): T,
  set(addr: number, value: T): void
}

class Vec<T> {
  addr: number;
  size: number;
  accessor: TypeAccessor<T>;
  /*::
  @@iterator(): Iterator<T> { return ({}: any); }
  */

  constructor(addr: number, size: number, accessor: TypeAccessor<T>) {
    this.addr = addr;
    this.size = size;
    this.accessor = accessor;
  }

  get length(): number {
    return HEAP_u32[(this.addr + 16) >> 2] + HEAP_u32[(this.addr + 16 + 4) >> 2] * 0x100000000;
  }

  get capacity(): number {
    return HEAP_u32[(this.addr + 0) >> 2] + HEAP_u32[(this.addr + 0 + 4) >> 2] * 0x100000000;
  }

  get(index: number): T {
    let bufAddr = Number(HEAP_u64[this.addr + 8 >> 3] - HEAP_BASE);
    return this.accessor.get(bufAddr + index * this.size);
  }

  set(index: number, value: T): void {
    if (index >= this.length) {
      throw new Error(`Index out of bounds: ${index} >= ${this.length}`);
    }
    let bufAddr = Number(HEAP_u64[this.addr + 8 >> 3] - HEAP_BASE);
    this.accessor.set(bufAddr + index * this.size, value);
  }

  reserve(count: number): void {
    if (this.length + count > this.capacity) {
      binding.extendVec(this.addr, this.size, count);
    } else {
      HEAP_u64[(this.addr + 16) >> 3] += BigInt(count);
    }
  }

  push(value: T): void {
    this.reserve(1);
    this.set(this.length - 1, value);
  }

  extend(): T {
    this.reserve(1);
    return this.get(this.length - 1);
  }

  clear(): void {
    // TODO: run Rust destructors?
    HEAP_u64[(this.addr + 16) >> 3] = 0n;
    HEAP_u64[(this.addr + 0) >> 3] = 0n;
    HEAP_u64[this.addr + 8 >> 3] = 1n;
  }

  // $FlowFixMe
  *[globalThis.Symbol.iterator]() {
    let addr = Number(HEAP_u64[this.addr + 8 >> 3] - HEAP_BASE);
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {
      yield this.accessor.get(addr);
    }
  }

  find(pred: (value: T) => boolean): ?T {
    let addr = Number(HEAP_u64[this.addr + 8 >> 3] - HEAP_BASE);
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {
      let value = this.accessor.get(addr);
      if (pred(value)) {
        return value;
      }
    }
  }

  some(pred: (value: T) => boolean): boolean {
    let addr = Number(HEAP_u64[this.addr + 8 >> 3] - HEAP_BASE);
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {
      let value = this.accessor.get(addr);
      if (pred(value)) {
        return true;
      }
    }
    return false;
  }
}

export class Target {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(152);
  }

  static get(addr: number): Target {
    return new Target(addr);
  }

  static set(addr: number, value: Target): void {
    HEAP.set(HEAP.subarray(value.addr, value.addr + 152), addr);
  }

  get env(): number {
    return HEAP_u32[(this.addr + 144) >> 2];
  }

  set env(value: number): void {
    HEAP_u32[(this.addr + 144) >> 2] = value;
  }

  get distDir(): string {
    return readCachedString(this.addr + 48);
  }

  set distDir(value: string): void {
    STRING_CACHE.set(this.addr + 48, value); binding.writeString(this.addr + 48, value);
  }

  get distEntry(): ?string {
    return HEAP_u32[this.addr + 0 + 8 >> 2] === 0 && HEAP_u32[this.addr + 0 + 12 >> 2] === 0 ? null : readCachedString(this.addr + 0);
  }

  set distEntry(value: ?string): void {
    if (value == null) {
      HEAP_u32[this.addr + 0 + 8 >> 2] = 0;
      HEAP_u32[this.addr + 0 + 12 >> 2] = 0;
    } else {
      STRING_CACHE.set(this.addr + 0, value); binding.writeString(this.addr + 0, value);
    };
  }

  get name(): string {
    return readCachedString(this.addr + 72);
  }

  set name(value: string): void {
    STRING_CACHE.set(this.addr + 72, value); binding.writeString(this.addr + 72, value);
  }

  get publicUrl(): string {
    return readCachedString(this.addr + 96);
  }

  set publicUrl(value: string): void {
    STRING_CACHE.set(this.addr + 96, value); binding.writeString(this.addr + 96, value);
  }

  get loc(): ?SourceLocation {
    return HEAP_u32[(this.addr + 120) >> 2] ? null : SourceLocation.get(this.addr + 124);
  }

  set loc(value: ?SourceLocation): void {
    HEAP_u32[(this.addr + 120) >> 2] = value == null ? 0 : 1;
    if (value != null) SourceLocation.set(this.addr + 124, value);
  }

  get pipeline(): ?string {
    return HEAP_u32[this.addr + 24 + 8 >> 2] === 0 && HEAP_u32[this.addr + 24 + 12 >> 2] === 0 ? null : readCachedString(this.addr + 24);
  }

  set pipeline(value: ?string): void {
    if (value == null) {
      HEAP_u32[this.addr + 24 + 8 >> 2] = 0;
      HEAP_u32[this.addr + 24 + 12 >> 2] = 0;
    } else {
      STRING_CACHE.set(this.addr + 24, value); binding.writeString(this.addr + 24, value);
    };
  }
}

export class Environment {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(88);
  }

  static get(addr: number): Environment {
    return new Environment(addr);
  }

  static set(addr: number, value: Environment): void {
    HEAP.set(HEAP.subarray(value.addr, value.addr + 88), addr);
  }

  get context(): EnvironmentContextVariants {
    return EnvironmentContext.get(this.addr + 81);
  }

  set context(value: EnvironmentContextVariants): void {
    EnvironmentContext.set(this.addr + 81, value);
  }

  get outputFormat(): OutputFormatVariants {
    return OutputFormat.get(this.addr + 82);
  }

  set outputFormat(value: OutputFormatVariants): void {
    OutputFormat.set(this.addr + 82, value);
  }

  get sourceType(): SourceTypeVariants {
    return SourceType.get(this.addr + 83);
  }

  set sourceType(value: SourceTypeVariants): void {
    SourceType.set(this.addr + 83, value);
  }

  get flags(): number {
    return HEAP[this.addr + 80];
  }

  set flags(value: number): void {
    HEAP[this.addr + 80] = value;
  }

  get sourceMap(): ?TargetSourceMapOptions {
    return HEAP[this.addr + 0 + 24] === 2 ? null : TargetSourceMapOptions.get(this.addr + 0);
  }

  set sourceMap(value: ?TargetSourceMapOptions): void {
    if (value == null) {
      HEAP[this.addr + 0 + 24] = 2;
    } else {
      TargetSourceMapOptions.set(this.addr + 0, value);
    };
  }

  get loc(): ?SourceLocation {
    return HEAP_u32[(this.addr + 56) >> 2] ? null : SourceLocation.get(this.addr + 60);
  }

  set loc(value: ?SourceLocation): void {
    HEAP_u32[(this.addr + 56) >> 2] = value == null ? 0 : 1;
    if (value != null) SourceLocation.set(this.addr + 60, value);
  }

  get includeNodeModules(): string {
    return readCachedString(this.addr + 32);
  }

  set includeNodeModules(value: string): void {
    STRING_CACHE.set(this.addr + 32, value); binding.writeString(this.addr + 32, value);
  }
}

export class TargetSourceMapOptions {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(32);
  }

  static get(addr: number): TargetSourceMapOptions {
    return new TargetSourceMapOptions(addr);
  }

  static set(addr: number, value: TargetSourceMapOptions): void {
    HEAP.set(HEAP.subarray(value.addr, value.addr + 32), addr);
  }

  get sourceRoot(): ?string {
    return HEAP_u32[this.addr + 0 + 8 >> 2] === 0 && HEAP_u32[this.addr + 0 + 12 >> 2] === 0 ? null : readCachedString(this.addr + 0);
  }

  set sourceRoot(value: ?string): void {
    if (value == null) {
      HEAP_u32[this.addr + 0 + 8 >> 2] = 0;
      HEAP_u32[this.addr + 0 + 12 >> 2] = 0;
    } else {
      STRING_CACHE.set(this.addr + 0, value); binding.writeString(this.addr + 0, value);
    };
  }

  get inline(): boolean {
    return !!HEAP[this.addr + 24];
  }

  set inline(value: boolean): void {
    HEAP[this.addr + 24] = value ? 1 : 0;
  }

  get inlineSources(): boolean {
    return !!HEAP[this.addr + 25];
  }

  set inlineSources(value: boolean): void {
    HEAP[this.addr + 25] = value ? 1 : 0;
  }
}

export class SourceLocation {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(20);
  }

  static get(addr: number): SourceLocation {
    return new SourceLocation(addr);
  }

  static set(addr: number, value: SourceLocation): void {
    HEAP.set(HEAP.subarray(value.addr, value.addr + 20), addr);
  }

  get fileId(): number {
    return HEAP_u32[(this.addr + 16) >> 2];
  }

  set fileId(value: number): void {
    HEAP_u32[(this.addr + 16) >> 2] = value;
  }

  get start(): Location {
    return Location.get(this.addr + 0);
  }

  set start(value: Location): void {
    Location.set(this.addr + 0, value);
  }

  get end(): Location {
    return Location.get(this.addr + 8);
  }

  set end(value: Location): void {
    Location.set(this.addr + 8, value);
  }
}

export class Location {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(8);
  }

  static get(addr: number): Location {
    return new Location(addr);
  }

  static set(addr: number, value: Location): void {
    HEAP.set(HEAP.subarray(value.addr, value.addr + 8), addr);
  }

  get line(): number {
    return HEAP_u32[(this.addr + 0) >> 2];
  }

  set line(value: number): void {
    HEAP_u32[(this.addr + 0) >> 2] = value;
  }

  get column(): number {
    return HEAP_u32[(this.addr + 4) >> 2];
  }

  set column(value: number): void {
    HEAP_u32[(this.addr + 4) >> 2] = value;
  }
}

export const EnvironmentFlags = {
  IS_LIBRARY: 0b1,
  SHOULD_OPTIMIZE: 0b10,
  SHOULD_SCOPE_HOIST: 0b100,
};

type EnvironmentContextVariants = 'browser' | 'web-worker' | 'service-worker' | 'worklet' | 'node' | 'electron-main' | 'electron-renderer';

export class EnvironmentContext {
  static get(addr: number): EnvironmentContextVariants {
    switch (HEAP[addr]) {
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
        throw new Error(`Unknown EnvironmentContext value: ${HEAP[addr]}`);
    }
  }

  static set(addr: number, value: EnvironmentContextVariants): void {
    let buf = HEAP;
    switch (value) {
      case 'browser':
        buf[addr] = 0;
        break;
      case 'web-worker':
        buf[addr] = 1;
        break;
      case 'service-worker':
        buf[addr] = 2;
        break;
      case 'worklet':
        buf[addr] = 3;
        break;
      case 'node':
        buf[addr] = 4;
        break;
      case 'electron-main':
        buf[addr] = 5;
        break;
      case 'electron-renderer':
        buf[addr] = 6;
        break;
      default:
        throw new Error(`Unknown EnvironmentContext value: ${value}`);
    }
  }
}

type SourceTypeVariants = 'module' | 'script';

export class SourceType {
  static get(addr: number): SourceTypeVariants {
    switch (HEAP[addr]) {
      case 0:
        return 'module';
      case 1:
        return 'script';
      default:
        throw new Error(`Unknown SourceType value: ${HEAP[addr]}`);
    }
  }

  static set(addr: number, value: SourceTypeVariants): void {
    let buf = HEAP;
    switch (value) {
      case 'module':
        buf[addr] = 0;
        break;
      case 'script':
        buf[addr] = 1;
        break;
      default:
        throw new Error(`Unknown SourceType value: ${value}`);
    }
  }
}

type OutputFormatVariants = 'global' | 'commonjs' | 'esmodule';

export class OutputFormat {
  static get(addr: number): OutputFormatVariants {
    switch (HEAP[addr]) {
      case 0:
        return 'global';
      case 1:
        return 'commonjs';
      case 2:
        return 'esmodule';
      default:
        throw new Error(`Unknown OutputFormat value: ${HEAP[addr]}`);
    }
  }

  static set(addr: number, value: OutputFormatVariants): void {
    let buf = HEAP;
    switch (value) {
      case 'global':
        buf[addr] = 0;
        break;
      case 'commonjs':
        buf[addr] = 1;
        break;
      case 'esmodule':
        buf[addr] = 2;
        break;
      default:
        throw new Error(`Unknown OutputFormat value: ${value}`);
    }
  }
}

export class Asset {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(232);
  }

  static get(addr: number): Asset {
    return new Asset(addr);
  }

  static set(addr: number, value: Asset): void {
    HEAP.set(HEAP.subarray(value.addr, value.addr + 232), addr);
  }

  get filePath(): string {
    return readCachedString(this.addr + 104);
  }

  set filePath(value: string): void {
    STRING_CACHE.set(this.addr + 104, value); binding.writeString(this.addr + 104, value);
  }

  get env(): number {
    return HEAP_u32[(this.addr + 224) >> 2];
  }

  set env(value: number): void {
    HEAP_u32[(this.addr + 224) >> 2] = value;
  }

  get query(): ?string {
    return HEAP_u32[this.addr + 0 + 8 >> 2] === 0 && HEAP_u32[this.addr + 0 + 12 >> 2] === 0 ? null : readCachedString(this.addr + 0);
  }

  set query(value: ?string): void {
    if (value == null) {
      HEAP_u32[this.addr + 0 + 8 >> 2] = 0;
      HEAP_u32[this.addr + 0 + 12 >> 2] = 0;
    } else {
      STRING_CACHE.set(this.addr + 0, value); binding.writeString(this.addr + 0, value);
    };
  }

  get assetType(): AssetTypeVariants {
    return AssetType.get(this.addr + 229);
  }

  set assetType(value: AssetTypeVariants): void {
    AssetType.set(this.addr + 229, value);
  }

  get contentKey(): string {
    return readCachedString(this.addr + 128);
  }

  set contentKey(value: string): void {
    STRING_CACHE.set(this.addr + 128, value); binding.writeString(this.addr + 128, value);
  }

  get mapKey(): ?string {
    return HEAP_u32[this.addr + 24 + 8 >> 2] === 0 && HEAP_u32[this.addr + 24 + 12 >> 2] === 0 ? null : readCachedString(this.addr + 24);
  }

  set mapKey(value: ?string): void {
    if (value == null) {
      HEAP_u32[this.addr + 24 + 8 >> 2] = 0;
      HEAP_u32[this.addr + 24 + 12 >> 2] = 0;
    } else {
      STRING_CACHE.set(this.addr + 24, value); binding.writeString(this.addr + 24, value);
    };
  }

  get outputHash(): string {
    return readCachedString(this.addr + 152);
  }

  set outputHash(value: string): void {
    STRING_CACHE.set(this.addr + 152, value); binding.writeString(this.addr + 152, value);
  }

  get pipeline(): ?string {
    return HEAP_u32[this.addr + 48 + 8 >> 2] === 0 && HEAP_u32[this.addr + 48 + 12 >> 2] === 0 ? null : readCachedString(this.addr + 48);
  }

  set pipeline(value: ?string): void {
    if (value == null) {
      HEAP_u32[this.addr + 48 + 8 >> 2] = 0;
      HEAP_u32[this.addr + 48 + 12 >> 2] = 0;
    } else {
      STRING_CACHE.set(this.addr + 48, value); binding.writeString(this.addr + 48, value);
    };
  }

  get meta(): string {
    return readCachedString(this.addr + 176);
  }

  set meta(value: string): void {
    STRING_CACHE.set(this.addr + 176, value); binding.writeString(this.addr + 176, value);
  }

  get stats(): AssetStats {
    return AssetStats.get(this.addr + 72);
  }

  set stats(value: AssetStats): void {
    AssetStats.set(this.addr + 72, value);
  }

  get bundleBehavior(): BundleBehaviorVariants {
    return BundleBehavior.get(this.addr + 230);
  }

  set bundleBehavior(value: BundleBehaviorVariants): void {
    BundleBehavior.set(this.addr + 230, value);
  }

  get flags(): number {
    return HEAP[this.addr + 228];
  }

  set flags(value: number): void {
    HEAP[this.addr + 228] = value;
  }

  get symbols(): Vec<Symbol> {
    return new Vec(this.addr + 200, 80, Symbol);
  }

  set symbols(value: Vec<Symbol>): void {
    HEAP.set(HEAP.subarray(value.addr, value.addr + 24), this.addr + 200);;
  }

  get uniqueKey(): ?string {
    return HEAP_u32[this.addr + 80 + 8 >> 2] === 0 && HEAP_u32[this.addr + 80 + 12 >> 2] === 0 ? null : readCachedString(this.addr + 80);
  }

  set uniqueKey(value: ?string): void {
    if (value == null) {
      HEAP_u32[this.addr + 80 + 8 >> 2] = 0;
      HEAP_u32[this.addr + 80 + 12 >> 2] = 0;
    } else {
      STRING_CACHE.set(this.addr + 80, value); binding.writeString(this.addr + 80, value);
    };
  }
}

type AssetTypeVariants = 'js' | 'css' | 'html' | 'other';

export class AssetType {
  static get(addr: number): AssetTypeVariants {
    switch (HEAP[addr]) {
      case 0:
        return 'js';
      case 1:
        return 'css';
      case 2:
        return 'html';
      case 3:
        return 'other';
      default:
        throw new Error(`Unknown AssetType value: ${HEAP[addr]}`);
    }
  }

  static set(addr: number, value: AssetTypeVariants): void {
    let buf = HEAP;
    switch (value) {
      case 'js':
        buf[addr] = 0;
        break;
      case 'css':
        buf[addr] = 1;
        break;
      case 'html':
        buf[addr] = 2;
        break;
      case 'other':
        buf[addr] = 3;
        break;
      default:
        throw new Error(`Unknown AssetType value: ${value}`);
    }
  }
}

type BundleBehaviorVariants = 'none' | 'inline' | 'isolated';

export class BundleBehavior {
  static get(addr: number): BundleBehaviorVariants {
    switch (HEAP[addr]) {
      case 0:
        return 'none';
      case 1:
        return 'inline';
      case 2:
        return 'isolated';
      default:
        throw new Error(`Unknown BundleBehavior value: ${HEAP[addr]}`);
    }
  }

  static set(addr: number, value: BundleBehaviorVariants): void {
    let buf = HEAP;
    switch (value) {
      case 'none':
        buf[addr] = 0;
        break;
      case 'inline':
        buf[addr] = 1;
        break;
      case 'isolated':
        buf[addr] = 2;
        break;
      default:
        throw new Error(`Unknown BundleBehavior value: ${value}`);
    }
  }
}

export class AssetStats {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(8);
  }

  static get(addr: number): AssetStats {
    return new AssetStats(addr);
  }

  static set(addr: number, value: AssetStats): void {
    HEAP.set(HEAP.subarray(value.addr, value.addr + 8), addr);
  }

  get size(): number {
    return HEAP_u32[(this.addr + 0) >> 2];
  }

  set size(value: number): void {
    HEAP_u32[(this.addr + 0) >> 2] = value;
  }

  get time(): number {
    return HEAP_u32[(this.addr + 4) >> 2];
  }

  set time(value: number): void {
    HEAP_u32[(this.addr + 4) >> 2] = value;
  }
}

export const AssetFlags = {
  IS_SOURCE: 0b1,
  SIDE_EFFECTS: 0b10,
  IS_BUNDLE_SPLITTABLE: 0b100,
  LARGE_BLOB: 0b1000,
};

export class Dependency {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(144);
  }

  static get(addr: number): Dependency {
    return new Dependency(addr);
  }

  static set(addr: number, value: Dependency): void {
    HEAP.set(HEAP.subarray(value.addr, value.addr + 144), addr);
  }

  get sourceAssetId(): ?number {
    return HEAP_u32[(this.addr + 96) >> 2] ? null : HEAP_u32[(this.addr + 100) >> 2];
  }

  set sourceAssetId(value: ?number): void {
    HEAP_u32[(this.addr + 96) >> 2] = value == null ? 0 : 1;
    if (value != null) HEAP_u32[(this.addr + 100) >> 2] = value;
  }

  get env(): number {
    return HEAP_u32[(this.addr + 128) >> 2];
  }

  set env(value: number): void {
    HEAP_u32[(this.addr + 128) >> 2] = value;
  }

  get specifier(): string {
    return readCachedString(this.addr + 48);
  }

  set specifier(value: string): void {
    STRING_CACHE.set(this.addr + 48, value); binding.writeString(this.addr + 48, value);
  }

  get specifierType(): SpecifierTypeVariants {
    return SpecifierType.get(this.addr + 137);
  }

  set specifierType(value: SpecifierTypeVariants): void {
    SpecifierType.set(this.addr + 137, value);
  }

  get resolveFrom(): ?string {
    return HEAP_u32[this.addr + 0 + 8 >> 2] === 0 && HEAP_u32[this.addr + 0 + 12 >> 2] === 0 ? null : readCachedString(this.addr + 0);
  }

  set resolveFrom(value: ?string): void {
    if (value == null) {
      HEAP_u32[this.addr + 0 + 8 >> 2] = 0;
      HEAP_u32[this.addr + 0 + 12 >> 2] = 0;
    } else {
      STRING_CACHE.set(this.addr + 0, value); binding.writeString(this.addr + 0, value);
    };
  }

  get priority(): PriorityVariants {
    return Priority.get(this.addr + 138);
  }

  set priority(value: PriorityVariants): void {
    Priority.set(this.addr + 138, value);
  }

  get bundleBehavior(): BundleBehaviorVariants {
    return BundleBehavior.get(this.addr + 139);
  }

  set bundleBehavior(value: BundleBehaviorVariants): void {
    BundleBehavior.set(this.addr + 139, value);
  }

  get flags(): number {
    return HEAP[this.addr + 136];
  }

  set flags(value: number): void {
    HEAP[this.addr + 136] = value;
  }

  get loc(): ?SourceLocation {
    return HEAP_u32[(this.addr + 104) >> 2] ? null : SourceLocation.get(this.addr + 108);
  }

  set loc(value: ?SourceLocation): void {
    HEAP_u32[(this.addr + 104) >> 2] = value == null ? 0 : 1;
    if (value != null) SourceLocation.set(this.addr + 108, value);
  }

  get placeholder(): ?string {
    return HEAP_u32[this.addr + 24 + 8 >> 2] === 0 && HEAP_u32[this.addr + 24 + 12 >> 2] === 0 ? null : readCachedString(this.addr + 24);
  }

  set placeholder(value: ?string): void {
    if (value == null) {
      HEAP_u32[this.addr + 24 + 8 >> 2] = 0;
      HEAP_u32[this.addr + 24 + 12 >> 2] = 0;
    } else {
      STRING_CACHE.set(this.addr + 24, value); binding.writeString(this.addr + 24, value);
    };
  }

  get target(): number {
    return HEAP_u32[(this.addr + 132) >> 2];
  }

  set target(value: number): void {
    HEAP_u32[(this.addr + 132) >> 2] = value;
  }

  get symbols(): Vec<Symbol> {
    return new Vec(this.addr + 72, 80, Symbol);
  }

  set symbols(value: Vec<Symbol>): void {
    HEAP.set(HEAP.subarray(value.addr, value.addr + 24), this.addr + 72);;
  }
}

export const DependencyFlags = {
  ENTRY: 0b1,
  OPTIONAL: 0b10,
  NEEDS_STABLE_NAME: 0b100,
};

type SpecifierTypeVariants = 'esm' | 'commonjs' | 'url' | 'custom';

export class SpecifierType {
  static get(addr: number): SpecifierTypeVariants {
    switch (HEAP[addr]) {
      case 0:
        return 'esm';
      case 1:
        return 'commonjs';
      case 2:
        return 'url';
      case 3:
        return 'custom';
      default:
        throw new Error(`Unknown SpecifierType value: ${HEAP[addr]}`);
    }
  }

  static set(addr: number, value: SpecifierTypeVariants): void {
    let buf = HEAP;
    switch (value) {
      case 'esm':
        buf[addr] = 0;
        break;
      case 'commonjs':
        buf[addr] = 1;
        break;
      case 'url':
        buf[addr] = 2;
        break;
      case 'custom':
        buf[addr] = 3;
        break;
      default:
        throw new Error(`Unknown SpecifierType value: ${value}`);
    }
  }
}

type PriorityVariants = 'sync' | 'parallel' | 'lazy';

export class Priority {
  static get(addr: number): PriorityVariants {
    switch (HEAP[addr]) {
      case 0:
        return 'sync';
      case 1:
        return 'parallel';
      case 2:
        return 'lazy';
      default:
        throw new Error(`Unknown Priority value: ${HEAP[addr]}`);
    }
  }

  static set(addr: number, value: PriorityVariants): void {
    let buf = HEAP;
    switch (value) {
      case 'sync':
        buf[addr] = 0;
        break;
      case 'parallel':
        buf[addr] = 1;
        break;
      case 'lazy':
        buf[addr] = 2;
        break;
      default:
        throw new Error(`Unknown Priority value: ${value}`);
    }
  }
}

export class Symbol {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(80);
  }

  static get(addr: number): Symbol {
    return new Symbol(addr);
  }

  static set(addr: number, value: Symbol): void {
    HEAP.set(HEAP.subarray(value.addr, value.addr + 80), addr);
  }

  get exported(): string {
    return readCachedString(this.addr + 0);
  }

  set exported(value: string): void {
    STRING_CACHE.set(this.addr + 0, value); binding.writeString(this.addr + 0, value);
  }

  get local(): string {
    return readCachedString(this.addr + 24);
  }

  set local(value: string): void {
    STRING_CACHE.set(this.addr + 24, value); binding.writeString(this.addr + 24, value);
  }

  get loc(): ?SourceLocation {
    return HEAP_u32[(this.addr + 48) >> 2] ? null : SourceLocation.get(this.addr + 52);
  }

  set loc(value: ?SourceLocation): void {
    HEAP_u32[(this.addr + 48) >> 2] = value == null ? 0 : 1;
    if (value != null) SourceLocation.set(this.addr + 52, value);
  }

  get isWeak(): boolean {
    return !!HEAP[this.addr + 72];
  }

  set isWeak(value: boolean): void {
    HEAP[this.addr + 72] = value ? 1 : 0;
  }
}

