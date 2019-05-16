// @flow strict-local

export function unique<T>(array: Array<T>): Array<T> {
  return [...new Set(array)];
}
