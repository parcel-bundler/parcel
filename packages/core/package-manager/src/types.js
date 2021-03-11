// @flow

import type {
  FilePath,
  FileCreateInvalidation,
  SemverRange,
  ModuleSpecifier,
} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {ResolveResult} from './NodeResolverBase';

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

export type Invalidations = {|
  invalidateOnFileCreate: Array<FileCreateInvalidation>,
  invalidateOnFileChange: Set<FilePath>,
|};

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
  getInvalidations(id: ModuleSpecifier, from: FilePath): Invalidations;
  invalidate(id: ModuleSpecifier, from: FilePath): void;
}

export type ModuleRequest = {|
  +name: string,
  +range: ?SemverRange,
|};
