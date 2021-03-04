// @flow strict-local
import type {FilePath} from '@parcel/types';
import path from 'path';
import {relativePath} from '@parcel/utils';

/**
 * A path that's relative to the project root.
 */
export opaque type ProjectPath = string;

function toProjectPath_(projectRoot: FilePath, p: FilePath): ProjectPath {
  return p != null ? relativePath(projectRoot, p, false) : p;
}

export const toProjectPath: ((
  projectRoot: FilePath,
  p: FilePath,
) => ProjectPath) &
  ((projectRoot: FilePath, p: FilePath | void) => ProjectPath | void) &
  // $FlowFixMe Not sure how to type properly
  ((projectRoot: FilePath, p: ?FilePath) => ?ProjectPath) = toProjectPath_;

function fromProjectPath_(projectRoot: FilePath, p: ?ProjectPath): ?FilePath {
  return p != null ? path.join(projectRoot, p) : p;
}

export const fromProjectPath: ((
  projectRoot: FilePath,
  p: ProjectPath,
) => FilePath) &
  // $FlowFixMe Not sure how to type properly
  ((projectRoot: FilePath, p: ?ProjectPath) => ?FilePath) = fromProjectPath_;

/**
 * Returns a path relative to the project root. This should be used when computing cache keys
 */
export function fromProjectPathRelative(p: ProjectPath): FilePath {
  return p;
}

/**
 * This function should be avoided, it doesn't change the actual value.
 */
export function toProjectPathUnsafe(p: FilePath): ProjectPath {
  return p;
}

/**
 * Joins a project root with relative paths (similar to `path.join`)
 */
export function joinProjectPath(
  a: ProjectPath,
  ...b: Array<FilePath>
): ProjectPath {
  return path.join(a, ...b);
}
