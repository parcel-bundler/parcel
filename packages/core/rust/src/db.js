// @flow
import binding from '../index';

const HEAP = [];
const HEAP_u32 = [];
const STRING_CACHE = new Map();

const PAGE_INDEX_SIZE = 16;
const PAGE_INDEX_SHIFT = 32 - PAGE_INDEX_SIZE;
const PAGE_INDEX_MASK = ((1 << PAGE_INDEX_SIZE) - 1) << PAGE_INDEX_SHIFT;
const PAGE_OFFSET_MASK = (1 << PAGE_INDEX_SHIFT) - 1;

function copy(from: number, to: number, size: number) {
  let fromPage = (from & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let fromOffset = from & PAGE_OFFSET_MASK;
  let fromHeapPage = HEAP[fromPage] ??= binding.getPage(fromPage);
  let toPage = (to & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let toOffset = to & PAGE_OFFSET_MASK;
  let toHeapPage = HEAP[toPage] ??= binding.getPage(toPage);
  toHeapPage.set(fromHeapPage.subarray(fromOffset, fromOffset + size), toOffset);
}

function readU8(addr: number): number {
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heapPage = HEAP[page] ??= binding.getPage(page);
  return heapPage[offset];
}

function writeU8(addr: number, value: number) {
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heapPage = HEAP[page] ??= binding.getPage(page);
  return heapPage[offset] = value;
}

function readU32(addr: number): number {
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heapPage = HEAP_u32[page] ??= new Uint32Array((HEAP[page] ??= binding.getPage(page)).buffer);
  return heapPage[offset >> 2];
}

function writeU32(addr: number, value: number) {
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heapPage = HEAP_u32[page] ??= new Uint32Array((HEAP[page] ??= binding.getPage(page)).buffer);
  return heapPage[offset >> 2] = value;
}

export function readCachedString(addr: number): string {
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
    return readU32(this.addr + 4);
  }

  get capacity(): number {
    return readU32(this.addr + 8);
  }

  get(index: number): T {
    let bufAddr = readU32(this.addr + 0);
    return this.accessor.get(bufAddr + index * this.size);
  }

  set(index: number, value: T): void {
    if (index >= this.length) {
      throw new Error(`Index out of bounds: ${index} >= ${this.length}`);
    }
    let bufAddr = readU32(this.addr + 0);
    this.accessor.set(bufAddr + index * this.size, value);
  }

  reserve(count: number): void {
    if (this.length + count > this.capacity) {
      binding.extendVec(this.addr, this.size, count);
    }
  }

  push(value: T): void {
    this.reserve(1);
    writeU32(this.addr + 4, readU32(this.addr + 4) + 1);
    this.set(this.length - 1, value);
  }

  extend(): T {
    this.reserve(1);
    writeU32(this.addr + 4, readU32(this.addr + 4) + 1);
    return this.get(this.length - 1);
  }

  clear(): void {
    // TODO: run Rust destructors?
    writeU32(this.addr + 4, 0);
  }

  // $FlowFixMe
  *[globalThis.Symbol.iterator]() {
    let addr = readU32(this.addr + 0);
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {
      yield this.accessor.get(addr);
    }
  }

  find(pred: (value: T) => boolean): ?T {
    let addr = readU32(this.addr + 0);
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {
      let value = this.accessor.get(addr);
      if (pred(value)) {
        return value;
      }
    }
  }

  some(pred: (value: T) => boolean): boolean {
    let addr = readU32(this.addr + 0);
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
    this.addr = addr ?? binding.alloc(44);
  }

  static get(addr: number): Target {
    return new Target(addr);
  }

  static set(addr: number, value: Target): void {
    copy(value.addr, addr, 44);
  }

  get env(): number {
    return readU32(this.addr + 0);
  }

  set env(value: number): void {
    writeU32(this.addr + 0, value);
  }

  get distDir(): string {
    return readCachedString(readU32(this.addr + 32));
  }

  set distDir(value: string): void {
    writeU32(this.addr + 32, binding.getStringId(value));
  }

  get distEntry(): ?string {
    return readU32(this.addr + 4 + 0) === 0 ? null : readCachedString(readU32(this.addr + 4));
  }

  set distEntry(value: ?string): void {
    if (value == null) {
      writeU32(this.addr + 4 + 0, 0);
    } else {
      writeU32(this.addr + 4, binding.getStringId(value));
    };
  }

  get name(): string {
    return readCachedString(readU32(this.addr + 36));
  }

  set name(value: string): void {
    writeU32(this.addr + 36, binding.getStringId(value));
  }

  get publicUrl(): string {
    return readCachedString(readU32(this.addr + 40));
  }

  set publicUrl(value: string): void {
    writeU32(this.addr + 40, binding.getStringId(value));
  }

  get loc(): ?SourceLocation {
    return readU32(this.addr + 8 + 16) === 0 ? null : SourceLocation.get(this.addr + 8);
  }

  set loc(value: ?SourceLocation): void {
    if (value == null) {
      writeU32(this.addr + 8 + 16, 0);
    } else {
      SourceLocation.set(this.addr + 8, value);
    };
  }

  get pipeline(): ?string {
    return readU32(this.addr + 28 + 0) === 0 ? null : readCachedString(readU32(this.addr + 28));
  }

  set pipeline(value: ?string): void {
    if (value == null) {
      writeU32(this.addr + 28 + 0, 0);
    } else {
      writeU32(this.addr + 28, binding.getStringId(value));
    };
  }
}

export class Environment {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(36);
  }

  static get(addr: number): Environment {
    return new Environment(addr);
  }

  static set(addr: number, value: Environment): void {
    copy(value.addr, addr, 36);
  }

  get context(): EnvironmentContextVariants {
    return EnvironmentContext.get(this.addr + 33);
  }

  set context(value: EnvironmentContextVariants): void {
    EnvironmentContext.set(this.addr + 33, value);
  }

  get outputFormat(): OutputFormatVariants {
    return OutputFormat.get(this.addr + 34);
  }

  set outputFormat(value: OutputFormatVariants): void {
    OutputFormat.set(this.addr + 34, value);
  }

  get sourceType(): SourceTypeVariants {
    return SourceType.get(this.addr + 35);
  }

  set sourceType(value: SourceTypeVariants): void {
    SourceType.set(this.addr + 35, value);
  }

  get flags(): number {
    return readU8(this.addr + 32);
  }

  set flags(value: number): void {
    writeU8(this.addr + 32, value);
  }

  get sourceMap(): ?TargetSourceMapOptions {
    return readU8(this.addr + 0 + 4) === 2 ? null : TargetSourceMapOptions.get(this.addr + 0);
  }

  set sourceMap(value: ?TargetSourceMapOptions): void {
    if (value == null) {
      writeU8(this.addr + 0 + 4, 2);
    } else {
      TargetSourceMapOptions.set(this.addr + 0, value);
    };
  }

  get loc(): ?SourceLocation {
    return readU32(this.addr + 8 + 16) === 0 ? null : SourceLocation.get(this.addr + 8);
  }

  set loc(value: ?SourceLocation): void {
    if (value == null) {
      writeU32(this.addr + 8 + 16, 0);
    } else {
      SourceLocation.set(this.addr + 8, value);
    };
  }

  get includeNodeModules(): string {
    return readCachedString(readU32(this.addr + 28));
  }

  set includeNodeModules(value: string): void {
    writeU32(this.addr + 28, binding.getStringId(value));
  }
}

