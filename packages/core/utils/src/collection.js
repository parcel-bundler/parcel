// @flow strict-local

export function unique<T>(...arrays: Array<Array<T>>): Array<T> {
  return [...new Set(flatten(arrays))];
}

export function flatten<T>(arrays: Array<Array<T>>): Array<T> {
  let out = [];
  for (let array of arrays) {
    out.push(...array);
  }
  return out;
}
