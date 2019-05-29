// @flow strict-local

export default class DefaultMap<K, V> extends Map<K, V> {
  _getDefault: K => V;

  constructor(getDefault: K => V, entries?: Iterable<[K, V]>) {
    super(entries);
    this._getDefault = getDefault;
  }

  get(key: K): V {
    let ret;
    if (this.has(key)) {
      ret = super.get(key);
    } else {
      ret = this._getDefault(key);
      this.set(key, ret);
    }

    // $FlowFixMe
    return ret;
  }
}
