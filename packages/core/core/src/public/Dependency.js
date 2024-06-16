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
import {BundleBehaviorNames, DependencyFlags} from '../types';

import nullthrows from 'nullthrows';
import Environment from './Environment';
import Target from './Target';
import {MutableDependencySymbols} from './Symbols';
import {
  SpecifierType as SpecifierTypeMap,
  Priority,
  ExportsCondition,
} from '../types';
import {fromProjectPath} from '../projectPath';
import {fromInternalSourceLocation} from '../utils';

const SpecifierTypeNames = Object.keys(SpecifierTypeMap);
const PriorityNames = Object.keys(Priority);

const inspect = Symbol.for('nodejs.util.inspect.custom');

const internalDependencyToDependency: WeakMap<InternalDependency, Dependency> =
  new WeakMap();
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
  #dep /*: InternalDependency */;
  #options /*: ParcelOptions */;

  constructor(dep: InternalDependency, options: ParcelOptions): Dependency {
    this.#dep = dep;
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
    return this.#dep.id;
  }

  get specifier(): string {
    return this.#dep.specifier;
  }

  get specifierType(): SpecifierType {
    return SpecifierTypeNames[this.#dep.specifierType];
  }

  get priority(): DependencyPriority {
    return PriorityNames[this.#dep.priority];
  }

  get needsStableName(): boolean {
    return Boolean(this.#dep.flags & DependencyFlags.NEEDS_STABLE_NAME);
  }

  get bundleBehavior(): ?BundleBehavior {
    let bundleBehavior = this.#dep.bundleBehavior;
    return bundleBehavior == 255 ? null : BundleBehaviorNames[bundleBehavior];
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
    if (this.#dep.packageConditions) {
      conditions = conditions ? [...conditions] : [];
      for (let key in ExportsCondition) {
        if (this.#dep.packageConditions & ExportsCondition[key]) {
          conditions.push(key);
        }
      }
    }

    return conditions;
  }

  get meta(): Meta {
    return new Proxy(this.#dep.meta ?? {}, {
      get: (target, prop) => {
        let flags = this.#dep.flags;
        switch (prop) {
          case 'isESM':
            return Boolean(flags & DependencyFlags.IS_ESM);
          case 'shouldWrap':
            return Boolean(flags & DependencyFlags.SHOULD_WRAP);
          case 'webworker':
            return Boolean(flags & DependencyFlags.IS_WEBWORKER);
          case 'placeholder':
            return this.#dep.placeholder;
          case 'promiseSymbol':
            return this.#dep.promiseSymbol;
          case 'importAttributes':
            if (!this.#dep.importAttributes) {
              return {};
            }
            return Object.fromEntries(
              [...this.#dep.importAttributes].map(v => [v.key, v.value]),
            );
          default:
            return target[prop];
        }
      },
      set: (target, prop, value) => {
        let flag;
        switch (prop) {
          case 'isESM':
            flag = DependencyFlags.IS_ESM;
            break;
          case 'shouldWrap':
            flag = DependencyFlags.SHOULD_WRAP;
            break;
          case 'webworker':
            flag = DependencyFlags.IS_WEBWORKER;
            break;
          case 'placeholder':
            this.#dep.placeholder = value;
            return true;
          case 'promiseSymbol':
            this.#dep.promiseSymbol = value;
            return true;
          case 'importAttributes':
            this.#dep.importAttributes = Object.entries(value).map(
              ([k, v]) => ({key: k, value: (v: any)}),
            );
            return true;
          default:
            target[prop] = value;
            return true;
        }

        if (value) {
          this.#dep.flags |= flag;
        } else {
          this.#dep.flags &= ~flag;
        }
        return true;
      },
    });
  }

  get symbols(): IMutableDependencySymbols {
    return new MutableDependencySymbols(this.#options, this.#dep);
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
    // TODO: does this need to be public?
    return fromProjectPath(this.#options.projectRoot, this.#dep.sourcePath);
  }

  get sourceAssetType(): ?string {
    return this.#dep.sourceAssetType;
  }

  get resolveFrom(): ?string {
    return fromProjectPath(
      this.#options.projectRoot,
      this.#dep.resolveFrom ?? this.#dep.sourcePath,
    );
  }

  get range(): ?string {
    return this.#dep.range;
  }

  get pipeline(): ?string {
    return this.#dep.pipeline;
  }
}
