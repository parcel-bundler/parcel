import type {FilePath, PackageInstaller, PackageManager} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

export type {
  PackageManagerResolveResult,
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
