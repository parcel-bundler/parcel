// @flow strict-local

export function unique<T>(array: Array<T>): Array<T> {
  return [...new Set(array)];
}

export function objectSortedEntries(obj: {
  +[string]: mixed
}): Array<[string, mixed]> {
  return Object.entries(obj).sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
}

export function objectSortedEntriesDeep(object: {
  +[string]: mixed
}): Array<[string, mixed]> {
  let sortedEntries = objectSortedEntries(object);
  for (let i = 0; i < sortedEntries.length; i++) {
    sortedEntries[i][1] = sortEntry(sortedEntries[i][1]);
  }
  return sortedEntries;
}

function sortEntry(entry: mixed) {
  if (Array.isArray(entry)) {
    return entry.map(sortEntry);
  }

  if (typeof entry === 'object' && entry != null) {
    return objectSortedEntriesDeep(entry);
  }

  return entry;
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
