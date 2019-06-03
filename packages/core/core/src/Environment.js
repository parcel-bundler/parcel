// @flow
import type {
  EnvironmentOpts,
  Environment as IEnvironment,
  EnvironmentContext,
  Engines
} from '@parcel/types';

const DEFAULT_ENGINES = {
  browsers: ['> 0.25%'],
  node: '>= 8.0.0'
};

const BROWSER_ENVS = new Set([
  'browser',
  'web-worker',
  'service-worker',
  'electron-renderer'
]);
const ELECTRON_ENVS = new Set(['electron-main', 'electron-renderer']);
const NODE_ENVS = new Set(['node', ...ELECTRON_ENVS]);
const ISOLATED_ENVS = new Set(['web-worker', 'service-worker']);

export default class Environment implements IEnvironment {
  context: EnvironmentContext;
  engines: Engines;
  includeNodeModules: boolean;

  constructor({context, engines, includeNodeModules}: EnvironmentOpts = {}) {
    if (context != null) {
      this.context = context;
    } else if (engines?.node) {
      this.context = 'node';
    } else if (engines?.browsers) {
      this.context = 'browser';
    } else {
      this.context = 'browser';
    }

    if (engines) {
      this.engines = engines;
    } else if (this.isNode()) {
      this.engines = {
        node: DEFAULT_ENGINES.node
      };
    } else if (this.isBrowser()) {
      this.engines = {
        browsers: DEFAULT_ENGINES.browsers
      };
    } else {
      this.engines = {};
    }

    if (includeNodeModules != null) {
      this.includeNodeModules = includeNodeModules;
    } else {
      switch (this.context) {
        case 'node':
        case 'electron':
          this.includeNodeModules = false;
          break;
        case 'browser':
        case 'web-worker':
        case 'service-worker':
        default:
          this.includeNodeModules = true;
          break;
      }
    }
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

  isIsolated() {
    return ISOLATED_ENVS.has(this.context);
  }
}
