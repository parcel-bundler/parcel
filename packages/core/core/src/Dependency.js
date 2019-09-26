// @flow
import type {
  SourceLocation,
  Meta,
  ModuleSpecifier,
  Symbol
} from '@parcel/types';
import {md5FromString} from '@parcel/utils';
import type {Dependency, Environment, Target} from './types';

type DependencyOpts = {|
  id?: string,
  sourcePath?: string,
  sourceAssetId?: string,
  moduleSpecifier: ModuleSpecifier,
  isAsync?: boolean,
  isEntry?: boolean,
  isOptional?: boolean,
  isURL?: boolean,
  isWeak?: boolean,
  loc?: SourceLocation,
  env: Environment,
  meta?: Meta,
  target?: Target,
  symbols?: Map<Symbol, Symbol>
|};

export function createDependency(opts: DependencyOpts): Dependency {
  let id =
    opts.id ||
    md5FromString(
      `${opts.sourceAssetId ?? ''}:${opts.moduleSpecifier}:${JSON.stringify(
        opts.env
      )}:${JSON.stringify(opts.target)}`
    );

  return {
    ...opts,
    id,
    meta: opts.meta || {},
    symbols: opts.symbols || new Map()
  };
}

export function mergeDependencies(a: Dependency, b: Dependency): void {
  let {meta, symbols, ...other} = b;
  Object.assign(a, other);
  Object.assign(a.meta, meta);
  for (let [k, v] of symbols) {
    a.symbols.set(k, v);
  }
}