export class TargetSourceMapOptions {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(8);
  }

  static get(addr: number): TargetSourceMapOptions {
    return new TargetSourceMapOptions(addr);
  }

  static set(addr: number, value: TargetSourceMapOptions): void {
    copy(value.addr, addr, 8);
  }

  get sourceRoot(): ?string {
    return readU32(this.addr + 0 + 0) === 0 ? null : readCachedString(readU32(this.addr + 0));
  }

  set sourceRoot(value: ?string): void {
    if (value == null) {
      writeU32(this.addr + 0 + 0, 0);
    } else {
      writeU32(this.addr + 0, binding.getStringId(value));
    };
  }

  get inline(): boolean {
    return !!readU8(this.addr + 4);
  }

  set inline(value: boolean): void {
    writeU8(this.addr + 4, value ? 1 : 0);
  }

  get inlineSources(): boolean {
    return !!readU8(this.addr + 5);
  }

  set inlineSources(value: boolean): void {
    writeU8(this.addr + 5, value ? 1 : 0);
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
    copy(value.addr, addr, 20);
  }

  get filePath(): string {
    return readCachedString(readU32(this.addr + 16));
  }

  set filePath(value: string): void {
    writeU32(this.addr + 16, binding.getStringId(value));
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
    copy(value.addr, addr, 8);
  }

  get line(): number {
    return readU32(this.addr + 0);
  }

  set line(value: number): void {
    writeU32(this.addr + 0, value);
  }

  get column(): number {
    return readU32(this.addr + 4);
  }

  set column(value: number): void {
    writeU32(this.addr + 4, value);
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
    switch (readU8(addr + 0)) {
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
        throw new Error(`Unknown EnvironmentContext value: ${readU8(addr)}`);
    }
  }

  static set(addr: number, value: EnvironmentContextVariants): void {
    let write = writeU8;
    switch (value) {
      case 'browser':
        write(addr + 0, 0);
        break;
      case 'web-worker':
        write(addr + 0, 1);
        break;
      case 'service-worker':
        write(addr + 0, 2);
        break;
      case 'worklet':
        write(addr + 0, 3);
        break;
      case 'node':
        write(addr + 0, 4);
        break;
      case 'electron-main':
        write(addr + 0, 5);
        break;
      case 'electron-renderer':
        write(addr + 0, 6);
        break;
      default:
        throw new Error(`Unknown EnvironmentContext value: ${value}`);
    }
  }
}

