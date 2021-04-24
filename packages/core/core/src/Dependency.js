// @flow
import type {
  DependencyOptions,
  FilePath,
  Meta,
  ModuleSpecifier,
  SourceLocation,
  Symbol,
} from '@parcel/types';
import type {Dependency, Environment, Target} from './types';

import {md5FromOrderedObject} from '@parcel/utils';
import {toInternalSourceLocation, fromInternalSourceLocation} from './utils';
import {fromProjectPath, toProjectPath} from './projectPath';

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

export function dependencyToDependencyOptions(
  projectRoot: FilePath,
  dep: Dependency,
): DependencyOptions {
  // eslint-disable-next-line no-unused-vars
  let {id, ...env} = dep.env;

  return {
    moduleSpecifier: dep.moduleSpecifier,
    isAsync: dep.isAsync,
    isEntry: dep.isEntry ?? undefined,
    isOptional: dep.isOptional,
    isURL: dep.isURL,
    isIsolated: dep.isIsolated,
    loc: fromInternalSourceLocation(projectRoot, dep.loc) ?? undefined,
    env: env,
    meta: dep.meta,
    resolveFrom: fromProjectPath(projectRoot, dep.resolveFrom) ?? undefined,
    symbols: dep.symbols
      ? new Map(
          [...dep.symbols].map(([k, v]) => [
            k,
            {
              local: v.local,
              meta: v.meta ?? undefined,
              isWeak: v.isWeak,
              loc: fromInternalSourceLocation(projectRoot, v.loc),
            },
          ]),
        )
      : undefined,
    pipeline: dep.pipeline ?? undefined,
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
