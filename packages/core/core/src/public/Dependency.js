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
import type {Dependency as InternalDependency, ParcelOptions} from '../types';

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
} from '@parcel/rust';
import {createBuildCache} from '../buildCache';

const inspect = Symbol.for('nodejs.util.inspect.custom');

const internalDependencyToDependency: Map<InternalDependency, Dependency> =
  createBuildCache();
const _dependencyToInternalDependency: WeakMap<
  IDependency,
  InternalDependency,
> = new WeakMap();
export function dependencyToInternalDependency(
  dependency: IDependency,
): InternalDependency {
  return nullthrows(_dependencyToInternalDependency.get(dependency));
}

export function getPublicDependency(
  dep: InternalDependency,
  options: ParcelOptions,
): Dependency {
  let existing = internalDependencyToDependency.get(dep);
  if (existing != null) {
    return existing;
  }

  return new Dependency(dep, options);
}

export default class Dependency implements IDependency {
  #dep /*: DbDependency */;
  #options /*: ParcelOptions */;

  constructor(dep: InternalDependency, options: ParcelOptions): Dependency {
    this.#dep = DbDependency.get(options.db, dep);
    this.#options = options;
    _dependencyToInternalDependency.set(this, dep);
    internalDependencyToDependency.set(dep, this);
    return this;
  }

  // $FlowFixMe
  [inspect](): string {
    return `Dependency(${String(this.sourcePath)} -> ${this.specifier})`;
  }

  get id(): string {
    return this.#dep.addr;
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
    return this.#dep.sourceAssetId;
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
    return fromProjectPath(this.#options.projectRoot, this.#dep.resolveFrom);
  }

  get range(): ?string {
    return this.#dep.range;
  }

  get pipeline(): ?string {
    return this.#dep.pipeline;
  }
}
