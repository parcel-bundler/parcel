// @flow
import type {DependencyOptions, Dependency, FilePath} from '@parcel/types';
import md5 from '@parcel/utils/md5';

export default function createDependency(
  opts: DependencyOptions,
  sourcePath?: FilePath
): Dependency {
  return {
    ...opts,
    sourcePath, // TODO: get this from the graph?
    id: md5(
      `${sourcePath || 'root'}:${opts.moduleSpecifier}:${JSON.stringify(
        opts.env
      )}`
    )
  };
}
