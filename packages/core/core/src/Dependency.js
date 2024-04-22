// @flow
import type {
  FilePath,
  Meta,
  DependencySpecifier,
  SourceLocation,
  Symbol,
  BundleBehavior as IBundleBehavior,
  SemverRange,
} from '@parcel/types';
import type {Dependency, Environment, Target} from './types';
import {hashString} from '@parcel/rust';
import {
  SpecifierType,
  Priority,
  BundleBehavior,
  ExportsCondition,
  DependencyFlags,
} from './types';

import {toInternalSourceLocation} from './utils';
import {toProjectPath} from './projectPath';

type DependencyOpts = {|
  id?: string,
  sourcePath?: FilePath,
  sourceAssetId?: string,
  specifier: DependencySpecifier,
  specifierType: $Keys<typeof SpecifierType>,
  priority?: $Keys<typeof Priority>,
  needsStableName?: boolean,
  bundleBehavior?: ?IBundleBehavior,
  isEntry?: boolean,
  isOptional?: boolean,
  loc?: SourceLocation,
  env: Environment,
  packageConditions?: Array<string>,
  meta?: Meta,
  resolveFrom?: FilePath,
  range?: SemverRange,
  target?: Target,
  symbols?: ?Map<
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
    hashString(
      (opts.sourceAssetId ?? '') +
        opts.specifier +
        opts.env.id +
        (opts.target ? JSON.stringify(opts.target) : '') +
        (opts.pipeline ?? '') +
        opts.specifierType +
        (opts.bundleBehavior ?? '') +
        (opts.priority ?? 'sync') +
        (opts.packageConditions ? JSON.stringify(opts.packageConditions) : ''),
    );

  let {
    placeholder,
    promiseSymbol,
    importAttributes,
    isESM,
    shouldWrap,
    webworker,
    ...meta
  } = opts.meta ?? {};

  let dep: Dependency = {
    id,
    specifier: opts.specifier,
    specifierType: SpecifierType[opts.specifierType],
    priority: Priority[opts.priority ?? 'sync'],
    bundleBehavior: opts.bundleBehavior
      ? BundleBehavior[opts.bundleBehavior]
      : 255,
    flags:
      (opts.needsStableName ? DependencyFlags.NEEDS_STABLE_NAME : 0) |
      (opts.isEntry ? DependencyFlags.ENTRY : 0) |
      (opts.isOptional ? DependencyFlags.OPTIONAL : 0) |
      (isESM ? DependencyFlags.IS_ESM : 0) |
      (shouldWrap ? DependencyFlags.SHOULD_WRAP : 0) |
      (webworker ? DependencyFlags.IS_WEBWORKER : 0),
    loc: toInternalSourceLocation(projectRoot, opts.loc),
    env: opts.env,
    meta,
    target: opts.target,
    sourceAssetId: opts.sourceAssetId,
    sourcePath: toProjectPath(projectRoot, opts.sourcePath),
    resolveFrom: toProjectPath(projectRoot, opts.resolveFrom),
    range: opts.range,
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
    pipeline: opts.pipeline,
  };

  if (typeof placeholder === 'string') {
    dep.placeholder = placeholder;
  }

  if (typeof promiseSymbol === 'string') {
    dep.promiseSymbol = promiseSymbol;
  }

  if (importAttributes && typeof importAttributes === 'object') {
    dep.importAttributes = Object.entries(importAttributes).map(([k, v]) => ({
      key: k,
      value: (v: any),
    }));
  }

  if (opts.packageConditions) {
    convertConditions(opts.packageConditions, dep);
  }

  return dep;
}

export function mergeDependencies(a: Dependency, b: Dependency): void {
  let {meta, symbols, flags, ...other} = b;
  Object.assign(a, other);
  Object.assign(a.meta, meta);
  if (a.symbols && symbols) {
    for (let [k, v] of symbols) {
      a.symbols.set(k, v);
    }
  }
  if (flags & DependencyFlags.NEEDS_STABLE_NAME) {
    a.flags |= DependencyFlags.NEEDS_STABLE_NAME;
  }
  if (flags & DependencyFlags.ENTRY) {
    a.flags |= DependencyFlags.ENTRY;
  }
  if (!(flags & DependencyFlags.OPTIONAL)) {
    a.flags &= ~DependencyFlags.OPTIONAL;
  }
}

function convertConditions(conditions: Array<string>, dep: Dependency) {
  // Store common package conditions as bit flags to reduce size.
  // Custom conditions are stored as strings.
  let packageConditions = 0;
  let customConditions = [];
  for (let condition of conditions) {
    if (ExportsCondition[condition]) {
      packageConditions |= ExportsCondition[condition];
    } else {
      customConditions.push(condition);
    }
  }

  if (packageConditions) {
    dep.packageConditions = packageConditions;
  }

  if (customConditions.length) {
    dep.customPackageConditions = customConditions;
  }
}
