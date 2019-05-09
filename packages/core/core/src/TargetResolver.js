// @flow

import type {
  Engines,
  EnvironmentContext,
  FilePath,
  InitialParcelOptions,
  PackageJSON,
  Target
} from '@parcel/types';

import {loadConfig} from '@parcel/utils';
import Environment from './Environment';
import path from 'path';
import browserslist from 'browserslist';

const DEFAULT_ENGINES = {
  browsers: ['> 0.25%'],
  node: '8'
};

const DEVELOPMENT_BROWSERS = [
  'last 1 Chrome version',
  'last 1 Safari version',
  'last 1 Firefox version',
  'last 1 Edge version'
];

const DEFAULT_DIST_DIR = 'dist';

export default class TargetResolver {
  async resolve(
    rootDir: FilePath,
    initialOptions: InitialParcelOptions
  ): Promise<Array<Target>> {
    let packageTargets = await this.resolvePackageTargets(rootDir);

    let serveOptions = initialOptions.serve || initialOptions.hot;
    let targets;
    if (initialOptions.targets) {
      if (initialOptions.targets.length === 0) {
        throw new Error('Targets was an empty array');
      }

      targets = initialOptions.targets.map(target => {
        if (typeof target === 'string') {
          let matchingTarget = packageTargets.get(target);
          if (!matchingTarget) {
            throw new Error(`Could not find target with name ${target}`);
          }
          return matchingTarget;
        }

        return target;
      });

      if (serveOptions) {
        // In serve mode, we only support a single browser target. If the user
        // provided more than one, or the matching target is not a browser, throw.
        if (targets.length > 1) {
          throw new Error(
            'More than one target is not supported in serve mode'
          );
        }
        if (targets[0].env.context !== 'browser') {
          throw new Error('Only browser targets are supported in serve mode');
        }
      }
    } else {
      // Explicit targets were not provided
      if (serveOptions) {
        // In serve mode, we only support a single browser target. Since the user
        // hasn't specified a target, use one targeting modern browsers for development
        targets = [
          {
            name: 'default',
            distDir: 'dist',
            publicUrl:
              serveOptions && serveOptions.publicUrl != null
                ? serveOptions.publicUrl
                : '/',
            env: new Environment({
              context: 'browser',
              engines: {
                browsers: DEVELOPMENT_BROWSERS
              }
            })
          }
        ];
      } else {
        targets = Array.from(packageTargets.values());
      }
    }

    return targets;
  }

  async resolvePackageTargets(rootDir: FilePath): Promise<Map<string, Target>> {
    let conf = await loadConfig(path.join(rootDir, 'index'), ['package.json']);

    let pkg: PackageJSON = conf ? conf.config : {};
    let pkgTargets = pkg.targets || {};
    let pkgEngines = Object.assign({}, pkg.engines);
    if (!pkgEngines.browsers) {
      pkgEngines.browsers = browserslist.loadConfig({path: rootDir});
    }

    let targets: Map<string, Target> = new Map();
    let node = pkgEngines.node;
    let browsers = pkgEngines.browsers;

    // If there is a separate `browser` target, or an `engines.node` field but no browser targets, then
    // the `main` and `module` targets refer to node, otherwise browser.
    let mainContext =
      pkg.browser || pkgTargets.browser || (node && !browsers)
        ? 'node'
        : 'browser';

    if (typeof pkg.main === 'string' || pkgTargets.main) {
      let distDir;
      let distEntry;

      let main = pkg.main;
      if (typeof main === 'string') {
        distDir = path.dirname(main);
        distEntry = path.basename(main);
      } else {
        distDir = path.join(DEFAULT_DIST_DIR, 'main');
      }

      targets.set('main', {
        name: 'main',
        distDir,
        distEntry,
        publicUrl:
          pkgTargets.main.publicUrl != null ? pkgTargets.main.publicUrl : '/',
        env: this.getEnvironment(pkgEngines, mainContext).merge(pkgTargets.main)
      });
    }

    if (typeof pkg.module === 'string' || pkgTargets.module) {
      let distDir;
      let distEntry;

      let mod = pkg.module;
      if (typeof mod === 'string') {
        distDir = path.dirname(mod);
        distEntry = path.basename(mod);
      } else {
        distDir = path.join(DEFAULT_DIST_DIR, 'module');
      }

      targets.set('module', {
        name: 'module',
        distDir,
        distEntry,
        publicUrl:
          pkgTargets.module.publicUrl != null
            ? pkgTargets.module.publicUrl
            : '/',
        env: this.getEnvironment(pkgEngines, mainContext).merge(
          pkgTargets.module
        )
      });
    }

    // The `browser` field can be a file path or an alias map.
    let browser = pkg.browser;
    if (browser && typeof browser === 'object') {
      browser = browser[pkg.name];
    }

    if (typeof browser === 'string' || pkgTargets.browser) {
      let distDir;
      let distEntry;
      if (typeof browser === 'string') {
        distDir = path.dirname(browser);
        distEntry = path.basename(browser);
      } else {
        distDir = path.join(DEFAULT_DIST_DIR, 'browser');
      }

      targets.set('browser', {
        name: 'browser',
        distEntry,
        distDir,
        publicUrl:
          pkgTargets.browser.publicUrl != null
            ? pkgTargets.browser.publicUrl
            : '/',
        env: this.getEnvironment(pkgEngines, 'browser').merge(
          pkgTargets.browser
        )
      });
    }

    // Custom targets
    for (let name in pkgTargets) {
      if (name === 'main' || name === 'module' || name === 'browser') {
        continue;
      }

      let distPath = pkg[name];
      let distDir;
      let distEntry;
      if (distPath == null) {
        distDir = path.join(DEFAULT_DIST_DIR, name);
      } else {
        distDir = path.dirname(distPath);
        distEntry = path.basename(distPath);
      }

      let env = pkgTargets[name];
      if (env) {
        let context =
          env.context || (env.engines && env.engines.node ? 'node' : 'browser');
        targets.set(name, {
          name,
          distDir,
          distEntry,
          publicUrl: env.publicUrl != null ? env.publicUrl : '/',
          env: this.getEnvironment(pkgEngines, context).merge(env)
        });
      }
    }

    // If no explicit targets were defined, add a default.
    if (targets.size === 0) {
      let context = browsers || !node ? 'browser' : 'node';
      targets.set('default', {
        name: 'default',
        distDir: 'dist',
        publicUrl: '/',
        env: this.getEnvironment(pkgEngines, context)
      });
    }

    return targets;
  }

  getEnvironment(
    pkgEngines: Engines,
    context: EnvironmentContext
  ): Environment {
    let engines = {};

    if (context === 'node') {
      engines.node = pkgEngines.node || DEFAULT_ENGINES.node;
    } else {
      engines.browsers = pkgEngines.browsers || DEFAULT_ENGINES.browsers;
    }

    return new Environment({
      context,
      engines,
      includeNodeModules: context === 'browser'
    });
  }
}
