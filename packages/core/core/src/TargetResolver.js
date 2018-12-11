// @flow
import type {FilePath, PackageJSON, Target, Environment} from '@parcel/types';
import {loadConfig} from '@parcel/utils/lib/config';
import path from 'path';

const DEFAULT_ENGINES = {
  browsers: ['> 0.25%'],
  node: '8'
};

const DEFAULT_ENV = {
  context: 'browser',
  includeNodeModules: true,
  engines: DEFAULT_ENGINES
};

export default class TargetResolver {
  async resolve(rootDir: FilePath): Promise<Array<Target>> {
    let conf = await loadConfig(path.join(rootDir, 'index'), ['package.json']);
    if (!conf) {
      return this.getDefaultTargets();
    }

    let pkg: PackageJSON = conf.config;
    let pkgTargets = pkg.targets || {};
    let pkgEngines = pkg.engines || {};
    let targets = [];

    let browsers =
      pkgEngines.browsers || pkg.browserslist || DEFAULT_ENGINES.browsers;
    let node = pkgEngines.node || DEFAULT_ENGINES.node;

    // If there is a `browser` target or an `engines.node` field, then
    // the `main` and `module` targets refer to node, otherwise browser context.
    let context = pkg.browser || pkgEngines.node ? 'node' : 'browser';
    let env: Environment = {
      context,
      includeNodeModules: context === 'browser',
      engines: {
        node: context === 'node' ? node : undefined,
        browsers: context === 'browser' ? browsers : undefined
      }
    };

    if (typeof pkg.main === 'string') {
      targets.push({
        distPath: pkg.main,
        env: Object.assign({}, env, pkgTargets.main)
      });
    }

    if (typeof pkg.module === 'string') {
      targets.push({
        distPath: pkg.module,
        env: Object.assign({}, env, pkgTargets.module)
      });
    }

    // The `browser` field can be a file path or an alias map.
    let browser = pkg.browser;
    if (browser && typeof browser === 'object' && browser[pkg.name]) {
      browser = browser[pkg.name];
    }

    if (typeof browser === 'string') {
      targets.push({
        distPath: browser,
        env: Object.assign(
          {
            context: 'browser',
            includeNodeModules: true,
            engines: {
              browsers
            }
          },
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
      let env = pkgTargets[name];
      if (distPath && env) {
        targets.push({
          distPath,
          env: Object.assign({}, DEFAULT_ENV, env)
        });
      }
    }

    if (targets.length === 0) {
      return this.getDefaultTargets();
    }

    return targets;
  }

  getDefaultTargets(): Array<Target> {
    return [
      {
        distPath: process.cwd() + '/out.js', // TODO
        env: DEFAULT_ENV
      }
    ];
  }
}
