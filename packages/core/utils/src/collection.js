// @flow strict-local

export function unique<T>(array: Array<T>): Array<T> {
  return [...new Set(array)];
}

export function objectSortedEntries(obj: {
  [string]: mixed
}): Array<[string, mixed]> {
  return Object.entries(obj).sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
}

// $FlowFixMe
type PickableObject = Object;

export function pick(
  obj: PickableObject,
  keysToPick: Array<string>
): {[string]: mixed} {
  let picked = {};
  for (let [key, value] of Object.entries(obj)) {
    if (keysToPick.includes(key)) {
      picked[key] = value;
    }
  }

  return picked;
}
