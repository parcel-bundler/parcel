// @flow
import type {
  SourceLocation,
  Meta,
  ModuleSpecifier,
  Symbol
} from '@parcel/types';
import {md5FromObject} from '@parcel/utils';
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
  isWeak?: ?boolean,
  loc?: SourceLocation,
  env: Environment,
  meta?: Meta,
  target?: Target,
  symbols?: Map<Symbol, Symbol>,
  pipeline?: ?string
|};

export function createDependency(opts: DependencyOpts): Dependency {
  let id =
    opts.id ||
    md5FromObject({
      sourceAssetId: opts.sourceAssetId,
      moduleSpecifier: opts.moduleSpecifier,
      env: opts.env,
      target: opts.target,
      pipeline: opts.pipeline
    });

  return {
    ...opts,
    id,
    meta: opts.meta || {},
    symbols: opts.symbols || new Map()
  };
}

export function mergeDependencies(a: Dependency, b: Dependency): void {
  let {meta, symbols, isWeak, ...other} = b;
  Object.assign(a, other);
  Object.assign(a.meta, meta);
  a.isWeak = a.isWeak === isWeak ? a.isWeak : a.isWeak ?? isWeak;
  for (let [k, v] of symbols) {
    a.symbols.set(k, v);
  }
}
