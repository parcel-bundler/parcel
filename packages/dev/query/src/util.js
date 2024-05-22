// @flow strict-local

export function findLast<T>(arr: T[], predicate: T => boolean): T | void {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const el = arr[i];
    if (predicate(el)) {
      return el;
    }
  }
}
