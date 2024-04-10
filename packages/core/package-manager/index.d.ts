import type {
  FilePath,
  PackageInstaller,
  PackageManager,
  PackageManagerResolveResult,
} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

export type {PackageManagerResolveResult};
export type {PackageManagerResolveResult as ResolveResult};

export type {
  PackageManager,
  InstallOptions,
  InstallerOptions,
  PackageInstaller,
  Invalidations,
  ModuleRequest,
} from '@parcel/types';

export const Npm: {
  new (): PackageInstaller;
};
export const Pnpm: {
  new (): PackageInstaller;
};
export const Yarn: {
  new (): PackageInstaller;
};

export const MockPackageInstaller: {
  new (): PackageInstaller;
};
export const NodePackageManager: {
  new (
    fs: FileSystem,
    projectRoot: FilePath,
    installer?: PackageInstaller,
  ): PackageManager;
};
