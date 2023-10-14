// @flow strict-local

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

export class BitSet {
  bits: Uint32Array;

  constructor(maxBits: number) {
    this.bits = new Uint32Array(Math.ceil(maxBits / 32));
  }

  clone(): BitSet {
    let res = new BitSet(this.capacity);
    res.bits.set(this.bits);
    return res;
  }

  static union(a: BitSet, b: BitSet): BitSet {
    let res = a.clone();
    res.union(b);
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

  empty(): boolean {
    for (let k = 0; k < this.bits.length; k++) {
      if (this.bits[k] !== 0) {
        return false;
      }
    }

    return true;
  }

  clear() {
    this.bits.fill(0);
  }

  intersect(other: BitSet) {
    for (let i = 0; i < this.bits.length; i++) {
      this.bits[i] &= other.bits[i];
    }
  }

  union(other: BitSet) {
    for (let i = 0; i < this.bits.length; i++) {
      this.bits[i] |= other.bits[i];
    }
  }

  remove(other: BitSet) {
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