type SourceTypeVariants = 'module' | 'script';

export class SourceType {
  static get(addr: number): SourceTypeVariants {
    switch (readU8(addr + 0)) {
      case 0:
        return 'module';
      case 1:
        return 'script';
      default:
        throw new Error(`Unknown SourceType value: ${readU8(addr)}`);
    }
  }

  static set(addr: number, value: SourceTypeVariants): void {
    let write = writeU8;
    switch (value) {
      case 'module':
        write(addr + 0, 0);
        break;
      case 'script':
        write(addr + 0, 1);
        break;
      default:
        throw new Error(`Unknown SourceType value: ${value}`);
    }
  }
}

type OutputFormatVariants = 'global' | 'commonjs' | 'esmodule';

export class OutputFormat {
  static get(addr: number): OutputFormatVariants {
    switch (readU8(addr + 0)) {
      case 0:
        return 'global';
      case 1:
        return 'commonjs';
      case 2:
        return 'esmodule';
      default:
        throw new Error(`Unknown OutputFormat value: ${readU8(addr)}`);
    }
  }

  static set(addr: number, value: OutputFormatVariants): void {
    let write = writeU8;
    switch (value) {
      case 'global':
        write(addr + 0, 0);
        break;
      case 'commonjs':
        write(addr + 0, 1);
        break;
      case 'esmodule':
        write(addr + 0, 2);
        break;
      default:
        throw new Error(`Unknown OutputFormat value: ${value}`);
    }
  }
}

export class Asset {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(68);
  }

  static get(addr: number): Asset {
    return new Asset(addr);
  }

  static set(addr: number, value: Asset): void {
    copy(value.addr, addr, 68);
  }

  get filePath(): string {
    return readCachedString(readU32(this.addr + 48));
  }

  set filePath(value: string): void {
    writeU32(this.addr + 48, binding.getStringId(value));
  }

  get env(): number {
    return readU32(this.addr + 16);
  }

  set env(value: number): void {
    writeU32(this.addr + 16, value);
  }

  get query(): ?string {
    return readU32(this.addr + 20 + 0) === 0 ? null : readCachedString(readU32(this.addr + 20));
  }

  set query(value: ?string): void {
    if (value == null) {
      writeU32(this.addr + 20 + 0, 0);
    } else {
      writeU32(this.addr + 20, binding.getStringId(value));
    };
  }

  get assetType(): AssetTypeVariants {
    return AssetType.get(this.addr + 8);
  }

  set assetType(value: AssetTypeVariants): void {
    AssetType.set(this.addr + 8, value);
  }

  get contentKey(): string {
    return readCachedString(readU32(this.addr + 52));
  }

  set contentKey(value: string): void {
    writeU32(this.addr + 52, binding.getStringId(value));
  }

  get mapKey(): ?string {
    return readU32(this.addr + 24 + 0) === 0 ? null : readCachedString(readU32(this.addr + 24));
  }

  set mapKey(value: ?string): void {
    if (value == null) {
      writeU32(this.addr + 24 + 0, 0);
    } else {
      writeU32(this.addr + 24, binding.getStringId(value));
    };
  }

  get outputHash(): string {
    return readCachedString(readU32(this.addr + 56));
  }

  set outputHash(value: string): void {
    writeU32(this.addr + 56, binding.getStringId(value));
  }

  get pipeline(): ?string {
    return readU32(this.addr + 28 + 0) === 0 ? null : readCachedString(readU32(this.addr + 28));
  }

  set pipeline(value: ?string): void {
    if (value == null) {
      writeU32(this.addr + 28 + 0, 0);
    } else {
      writeU32(this.addr + 28, binding.getStringId(value));
    };
  }

  get meta(): string {
    return readCachedString(readU32(this.addr + 60));
  }

  set meta(value: string): void {
    writeU32(this.addr + 60, binding.getStringId(value));
  }

  get stats(): AssetStats {
    return AssetStats.get(this.addr + 0);
  }

  set stats(value: AssetStats): void {
    AssetStats.set(this.addr + 0, value);
  }

  get bundleBehavior(): BundleBehaviorVariants {
    return BundleBehavior.get(this.addr + 65);
  }

  set bundleBehavior(value: BundleBehaviorVariants): void {
    BundleBehavior.set(this.addr + 65, value);
  }

  get flags(): number {
    return readU8(this.addr + 64);
  }

  set flags(value: number): void {
    writeU8(this.addr + 64, value);
  }

  get symbols(): Vec<Symbol> {
    return new Vec(this.addr + 32, 32, Symbol);
  }

  set symbols(value: Vec<Symbol>): void {
    copy(value.addr, this.addr + 32, 12);;
  }

  get uniqueKey(): ?string {
    return readU32(this.addr + 44 + 0) === 0 ? null : readCachedString(readU32(this.addr + 44));
  }

  set uniqueKey(value: ?string): void {
    if (value == null) {
      writeU32(this.addr + 44 + 0, 0);
    } else {
      writeU32(this.addr + 44, binding.getStringId(value));
    };
  }
}

