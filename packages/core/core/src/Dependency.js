// @flow
import type {
  SourceLocation,
  Meta,
  ModuleSpecifier,
  Symbol,
} from '@parcel/types';
import type {Dependency, Environment, Target} from './types';
import {hashString} from '@parcel/hash';

type DependencyOpts = {|
  id?: string,
  sourcePath?: string,
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
  resolveFrom?: string,
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
    hashString(
      (opts.sourceAssetId ?? '') +
        opts.moduleSpecifier +
        opts.env.id +
        (opts.target ? JSON.stringify(opts.target) : '') +
        (opts.pipeline ?? ''),
    );

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
