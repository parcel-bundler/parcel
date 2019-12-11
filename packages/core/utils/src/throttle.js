// @flow strict-local

export default function throttle<TArgs: Iterable<mixed>>(
  fn: (...args: TArgs) => mixed,
  delay: number,
): (...args: TArgs) => void {
  let timeout;

  return function(...args: TArgs) {
    if (timeout) {
      return;
    }

    timeout = setTimeout(() => {
      timeout = null;
      fn(...args);
    }, delay);
  };
}
