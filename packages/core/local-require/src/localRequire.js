// @flow strict-local

import type {FilePath, PackageJSON} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

import installPackage from '@parcel/install-package';
import {dirname} from 'path';
import {resolve} from '@parcel/utils';
import {NodeFS} from '@parcel/fs';

const cache: Map<string, [string, ?PackageJSON]> = new Map();
const nodeFS = new NodeFS();

export default async function localRequire(
  name: string,
  path: FilePath,
  triedInstall: boolean = false
  // $FlowFixMe this must be dynamic
): Promise<any> {
  let [resolved] = await localResolve(name, path, nodeFS, triedInstall);
  // $FlowFixMe this must be dynamic
  return require(resolved);
}

export async function localResolve(
  name: string,
  path: FilePath,
  fs: FileSystem = nodeFS,
  triedInstall: boolean = false
): Promise<[string, ?PackageJSON]> {
  let basedir = dirname(path);
  let key = basedir + ':' + name;
  let resolved = cache.get(key);
  if (!resolved) {
    try {
      resolved = await resolve(fs, name, {
        basedir,
        extensions: ['.js', '.json']
      });
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND' && !triedInstall) {
        await installPackage(fs, [name], path);
        return localResolve(name, path, fs, true);
      }
      throw e;
    }
    cache.set(key, resolved);
  }

  return resolved;
}
