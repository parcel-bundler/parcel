// @flow strict-local

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/clz32#implementing_count_leading_ones_and_beyond
function ctz32(n: number): number {
  if (n === 0) {
    return 32;
  }
  let reversed = n & -n;
  return 31 - Math.clz32(reversed);
}

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
        fn((k << 5) + ctz32(v));
        v ^= t;
      }
    }
  }
}
