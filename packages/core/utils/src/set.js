// @flow

export function setIntersects<T>(a: Set<T>, b: Set<T>): boolean {
  for (let item of a) {
    if (b.has(item)) {
      return true;
    }
  }

  return false;
}

export function isSetEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) {
    return false;
  }

  for (let item of a) {
    if (!b.has(item)) {
      return false;
    }
  }

  return true;
}

/**
 * Returns true if either set is a subset of the other.
 */
export function isSubset<T>(a: Set<T>, b: Set<T>): boolean {
  let res = true;
  for (let item of b) {
    if (!a.has(item)) {
      res = false;
      break;
    }
  }

  if (!res) {
    res = true;
    for (let item of a) {
      if (!b.has(item)) {
        res = false;
        break;
      }
    }
  }

  return res;
}
