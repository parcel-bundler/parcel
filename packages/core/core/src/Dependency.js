// @flow
import type {
  FilePath,
  Meta,
  ModuleSpecifier,
  SourceLocation,
  Symbol,
} from '@parcel/types';
import type {Dependency, Environment, Target} from './types';

import {md5FromOrderedObject} from '@parcel/utils';
import {toInternalSourceLocation} from './utils';
import {toProjectPath} from './projectPath';

type DependencyOpts = {|
  id?: string,
  sourcePath?: FilePath,
  sourceAssetId?: string,
  moduleSpecifier: ModuleSpecifier,
  isAsync?: boolean,
  isEntry?: boolean,
  isOptional?: boolean,
  isURL?: boolean,
  isIsolated?: boolean,
  loc?: SourceLocation,
  env: Environment,
  meta?: Meta,
  resolveFrom?: FilePath,
  target?: Target,
  symbols?: Map<
    Symbol,
    {|local: Symbol, loc: ?SourceLocation, isWeak: boolean, meta?: ?Meta|},
  >,
  pipeline?: ?string,
|};

export function createDependency(
  projectRoot: FilePath,
  opts: DependencyOpts,
): Dependency {
  let id =
    opts.id ||
    md5FromOrderedObject({
      sourceAssetId: opts.sourceAssetId,
      moduleSpecifier: opts.moduleSpecifier,
      env: opts.env.id,
      target: opts.target,
      pipeline: opts.pipeline,
    });

  return {
    ...opts,
    resolveFrom: toProjectPath(projectRoot, opts.resolveFrom),
    sourcePath: toProjectPath(projectRoot, opts.sourcePath),
    id,
    loc: toInternalSourceLocation(projectRoot, opts.loc),
    isAsync: opts.isAsync ?? false,
    isEntry: opts.isEntry,
    isOptional: opts.isOptional ?? false,
    isURL: opts.isURL ?? false,
    isIsolated: opts.isIsolated ?? false,
    meta: opts.meta || {},
    symbols:
      opts.symbols &&
      new Map(
        [...opts.symbols].map(([k, v]) => [
          k,
          {
            local: v.local,
            meta: v.meta,
            isWeak: v.isWeak,
            loc: toInternalSourceLocation(projectRoot, v.loc),
          },
        ]),
      ),
  };
}

export function mergeDependencies(a: Dependency, b: Dependency): void {
  let {meta, symbols, ...other} = b;
  Object.assign(a, other);
  Object.assign(a.meta, meta);
  if (a.symbols && symbols) {
    for (let [k, v] of symbols) {
      a.symbols.set(k, v);
    }
  }
}