type AssetTypeVariants = 'js' | 'jsx' | 'ts' | 'tsx' | 'css' | 'html' | string;

export class AssetType {
  static get(addr: number): AssetTypeVariants {
    switch (readU32(addr + 0)) {
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
        return readCachedString(readU32(addr + 4));
      default:
        throw new Error(`Unknown AssetType value: ${readU32(addr)}`);
    }
  }

  static set(addr: number, value: AssetTypeVariants): void {
    let write = writeU32;
    switch (value) {
      case 'js':
        write(addr + 0, 0);
        break;
      case 'jsx':
        write(addr + 0, 1);
        break;
      case 'ts':
        write(addr + 0, 2);
        break;
      case 'tsx':
        write(addr + 0, 3);
        break;
      case 'css':
        write(addr + 0, 4);
        break;
      case 'html':
        write(addr + 0, 5);
        break;
      default:
        write(addr + 0, 6);
        writeU32(addr + 4, binding.getStringId(value));
        break;
    }
  }
}

type BundleBehaviorVariants = 'none' | 'inline' | 'isolated';

export class BundleBehavior {
  static get(addr: number): BundleBehaviorVariants {
    switch (readU8(addr + 0)) {
      case 0:
        return 'none';
      case 1:
        return 'inline';
      case 2:
        return 'isolated';
      default:
        throw new Error(`Unknown BundleBehavior value: ${readU8(addr)}`);
    }
  }

