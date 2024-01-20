type Snapshot<T> = {
  readonly [K in keyof T]: Snapshot<T[K]>;
};

export function snapShot<V>(): Snapshot<V> {
  return 1 as any;
}
