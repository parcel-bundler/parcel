// @flow strict-local

export function jsCallable<Args: $ReadOnlyArray<mixed>, Return>(
  fn: (...Args) => Return,
): (...Args) => Return {
  return (...args: Args) => {
    try {
      return fn(...args);
    } catch (err) {
      return err;
    }
  };
}
