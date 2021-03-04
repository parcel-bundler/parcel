// @flow
import type {
  SourceLocation,
  Meta,
  ModuleSpecifier,
  Symbol,
} from '@parcel/types';
import {md5FromOrderedObject} from '@parcel/utils';
import type {Dependency, Environment, Target} from './types';
import {type ProjectPath} from './projectPath';

type DependencyOpts = {|
  id?: string,
  sourcePath?: ProjectPath,
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
  resolveFrom?: ProjectPath,
  target?: Target,
  symbols?: Map<
    Symbol,
    {|local: Symbol, loc: ?SourceLocation, isWeak: boolean, meta?: ?Meta|},
  >,
  pipeline?: ?string,
|};

export function createDependency(opts: DependencyOpts): Dependency {
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
    id,
    isAsync: opts.isAsync ?? false,
    isEntry: opts.isEntry,
    isOptional: opts.isOptional ?? false,
    isURL: opts.isURL ?? false,
    isIsolated: opts.isIsolated ?? false,
    meta: opts.meta || {},
    symbols: opts.symbols,
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
