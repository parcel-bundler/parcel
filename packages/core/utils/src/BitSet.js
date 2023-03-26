// @flow strict-local
import nullthrows from 'nullthrows';

// As our current version of flow doesn't support BigInt's, these values/types
// have been hoisted to keep the flow errors to a minimum. This can be removed
// if we upgrade to a flow version that supports BigInt's
// $FlowFixMe
type TmpBigInt = bigint;
// $FlowFixMe
const BIGINT_ZERO = 0n;
// $FlowFixMe
const BIGINT_ONE = 1n;
// $FlowFixMe
let numberToBigInt = (v: number): TmpBigInt => BigInt(v);

let bitUnion = (a: TmpBigInt, b: TmpBigInt): TmpBigInt => a | b;

export class BitSet<Item> {
  _value: TmpBigInt;
  _lookup: Map<Item, TmpBigInt>;
  _items: Array<Item>;

  constructor({
    initial,
    items,
    lookup,
  }: {|
    items: Array<Item>,
    lookup: Map<Item, number>,
    initial?: BitSet<Item> | TmpBigInt,
  |}) {
    if (initial instanceof BitSet) {
      this._value = initial?._value;
    } else if (initial) {
      this._value = initial;
    } else {
      this._value = BIGINT_ZERO;
    }

    this._items = items;
    this._lookup = lookup;
  }

  static from(items: Array<Item>): BitSet<Item> {
    let lookup: Map<Item, TmpBigInt> = new Map();
    for (let i = 0; i < items.length; i++) {
      lookup.set(items[i], numberToBigInt(i));
    }

    return new BitSet({items, lookup});
  }

  static union(a: BitSet<Item>, b: BitSet<Item>): BitSet<Item> {
    return new BitSet({
      initial: bitUnion(a._value, b._value),
      lookup: a._lookup,
      items: a._items,
    });
  }

  #getIndex(item: Item) {
    return nullthrows(this._lookup.get(item), 'Item is missing from BitSet');
  }

  add(item: Item) {
    this._value |= BIGINT_ONE << this.#getIndex(item);
  }

  delete(item: Item) {
    this._value &= ~(BIGINT_ONE << this.#getIndex(item));
  }

  has(item: Item): boolean {
    return Boolean(this._value & (BIGINT_ONE << this.#getIndex(item)));
  }

  intersect(v: BitSet<Item>) {
    this._value = this._value & v._value;
  }

  union(v: BitSet<Item>) {
    this._value = bitUnion(this._value, v._value);
  }

  clear() {
    this._value = BIGINT_ZERO;
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
      initial: this._value,
    });
  }

  values(): Array<Item> {
    let values = [];
    let tmpValue = this._value;
    let i;

    // This implementation is optimized for BitSets that contain a very small percentage
    // of items compared to the total number of potential items. This makes sense for
    // our bundler use-cases where Sets often contain <1% coverage of the total item count.
    // In cases where Sets contain a larger percentage of the total items, a regular looping
    // strategy would be more performant.
    while (tmpValue > BIGINT_ZERO) {
      // Get last set bit
      i = tmpValue.toString(2).length - 1;

      values.push(this._items[i]);

      // Unset last set bit
      tmpValue &= ~(BIGINT_ONE << numberToBigInt(i));
    }

    return values;
  }
}
