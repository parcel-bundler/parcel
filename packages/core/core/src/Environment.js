// @flow
import type {
  EnvironmentOpts,
  Environment as IEnvironment,
  EnvironmentContext,
  Engines
} from '@parcel/types';

const BROWSER_ENVS = new Set([
  'browser',
  'web-worker',
  'service-worker',
  'electron-renderer'
]);
const ELECTRON_ENVS = new Set(['electron-main', 'electron-renderer']);
const NODE_ENVS = new Set(['node', ...ELECTRON_ENVS]);

export default class Environment implements IEnvironment {
  context: EnvironmentContext;
  engines: Engines;
  includeNodeModules: boolean;

  constructor(opts: ?EnvironmentOpts) {
    this.context = (opts && opts.context) || 'browser';
    this.engines = (opts && opts.engines) || {};
    this.includeNodeModules =
      opts && typeof opts.includeNodeModules === 'boolean'
        ? opts.includeNodeModules
        : true;
  }

  merge(env: ?EnvironmentOpts) {
    return new Environment(Object.assign({}, this, env));
  }

  isBrowser() {
    return BROWSER_ENVS.has(this.context);
  }

  isNode() {
    return NODE_ENVS.has(this.context);
  }

  isElectron() {
    return ELECTRON_ENVS.has(this.context);
  }
}
