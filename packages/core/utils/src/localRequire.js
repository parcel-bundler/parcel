// @flow strict-local

import type {FilePath, PackageJSON} from '@parcel/types';

import installPackage from './installPackage';
import {dirname} from 'path';

import resolve from './resolve';

const cache: Map<string, [string, ?PackageJSON]> = new Map();

export default async function localRequire(
  name: string,
  path: FilePath,
  triedInstall: boolean = false
  // $FlowFixMe this must be dynamic
): Promise<any> {
  let [resolved] = await localResolve(name, path, triedInstall);
  // $FlowFixMe this must be dynamic
  return require(resolved);
}

export async function localResolve(
  name: string,
  path: FilePath,
  triedInstall: boolean = false
): Promise<[string, ?PackageJSON]> {
  let basedir = dirname(path);
  let key = basedir + ':' + name;
  let resolved = cache.get(key);
  if (!resolved) {
    try {
      resolved = await resolve(name, {basedir, extensions: ['.js', '.json']});
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND' && !triedInstall) {
        await installPackage([name], path);
        return localResolve(name, path, true);
      }
      throw e;
    }
    cache.set(key, resolved);
  }

  return resolved;
}

export function resetCache() {
  cache = new Cache();
}
