// @flow
import type {
  Environment as IEnvironment,
  EnvironmentContext,
  Engines,
  OutputFormat,
  PackageName,
  VersionMap,
} from '@parcel/types';
import type {Environment as InternalEnvironment} from '../types';
import nullthrows from 'nullthrows';
import browserslist from 'browserslist';
import semver from 'semver';

export const BROWSER_ENVS = new Set<string>([
  'browser',
  'web-worker',
  'service-worker',
  'electron-renderer',
]);
const ELECTRON_ENVS = new Set(['electron-main', 'electron-renderer']);
const NODE_ENVS = new Set(['node', ...ELECTRON_ENVS]);
const WORKER_ENVS = new Set(['web-worker', 'service-worker']);
const ISOLATED_ENVS = WORKER_ENVS;

const ALL_BROWSERS = [
  'chrome',
  'and_chr',
  'edge',
  'firefox',
  'and_ff',
  'safari',
  'ios',
  'samsung',
  'opera',
  'ie',
  'op_mini',
  'blackberry',
  'op_mob',
  'ie_mob',
  'and_uc',
  'and_qq',
  'baidu',
  'kaios',
];

const ESMODULE_BROWSERS = {
  edge: '16',
  firefox: '60',
  chrome: '61',
  safari: '11',
  opera: '48',
  ios: '11',
  android: '76',
  and_chr: '76',
  and_ff: '68',
  samsung: '8.2',
};

const internalEnvironmentToEnvironment: WeakMap<
  InternalEnvironment,
  Environment,
> = new WeakMap();
const _environmentToInternalEnvironment: WeakMap<
  IEnvironment,
  InternalEnvironment,
> = new WeakMap();
export function environmentToInternalEnvironment(
  environment: IEnvironment,
): InternalEnvironment {
  return nullthrows(_environmentToInternalEnvironment.get(environment));
}

export default class Environment implements IEnvironment {
  #environment; // InternalEnvironment

  constructor(env: InternalEnvironment) {
    let existing = internalEnvironmentToEnvironment.get(env);
    if (existing != null) {
      return existing;
    }

    this.#environment = env;
    _environmentToInternalEnvironment.set(this, env);
    internalEnvironmentToEnvironment.set(env, this);
  }

  get context(): EnvironmentContext {
    return this.#environment.context;
  }

  get engines(): Engines {
    return this.#environment.engines;
  }

  get includeNodeModules():
    | boolean
    | Array<PackageName>
    | {[PackageName]: boolean, ...} {
    return this.#environment.includeNodeModules;
  }

  get outputFormat(): OutputFormat {
    return this.#environment.outputFormat;
  }

  get isLibrary(): boolean {
    return this.#environment.isLibrary;
  }

  get minify(): boolean {
    return this.#environment.minify;
  }

  get scopeHoist(): boolean {
    return this.#environment.scopeHoist;
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

  isWorker() {
    return WORKER_ENVS.has(this.#environment.context);
  }

  matchesEngines(minVersions: VersionMap) {
    // Determine if the environment matches some minimum version requirements.
    // For browsers, we run a browserslist query with and without the minimum
    // required browsers and compare the lists. For node, we just check semver.
    if (this.isBrowser() && this.engines.browsers != null) {
      let targetBrowsers = this.engines.browsers;
      let browsers =
        targetBrowsers != null && !Array.isArray(targetBrowsers)
          ? [targetBrowsers]
          : targetBrowsers;

      // If outputting esmodules, exclude browsers without support.
      if (this.outputFormat === 'esmodule') {
        browsers = [...browsers, ...getExcludedBrowsers(ESMODULE_BROWSERS)];
      }

      let matchedBrowsers = browserslist(browsers);
      let minBrowsers = getExcludedBrowsers(minVersions);
      let withoutMinBrowsers = browserslist([...browsers, ...minBrowsers]);
      return matchedBrowsers.length === withoutMinBrowsers.length;
    } else if (this.isNode() && this.engines.node != null && minVersions.node) {
      return !semver.intersects(`< ${minVersions.node}`, this.engines.node);
    }

    return false;
  }
}

function getExcludedBrowsers(minVersions: VersionMap) {
  let browsers = [];
  for (let browser of ALL_BROWSERS) {
    let version = minVersions[browser];
    if (version) {
      browsers.push(`not ${browser} < ${version}`);
    } else {
      browsers.push(`not ${browser} > 0`);
    }
  }

  return browsers;
}
