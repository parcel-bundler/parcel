// @flow

import type {FilePath, SemverRange, ModuleSpecifier} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {ResolveResult} from '@parcel/utils';

export type InstallOptions = {
  installPeers?: boolean,
  saveDev?: boolean,
  packageInstaller?: ?PackageInstaller,
  ...
};

export type InstallerOptions = {|
  modules: Array<ModuleRequest>,
  fs: FileSystem,
  cwd: FilePath,
  packagePath?: ?FilePath,
  saveDev?: boolean,
|};

export interface PackageInstaller {
  install(opts: InstallerOptions): Promise<void>;
}

export interface PackageManager {
  require(
    id: ModuleSpecifier,
    from: FilePath,
    ?{|range?: SemverRange, shouldAutoInstall?: boolean, saveDev?: boolean|},
  ): Promise<any>;
  resolve(
    id: ModuleSpecifier,
    from: FilePath,
    ?{|range?: SemverRange, shouldAutoInstall?: boolean, saveDev?: boolean|},
  ): Promise<ResolveResult>;
}

export type ModuleRequest = {|
  +name: string,
  +range: ?SemverRange,
|};
