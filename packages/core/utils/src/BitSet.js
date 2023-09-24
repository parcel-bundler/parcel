// @flow strict-local
import nullthrows from 'nullthrows';

export class BitSet<Item> {
  _value: RawBitSet;
  _lookup: Map<Item, number>;
  _items: Array<Item>;

  constructor({
    initial,
    items,
    lookup,
  }: {|
    items: Array<Item>,
    lookup: Map<Item, number>,
    initial?: BitSet<Item> | RawBitSet,
  |}) {
    if (initial instanceof BitSet) {
      this._value = initial?._value;
    } else if (initial) {
      this._value = initial;
    } else {
      this._value = new RawBitSet(items.length);
    }

    this._items = items;
    this._lookup = lookup;
  }

  static from(items: Array<Item>): BitSet<Item> {
    let lookup: Map<Item, number> = new Map();
    for (let i = 0; i < items.length; i++) {
      lookup.set(items[i], i);
    }

    return new BitSet({items, lookup});
  }

  static union(a: BitSet<Item>, b: BitSet<Item>): BitSet<Item> {
    let value = a._value.clone();
    value.union(b._value);
    return new BitSet({
      initial: value,
      lookup: a._lookup,
      items: a._items,
    });
  }

  #getIndex(item: Item) {
    return nullthrows(this._lookup.get(item), 'Item is missing from BitSet');
  }

  add(item: Item) {
    this._value.add(this.#getIndex(item));
  }

  delete(item: Item) {
    this._value.delete(this.#getIndex(item));
  }

  has(item: Item): boolean {
    return this._value.has(this.#getIndex(item));
  }

  intersect(v: BitSet<Item>) {
    this._value.intersect(v._value);
  }

  union(v: BitSet<Item>) {
    this._value.union(v._value);
  }

  unionRaw(v: RawBitSet) {
    this._value.union(v);
  }

  clear() {
    this._value.clear();
  }

  cloneEmpty(): BitSet<Item> {
    return new BitSet({
      lookup: this._lookup,
      items: this._items,
    });
  }

  clone(): BitSet<Item> {
    return new BitSet({
      lookup: this._lookup,
      items: this._items,
      initial: this._value.clone(),
    });
  }

  values(): Array<Item> {
    let values = [];
    this._value.forEach(i => {
      values.push(this._items[i]);
    });

    return values;
  }
}

// Small wasm program that exposes the `ctz` instruction.
// https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/Numeric/Count_trailing_zeros
const wasmBuf = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x06, 0x01, 0x60, 0x01,
  0x7f, 0x01, 0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x0d, 0x01, 0x09, 0x74, 0x72,
  0x61, 0x69, 0x6c, 0x69, 0x6e, 0x67, 0x30, 0x00, 0x00, 0x0a, 0x07, 0x01, 0x05,
  0x00, 0x20, 0x00, 0x68, 0x0b, 0x00, 0x0f, 0x04, 0x6e, 0x61, 0x6d, 0x65, 0x02,
  0x08, 0x01, 0x00, 0x01, 0x00, 0x03, 0x6e, 0x75, 0x6d,
]);

// eslint-disable-next-line
const {trailing0} = new WebAssembly.Instance(new WebAssembly.Module(wasmBuf))
  .exports;

export class RawBitSet {
  bits: Uint32Array;

  constructor(maxBits: number) {
    this.bits = new Uint32Array(Math.ceil(maxBits / 32));
  }

  clone(): RawBitSet {
    let res = new RawBitSet(this.capacity);
    res.bits.set(this.bits);
    return res;
  }

  get capacity(): number {
    return this.bits.length * 32;
  }

  add(bit: number) {
    let i = bit >>> 5;
    let b = bit & 31;
    this.bits[i] |= 1 << b;
  }

  delete(bit: number) {
    let i = bit >>> 5;
    let b = bit & 31;
    this.bits[i] &= ~(1 << b);
  }

  has(bit: number): boolean {
    let i = bit >>> 5;
    let b = bit & 31;
    return Boolean(this.bits[i] & (1 << b));
  }

  clear() {
    this.bits.fill(0);
  }

  intersect(other: RawBitSet) {
    for (let i = 0; i < this.bits.length; i++) {
      this.bits[i] &= other.bits[i];
    }
  }

  union(other: RawBitSet) {
    for (let i = 0; i < this.bits.length; i++) {
      this.bits[i] |= other.bits[i];
    }
  }

  remove(other: RawBitSet) {
    for (let i = 0; i < this.bits.length; i++) {
      this.bits[i] &= ~other.bits[i];
    }
  }

  forEach(fn: (bit: number) => void) {
    // https://lemire.me/blog/2018/02/21/iterating-over-set-bits-quickly/
    let bits = this.bits;
    for (let k = 0; k < bits.length; k++) {
      let v = bits[k];
      while (v !== 0) {
        let t = (v & -v) >>> 0;
        // $FlowFixMe
        fn((k << 5) + trailing0(v));
        v ^= t;
      }
    }
  }
}
