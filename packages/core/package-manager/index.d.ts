import type {
  FilePath,
  PackageInstaller,
  PackageManager,
  PackageManagerResolveResult,
} from '@atlaspack/types';
import type {FileSystem} from '@atlaspack/fs';

export type {PackageManagerResolveResult};
export type {PackageManagerResolveResult as ResolveResult};

export type {
  PackageManager,
  InstallOptions,
  InstallerOptions,
  PackageInstaller,
  Invalidations,
  ModuleRequest,
} from '@atlaspack/types';

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
