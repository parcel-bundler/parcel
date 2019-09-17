// @flow strict-local

export function unique<T>(array: Array<T>): Array<T> {
  return [...new Set(array)];
}

export function flatMap<T, U>(
  array: Array<T>,
  project: (T, number, Array<T>) => Array<U>
): Array<U> {
  return array.map(project).reduce((memo, val) => memo.concat(val), []);
}

export function objectSortedEntries(obj: {
  +[string]: mixed,
  ...
}): Array<[string, mixed]> {
  return Object.entries(obj).sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
}

export function objectSortedEntriesDeep(object: {
  +[string]: mixed,
  ...
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
