// @flow

import type {FilePath, ModuleSpecifier} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

export type InstallOptions = {|
  modules: Array<ModuleSpecifier>,
  fs: FileSystem,
  cwd: FilePath,
  packagePath?: ?FilePath,
  saveDev?: boolean
|};

export interface PackageManager {
  install(opts: InstallOptions): Promise<void>;
}