  static set(addr: number, value: BundleBehaviorVariants): void {
    let write = writeU8;
    switch (value) {
      case 'none':
        write(addr + 0, 0);
        break;
      case 'inline':
        write(addr + 0, 1);
        break;
      case 'isolated':
        write(addr + 0, 2);
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
    copy(value.addr, addr, 8);
  }

  get size(): number {
    return readU32(this.addr + 0);
  }

  set size(value: number): void {
    writeU32(this.addr + 0, value);
  }

  get time(): number {
    return readU32(this.addr + 4);
  }

  set time(value: number): void {
    writeU32(this.addr + 4, value);
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
    this.addr = addr ?? binding.alloc(64);
  }

  static get(addr: number): Dependency {
    return new Dependency(addr);
  }

  static set(addr: number, value: Dependency): void {
    copy(value.addr, addr, 64);
  }

  get sourceAssetId(): ?number {
    return readU32(this.addr + 0) ? null : readU32(this.addr + 4);
  }

  set sourceAssetId(value: ?number): void {
    writeU32(this.addr + 0, value == null ? 0 : 1);
    if (value != null) writeU32(this.addr + 4, value);
  }

  get env(): number {
    return readU32(this.addr + 8);
  }

  set env(value: number): void {
    writeU32(this.addr + 8, value);
  }

  get specifier(): string {
    return readCachedString(readU32(this.addr + 56));
  }

  set specifier(value: string): void {
    writeU32(this.addr + 56, binding.getStringId(value));
  }

  get specifierType(): SpecifierTypeVariants {
    return SpecifierType.get(this.addr + 61);
  }

  set specifierType(value: SpecifierTypeVariants): void {
    SpecifierType.set(this.addr + 61, value);
  }

  get resolveFrom(): ?string {
    return readU32(this.addr + 12 + 0) === 0 ? null : readCachedString(readU32(this.addr + 12));
  }

  set resolveFrom(value: ?string): void {
    if (value == null) {
      writeU32(this.addr + 12 + 0, 0);
    } else {
      writeU32(this.addr + 12, binding.getStringId(value));
    };
  }

  get priority(): PriorityVariants {
    return Priority.get(this.addr + 62);
  }

  set priority(value: PriorityVariants): void {
    Priority.set(this.addr + 62, value);
  }

  get bundleBehavior(): BundleBehaviorVariants {
    return BundleBehavior.get(this.addr + 63);
  }

  set bundleBehavior(value: BundleBehaviorVariants): void {
    BundleBehavior.set(this.addr + 63, value);
  }

  get flags(): number {
    return readU8(this.addr + 60);
  }

  set flags(value: number): void {
    writeU8(this.addr + 60, value);
  }

  get loc(): ?SourceLocation {
    return readU32(this.addr + 16 + 16) === 0 ? null : SourceLocation.get(this.addr + 16);
  }

  set loc(value: ?SourceLocation): void {
    if (value == null) {
      writeU32(this.addr + 16 + 16, 0);
    } else {
      SourceLocation.set(this.addr + 16, value);
    };
  }

  get placeholder(): ?string {
    return readU32(this.addr + 36 + 0) === 0 ? null : readCachedString(readU32(this.addr + 36));
  }

  set placeholder(value: ?string): void {
    if (value == null) {
      writeU32(this.addr + 36 + 0, 0);
    } else {
      writeU32(this.addr + 36, binding.getStringId(value));
    };
  }

  get target(): number {
    return readU32(this.addr + 40);
  }

  set target(value: number): void {
    writeU32(this.addr + 40, value);
  }

  get symbols(): Vec<Symbol> {
    return new Vec(this.addr + 44, 32, Symbol);
  }

  set symbols(value: Vec<Symbol>): void {
    copy(value.addr, this.addr + 44, 12);;
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
    switch (readU8(addr + 0)) {
      case 0:
        return 'esm';
      case 1:
        return 'commonjs';
      case 2:
        return 'url';
      case 3:
        return 'custom';
      default:
        throw new Error(`Unknown SpecifierType value: ${readU8(addr)}`);
    }
  }

  static set(addr: number, value: SpecifierTypeVariants): void {
    let write = writeU8;
    switch (value) {
      case 'esm':
        write(addr + 0, 0);
        break;
      case 'commonjs':
        write(addr + 0, 1);
        break;
      case 'url':
        write(addr + 0, 2);
        break;
      case 'custom':
        write(addr + 0, 3);
        break;
      default:
        throw new Error(`Unknown SpecifierType value: ${value}`);
    }
  }
}

type PriorityVariants = 'sync' | 'parallel' | 'lazy';

export class Priority {
  static get(addr: number): PriorityVariants {
    switch (readU8(addr + 0)) {
      case 0:
        return 'sync';
      case 1:
        return 'parallel';
      case 2:
        return 'lazy';
      default:
        throw new Error(`Unknown Priority value: ${readU8(addr)}`);
    }
  }

  static set(addr: number, value: PriorityVariants): void {
    let write = writeU8;
    switch (value) {
      case 'sync':
        write(addr + 0, 0);
        break;
      case 'parallel':
        write(addr + 0, 1);
        break;
      case 'lazy':
        write(addr + 0, 2);
        break;
      default:
        throw new Error(`Unknown Priority value: ${value}`);
    }
  }
}

export class Symbol {
  addr: number;

  constructor(addr?: number) {
    this.addr = addr ?? binding.alloc(32);
  }

  static get(addr: number): Symbol {
    return new Symbol(addr);
  }

  static set(addr: number, value: Symbol): void {
    copy(value.addr, addr, 32);
  }

  get exported(): number {
    return readU32(this.addr + 20);
  }

  set exported(value: number): void {
    writeU32(this.addr + 20, value);
  }

  get local(): number {
    return readU32(this.addr + 24);
  }

  set local(value: number): void {
    writeU32(this.addr + 24, value);
  }

  get loc(): ?SourceLocation {
    return readU32(this.addr + 0 + 16) === 0 ? null : SourceLocation.get(this.addr + 0);
  }

  set loc(value: ?SourceLocation): void {
    if (value == null) {
      writeU32(this.addr + 0 + 16, 0);
    } else {
      SourceLocation.set(this.addr + 0, value);
    };
  }

  get isWeak(): boolean {
    return !!readU8(this.addr + 28);
  }

  set isWeak(value: boolean): void {
    writeU8(this.addr + 28, value ? 1 : 0);
  }
}

