import nullthrows from 'nullthrows';

let bitUnion = (a: BigInt, b: BigInt): BigInt => a | b;

export class BitSet<Item> {
  _value: bigint;
  _lookup: Map<Item, bigint>;
  _items: Array<Item>;

  constructor({
    initial,
    items,
    lookup,
  }: {|
    items: Array<Item>,
    lookup: Map<Item, number>,
    initial?: BitSet<Item> | bigint,
  |}) {
    if (initial instanceof BitSet) {
      this._value = initial?._value;
    } else if (initial) {
      this._value = initial;
    } else {
      this._value = 0n;
    }

    this._items = items;
    this._lookup = lookup;
  }

  static from(items: Array<Item>): BitSet<Item> {
    let lookup = new Map<Item, bigint>();
    for (let i = 0; i < items.length; i++) {
      lookup.set(items[i], BigInt(i));
    }

    return new BitSet({items, lookup});
  }

  static union(a: BitSet<Item>, b: BitSet<Item>): BitSet<Item> {
    return new BitSet<Item>({
      initial: bitUnion(a._value, b._value),
      lookup: a._lookup,
      items: a._items,
    });
  }

  #getIndex(item: Item) {
    return nullthrows(this._lookup.get(item), 'Item is missing from BitSet');
  }

  add(item: Item) {
    this._value |= 1n << this.#getIndex(item);
  }

  delete(item: Item) {
    this._value &= ~(1n << this.#getIndex(item));
  }

  has(item: Item): boolean {
    return Boolean(this._value & (1n << this.#getIndex(item)));
  }

  intersect(v: BitSet<Item>) {
    this._value = this._value & v._value;
  }

  union(v: BitSet<Item>) {
    this._value = bitUnion(this._value, v._value);
  }

  cloneEmpty(): BitSet<Item> {
    return new BitSet<Item>({
      lookup: this._lookup,
      items: this._items,
    });
  }

  clone(): BitSet<Item> {
    return new BitSet<Item>({
      lookup: this._lookup,
      items: this._items,
      initial: this._value,
    });
  }

  values(): Array<Item> {
    let values = [];
    let tmpValue = this._value;
    let i;

    while (tmpValue > 0n) {
      // Get last set bit
      i = tmpValue.toString(2).length - 1;

      values.push(this._items[i]);

      // Unset last set bit
      tmpValue &= ~(1n << BigInt(i));
    }

    return values;
  }
}
