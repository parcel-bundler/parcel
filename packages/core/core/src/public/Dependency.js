// @flow
import type {
  Dependency as IDependency,
  Environment as IEnvironment,
  FilePath,
  Meta,
  MutableDependencySymbols as IMutableDependencySymbols,
  SourceLocation,
} from '@parcel/types';
import type {Dependency as InternalDependency, ParcelOptions} from '../types';

import nullthrows from 'nullthrows';
import Environment from './Environment';
import Target from './Target';
import {MutableDependencySymbols} from './Symbols';
import {fromProjectPath} from '../projectPath';

const inspect = Symbol.for('nodejs.util.inspect.custom');

const internalDependencyToDependency: WeakMap<
  InternalDependency,
  Dependency,
> = new WeakMap();
const _dependencyToInternalDependency: WeakMap<
  IDependency,
  InternalDependency,
> = new WeakMap();
export function dependencyToInternalDependency(
  dependency: IDependency,
): InternalDependency {
  return nullthrows(_dependencyToInternalDependency.get(dependency));
}

export default class Dependency implements IDependency {
  #dep /*: InternalDependency */;
  #options /*: ParcelOptions */;

  constructor(dep: InternalDependency, options: ParcelOptions): Dependency {
    let existing = internalDependencyToDependency.get(dep);
    if (existing != null) {
      return existing;
    }

    this.#dep = dep;
    this.#options = options;
    _dependencyToInternalDependency.set(this, dep);
    internalDependencyToDependency.set(dep, this);
    return this;
  }

  // $FlowFixMe
  [inspect](): string {
    return `Dependency(${String(this.sourcePath)} -> ${this.moduleSpecifier})`;
  }

  get id(): string {
    return this.#dep.id;
  }

  get moduleSpecifier(): string {
    return this.#dep.moduleSpecifier;
  }

  get isAsync(): boolean {
    return !!this.#dep.isAsync;
  }

  get isEntry(): ?boolean {
    return this.#dep.isEntry;
  }

  get isOptional(): boolean {
    return !!this.#dep.isOptional;
  }

  get isURL(): boolean {
    return !!this.#dep.isURL;
  }

  get isIsolated(): boolean {
    return !!this.#dep.isIsolated;
  }

  get loc(): ?SourceLocation {
    return this.#dep.loc;
  }

  get env(): IEnvironment {
    return new Environment(this.#dep.env);
  }

  get meta(): Meta {
    return this.#dep.meta;
  }

  get symbols(): IMutableDependencySymbols {
    return new MutableDependencySymbols(this.#dep);
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

  get resolveFrom(): ?FilePath {
    return fromProjectPath(
      this.#options.projectRoot,
      this.#dep.resolveFrom ?? this.#dep.sourcePath,
    );
  }

  get pipeline(): ?string {
    return this.#dep.pipeline;
  }
}
