// @flow
import type {
  FilePath,
  Target as ITarget,
  Environment as IEnvironment,
  SourceLocation,
} from '@parcel/types';
import type {ParcelOptions} from '../types';
import type {TargetAddr} from '@parcel/rust';

import nullthrows from 'nullthrows';
import Environment from './Environment';
import {fromProjectPath} from '../projectPath';
import {fromInternalSourceLocation} from '../utils';
import {Target as DbTarget} from '@parcel/rust';
import {getScopeCache} from '../scopeCache';
import type {Scope} from '../scopeCache';

const inspect = Symbol.for('nodejs.util.inspect.custom');

const _targetToInternalTarget: WeakMap<ITarget, TargetAddr> = new WeakMap();
export function targetToInternalTarget(target: ITarget): TargetAddr {
  return nullthrows(_targetToInternalTarget.get(target));
}

export default class Target implements ITarget {
  #target /*: DbTarget */;
  #options /*: ParcelOptions */;
  #scope: Scope;

  constructor(
    target: TargetAddr,
    options: ParcelOptions,
    scope: Scope,
  ): Target {
    let cache = getScopeCache(scope, 'Target');

    let existing = cache.get(target);
    if (existing != null) {
      return existing;
    }

    this.#target = DbTarget.get(options.db, target);
    this.#options = options;
    this.#scope = scope;
    _targetToInternalTarget.set(this, target);
    cache.set(target, this);
    return this;
  }

  get distEntry(): ?FilePath {
    return this.#target.distEntry;
  }

  get distDir(): FilePath {
    return fromProjectPath(this.#options.projectRoot, this.#target.distDir);
  }

  get env(): IEnvironment {
    return new Environment(this.#target.env, this.#options, this.#scope);
  }

  get name(): string {
    return this.#target.name;
  }

  get publicUrl(): string {
    return this.#target.publicUrl;
  }

  get loc(): ?SourceLocation {
    return fromInternalSourceLocation(
      this.#options.projectRoot,
      this.#target.loc,
    );
  }

  // $FlowFixMe[unsupported-syntax]
  [inspect](): string {
    return `Target(${this.name} - ${this.env[inspect]()})`;
  }
}
