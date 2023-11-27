// @flow
import type {
  Dependency as IDependency,
  Environment as IEnvironment,
  FilePath,
  Meta,
  MutableDependencySymbols as IMutableDependencySymbols,
  SourceLocation,
  SpecifierType,
  DependencyPriority,
  BundleBehavior,
} from '@parcel/types';
import type {ParcelOptions} from '../types';
import type {DependencyAddr} from '@parcel/rust';

import nullthrows from 'nullthrows';
import Environment from './Environment';
import Target from './Target';
import {MutableDependencySymbols} from './Symbols';
import {ExportsCondition} from '../types';
import {fromProjectPath} from '../projectPath';
import {fromInternalSourceLocation} from '../utils';
import {
  Dependency as DbDependency,
  DependencyFlags,
  Asset as DbAsset,
  readCachedString,
} from '@parcel/rust';
import {getScopeCache} from '../scopeCache';
import type {Scope} from '../scopeCache';

const inspect = Symbol.for('nodejs.util.inspect.custom');

const _dependencyToInternalDependency: WeakMap<IDependency, DependencyAddr> =
  new WeakMap();
export function dependencyToInternalDependency(
  dependency: IDependency,
): DependencyAddr {
  return nullthrows(_dependencyToInternalDependency.get(dependency));
}

export function getPublicDependency(
  dep: DependencyAddr,
  options: ParcelOptions,
  scope: Scope,
): Dependency {
  let cache = getScopeCache(scope, 'Dependency');

  let existing = cache.get(dep);
  if (existing != null) {
    return existing;
  }

  let dependency = new Dependency(dep, options);
  cache.set(dep, dependency);

  return dependency;
}

export default class Dependency implements IDependency {
  #dep /*: DbDependency */;
  #options /*: ParcelOptions */;

  constructor(dep: DependencyAddr, options: ParcelOptions): Dependency {
    this.#dep = DbDependency.get(options.db, dep);
    this.#options = options;
    _dependencyToInternalDependency.set(this, dep);
    return this;
  }

  // $FlowFixMe
  [inspect](): string {
    return `Dependency(${String(this.sourcePath)} -> ${this.specifier})`;
  }

  get id(): string {
    return readCachedString(this.#options.db, this.#dep.id);
  }

  get specifier(): string {
    return this.#dep.specifier;
  }

  get specifierType(): SpecifierType {
    return this.#dep.specifierType;
  }

  get priority(): DependencyPriority {
    return this.#dep.priority;
  }

  get needsStableName(): boolean {
    return Boolean(this.#dep.flags & DependencyFlags.NEEDS_STABLE_NAME);
  }

  get bundleBehavior(): ?BundleBehavior {
    let b = this.#dep.bundleBehavior;
    return b === 'none' ? null : b;
  }

  get isEntry(): boolean {
    return Boolean(this.#dep.flags & DependencyFlags.ENTRY);
  }

  get isOptional(): boolean {
    return Boolean(this.#dep.flags & DependencyFlags.OPTIONAL);
  }

  get loc(): ?SourceLocation {
    return fromInternalSourceLocation(this.#options.projectRoot, this.#dep.loc);
  }

  get env(): IEnvironment {
    return new Environment(this.#dep.env, this.#options);
  }

  get packageConditions(): ?Array<string> {
    // Merge custom conditions with conditions stored as bitflags.
    // Order is not important because exports conditions are resolved
    // in the order they are declared in the package.json.
    let conditions = this.#dep.customPackageConditions;
    conditions = conditions.length ? [...conditions] : [];
    if (this.#dep.packageConditions) {
      for (let key in ExportsCondition) {
        if (this.#dep.packageConditions & ExportsCondition[key]) {
          conditions.push(key);
        }
      }
    }

    return conditions;
  }

  get meta(): Meta {
    let meta = {
      placeholder: this.#dep.placeholder,
      shouldWrap: Boolean(this.#dep.flags & DependencyFlags.SHOULD_WRAP),
      isESM: Boolean(this.#dep.flags & DependencyFlags.IS_ESM),
      webworker: Boolean(this.#dep.flags & DependencyFlags.IS_WEBWORKER),
      promiseSymbol: this.#dep.promiseSymbol,
      importAttributes: Object.fromEntries(
        [...this.#dep.importAttributes].map(v => [v.key, v.value]),
      ),
    };
    if (this.#dep.meta != null) {
      Object.assign(meta, JSON.parse(this.#dep.meta));
    }
    return meta;
  }

  get symbols(): IMutableDependencySymbols {
    return new MutableDependencySymbols(this.#options, this.#dep.addr);
  }

  get target(): ?Target {
    let target = this.#dep.target;
    return target ? new Target(target, this.#options) : null;
  }

  get sourceAssetId(): ?string {
    // TODO: does this need to be public?
    return this.#dep.sourceAssetId != null
      ? readCachedString(
          this.#options.db,
          DbAsset.get(this.#options.db, this.#dep.sourceAssetId).id,
        )
      : null;
  }

  get sourcePath(): ?FilePath {
    if (this.#dep.sourceAssetId != null) {
      let asset = DbAsset.get(this.#options.db, this.#dep.sourceAssetId);
      return fromProjectPath(this.#options.projectRoot, asset.filePath);
    }
    return null;
  }

  get sourceAssetType(): ?string {
    if (this.#dep.sourceAssetId != null) {
      let asset = DbAsset.get(this.#options.db, this.#dep.sourceAssetId);
      return asset.assetType;
    }
    return null;
  }

  get resolveFrom(): ?string {
    return (
      fromProjectPath(this.#options.projectRoot, this.#dep.resolveFrom) ??
      this.sourcePath
    );
  }

  get range(): ?string {
    return this.#dep.range;
  }

  get pipeline(): ?string {
    return this.#dep.pipeline;
  }
}
