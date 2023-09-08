//@flow

import type {
  FilePath,
  FileCreateInvalidation,
  SemverRange,
  DependencySpecifier,
  PackageJSON,
} from './index';

export type Invalidations = {|
  invalidateOnFileCreate: Array<FileCreateInvalidation>,
  invalidateOnFileChange: Set<FilePath>,
  invalidateOnStartup: boolean,
|};

export type ResolveResult = {|
  resolved: FilePath | DependencySpecifier,
  pkg?: ?PackageJSON,
  invalidateOnFileCreate: Array<FileCreateInvalidation>,
  invalidateOnFileChange: Set<FilePath>,
  type: number,
|};

export interface PackageManager {
  require(
    id: DependencySpecifier,
    from: FilePath,
    ?{|range?: ?SemverRange, shouldAutoInstall?: boolean, saveDev?: boolean|},
  ): Promise<any>;
  resolve(
    id: DependencySpecifier,
    from: FilePath,
    ?{|range?: ?SemverRange, shouldAutoInstall?: boolean, saveDev?: boolean|},
  ): Promise<ResolveResult>;
  getInvalidations(id: DependencySpecifier, from: FilePath): Invalidations;
  invalidate(id: DependencySpecifier, from: FilePath): void;
}
