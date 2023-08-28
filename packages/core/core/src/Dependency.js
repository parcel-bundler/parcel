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
import {SpecifierType, Priority, ExportsCondition} from './types';

import {toDbSourceLocation} from './utils';
import {toProjectPath} from './projectPath';
import {
  Dependency as DbDependency,
  DependencyFlags,
  SymbolFlags,
  getStringId,
} from '@parcel/rust';

type DependencyOpts = {|
  id?: string,
  sourcePath?: FilePath,
  sourceAssetId?: number,
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

export function dependencyId(opts: DependencyOpts): string {
  return (
    opts.id ||
    hashString(
      (opts.sourceAssetId ?? '') +
        opts.specifier +
        String(opts.env) +
        (opts.target ? JSON.stringify(opts.target) : '') +
        (opts.pipeline ?? '') +
        opts.specifierType +
        (opts.bundleBehavior ?? '') +
        (opts.priority ?? 'sync') +
        (opts.packageConditions ? JSON.stringify(opts.packageConditions) : ''),
    )
  );
}

export function createDependency(
  projectRoot: FilePath,
  opts: DependencyOpts,
): Dependency {
  // let id =
  //   opts.id ||
  //   hashString(
  //     (opts.sourceAssetId ?? '') +
  //       opts.specifier +
  //       String(opts.env) +
  //       (opts.target ? JSON.stringify(opts.target) : '') +
  //       (opts.pipeline ?? '') +
  //       opts.specifierType +
  //       (opts.bundleBehavior ?? '') +
  //       (opts.priority ?? 'sync') +
  //       (opts.packageConditions ? JSON.stringify(opts.packageConditions) : ''),
  //   );

  // let dep: Dependency = {
  //   id,
  //   specifier: opts.specifier,
  //   specifierType: SpecifierType[opts.specifierType],
  //   priority: Priority[opts.priority ?? 'sync'],
  //   needsStableName: opts.needsStableName ?? false,
  //   bundleBehavior: opts.bundleBehavior
  //     ? BundleBehavior[opts.bundleBehavior]
  //     : null,
  //   isEntry: opts.isEntry ?? false,
  //   isOptional: opts.isOptional ?? false,
  //   loc: toInternalSourceLocation(projectRoot, opts.loc),
  //   env: opts.env,
  //   meta: opts.meta || {},
  //   target: opts.target,
  //   sourceAssetId: opts.sourceAssetId,
  //   sourcePath: toProjectPath(projectRoot, opts.sourcePath),
  //   resolveFrom: toProjectPath(projectRoot, opts.resolveFrom),
  //   range: opts.range,
  //   symbols:
  //     opts.symbols &&
  //     new Map(
  //       [...opts.symbols].map(([k, v]) => [
  //         k,
  //         {
  //           local: v.local,
  //           meta: v.meta,
  //           isWeak: v.isWeak,
  //           loc: toInternalSourceLocation(projectRoot, v.loc),
  //         },
  //       ]),
  //     ),
  //   pipeline: opts.pipeline,
  // };

  let d = new DbDependency();
  d.env = opts.env;
  d.specifier = opts.specifier;
  d.specifierType = opts.specifierType;
  d.priority = opts.priority ?? 'sync';
  d.bundleBehavior = opts.bundleBehavior || 'none';
  d.flags =
    (opts.isEntry ? DependencyFlags.ENTRY : 0) |
    (opts.isOptional ? DependencyFlags.OPTIONAL : 0) |
    (opts.needsStableName ? DependencyFlags.NEEDS_STABLE_NAME : 0);
  d.resolveFrom = toProjectPath(
    projectRoot,
    opts.resolveFrom ?? opts.sourcePath,
  );
  d.range = opts.range;
  if (typeof opts.meta?.placeholder === 'string') {
    d.placeholder = opts.meta?.placeholder;
  } else {
    d.placeholder = null;
  }
  d.target = opts.target || 0;
  d.loc = toDbSourceLocation(projectRoot, opts.loc);
  d.promiseSymbol = null;
  d.sourceAssetId = null;
  d.symbols.init();
  d.importAttributes.init();

  let symbols = opts.symbols;
  if (symbols) {
    d.symbols.reserve(symbols.size);
    for (let [exported, {local, isWeak, loc, meta}] of symbols) {
      let sym = d.symbols.extend();
      sym.exported = getStringId(exported);
      sym.local = getStringId(local);
      sym.flags =
        (isWeak ? SymbolFlags.IS_WEAK : 0) |
        (meta?.isESM === true ? SymbolFlags.IS_ESM : 0);
      sym.loc = toDbSourceLocation(projectRoot, loc);
    }
  }

  // if (opts.packageConditions) {
  //   convertConditions(opts.packageConditions, dep);
  // }

  // console.log('create dependency', d.addr, d.env)
  return d.addr;
}

export function mergeDependencies(a: Dependency, b: DependencyOpts): void {
  // let {meta, symbols, needsStableName, isEntry, isOptional, ...other} = b;
  // Object.assign(a, other);
  // Object.assign(a.meta, meta);
  // if (a.symbols && symbols) {
  //   for (let [k, v] of symbols) {
  //     a.symbols.set(k, v);
  //   }
  // }
  // if (needsStableName) a.needsStableName = true;
  // if (isEntry) a.isEntry = true;
  // if (!isOptional) a.isOptional = false;
  // throw new Error('todo')
  // console.log('merge', b);
  return a;
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
