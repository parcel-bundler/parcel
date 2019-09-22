// @flow
import type {
  Environment as IEnvironment,
  EnvironmentContext,
  Engines,
  OutputFormat,
  PackageName
} from '@parcel/types';
import type {Environment as InternalEnvironment} from '../types';
import nullthrows from 'nullthrows';

const BROWSER_ENVS = new Set([
  'browser',
  'web-worker',
  'service-worker',
  'electron-renderer'
]);
const ELECTRON_ENVS = new Set(['electron-main', 'electron-renderer']);
const NODE_ENVS = new Set(['node', ...ELECTRON_ENVS]);
const ISOLATED_ENVS = new Set(['web-worker', 'service-worker']);

const _environmentToInternalEnvironment: WeakMap<
  IEnvironment,
  InternalEnvironment
> = new WeakMap();
export function environmentToInternalEnvironment(
  environment: IEnvironment
): InternalEnvironment {
  return nullthrows(_environmentToInternalEnvironment.get(environment));
}

export default class Environment implements IEnvironment {
  #environment; // InternalEnvironment

  constructor(env: InternalEnvironment) {
    this.#environment = env;
    _environmentToInternalEnvironment.set(this, env);
  }

  get context(): EnvironmentContext {
    return this.#environment.context;
  }

  get engines(): Engines {
    return this.#environment.engines;
  }

  get includeNodeModules(): boolean | Array<PackageName> {
    return this.#environment.includeNodeModules;
  }

  get outputFormat(): OutputFormat {
    return this.#environment.outputFormat;
  }

  isBrowser() {
    return BROWSER_ENVS.has(this.#environment.context);
  }

  isNode() {
    return NODE_ENVS.has(this.#environment.context);
  }

  isElectron() {
    return ELECTRON_ENVS.has(this.#environment.context);
  }

  isIsolated() {
    return ISOLATED_ENVS.has(this.#environment.context);
  }
}
