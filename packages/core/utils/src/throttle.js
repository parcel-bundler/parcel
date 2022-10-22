// @flow strict-local

export default function throttle<TArgs: Iterable<mixed>>(
  fn: (...args: TArgs) => mixed,
  delay: number,
): (...args: TArgs) => void {
  let lastCalled: ?number;

  // $FlowFixMe[missing-this-annot]
  return function throttled(...args: TArgs) {
    if (lastCalled == null || lastCalled + delay <= Date.now()) {
      fn.call(this, ...args);
      lastCalled = Date.now();
    }
  };
}
