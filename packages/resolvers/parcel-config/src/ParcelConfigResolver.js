// @flow
import path from 'path';
import {Resolver} from '@parcel/plugin';
import {resolveConfig} from '@parcel/utils/src/config';

import type {CLIOptions, Dependency} from '@parcel/types';

export default new Resolver({
  async resolve(dep: Dependency, opts: ParcelOptions, rootDir: string) {
    if (dep.moduleSpecifier !== '.parcelrc') {
      return null;
    }

    return resolveConfig(path.join(dep.sourcePath), ['.parcelrc']);
  }
});
