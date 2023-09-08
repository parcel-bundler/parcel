// @flow
import type {
  FilePath,
  FileSystem,
  FileCreateInvalidation,
  SemverRange,
} from '@parcel/types';

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
  invalidateOnStartup: boolean,
|};

export type ModuleRequest = {|
  +name: string,
  +range: ?SemverRange,
|};
