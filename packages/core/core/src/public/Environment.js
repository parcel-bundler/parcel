// @flow strict-local
import type {
  Environment as IEnvironment,
  EnvironmentContext,
  EnvironmentFeature,
  Engines,
  OutputFormat,
  PackageName,
  VersionMap,
  TargetSourceMapOptions,
  SourceLocation,
} from '@parcel/types';
import type {Environment as InternalEnvironment} from '../types';
import nullthrows from 'nullthrows';
import browserslist from 'browserslist';
import semver from 'semver';
import {setIntersects} from '@parcel/utils';

export const BROWSER_ENVS: Set<EnvironmentContext> = new Set([
  'browser',
  'web-worker',
  'service-worker',
  'electron-renderer',
]);
const ELECTRON_ENVS = new Set<EnvironmentContext>([
  'electron-main',
  'electron-renderer',
]);
const NODE_ENVS = new Set<EnvironmentContext>(['node', ...ELECTRON_ENVS]);
const WORKER_ENVS = new Set<EnvironmentContext>([
  'web-worker',
  'service-worker',
]);
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

const supportData = {
  esmodules: {
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
  },
  'dynamic-import': {
    edge: '76',
    firefox: '67',
    chrome: '63',
    safari: '11.1',
    opera: '50',
    ios: '11.3',
    android: '63',
    and_chr: '63',
    and_ff: '67',
    samsung: '8',
  },
  'worker-type': {
    edge: '80',
    chrome: '80',
    opera: '67',
    android: '81',
    and_chr: '86',
  },
  'service-worker-type': {},
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
  #environment /*: InternalEnvironment */;

  constructor(env: InternalEnvironment): Environment {
    let existing = internalEnvironmentToEnvironment.get(env);
    if (existing != null) {
      return existing;
    }

    this.#environment = env;
    _environmentToInternalEnvironment.set(this, env);
    internalEnvironmentToEnvironment.set(env, this);
    return this;
  }

  get context(): Set<EnvironmentContext> {
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

  get sourceMap(): ?TargetSourceMapOptions {
    return this.#environment.sourceMap;
  }

  get loc(): ?SourceLocation {
    return this.#environment.loc;
  }

  isBrowser(): boolean {
    return setIntersects(this.#environment.context, BROWSER_ENVS);
  }

  isNode(): boolean {
    return setIntersects(this.#environment.context, NODE_ENVS);
  }

  isElectron(): boolean {
    return setIntersects(this.#environment.context, ELECTRON_ENVS);
  }

  isIsolated(): boolean {
    return setIntersects(this.#environment.context, ISOLATED_ENVS);
  }

  isWorker(): boolean {
    return setIntersects(this.#environment.context, WORKER_ENVS);
  }

  matchesEngines(minVersions: VersionMap): boolean {
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
        browsers = [...browsers, ...getExcludedBrowsers(supportData.esmodules)];
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

  supports(feature: EnvironmentFeature): boolean {
    let engines = supportData[feature];
    if (!engines) {
      throw new Error('Unknown environment feature: ' + feature);
    }

    return this.matchesEngines(engines);
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
