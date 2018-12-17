// @flow
import type {
  FilePath,
  PackageJSON,
  Target,
  Environment,
  EnvironmentContext
} from '@parcel/types';
import {loadConfig} from '@parcel/utils/config';
import path from 'path';

const DEFAULT_ENGINES = {
  browsers: ['> 0.25%'],
  node: '8'
};

export default class TargetResolver {
  async resolve(rootDir: FilePath): Promise<Array<Target>> {
    let conf = await loadConfig(path.join(rootDir, 'index'), ['package.json']);

    // $FlowFixMe
    let pkg: PackageJSON = conf ? conf.config : {};
    let pkgTargets = pkg.targets || {};
    let pkgEngines = pkg.engines || {};
    let targets = [];

    let node = pkgEngines.node;
    let browsers = pkgEngines.browsers || pkg.browserslist;

    // If there is a separate `browser` target, or an `engines.node` field but no browser targets, then
    // the `main` and `module` targets refer to node, otherwise browser.
    let mainContext =
      pkg.browser || pkgTargets.browser || (node && !browsers)
        ? 'node'
        : 'browser';

    if (typeof pkg.main === 'string' || pkgTargets.main) {
      targets.push({
        name: 'main',
        distPath: pkg.main,
        env: Object.assign(
          this.getEnvironment(pkg, mainContext),
          pkgTargets.main
        )
      });
    }

    if (typeof pkg.module === 'string' || pkgTargets.module) {
      targets.push({
        name: 'module',
        distPath: pkg.module,
        env: Object.assign(
          this.getEnvironment(pkg, mainContext),
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
      targets.push({
        name: 'browser',
        distPath: browser,
        env: Object.assign(
          this.getEnvironment(pkg, 'browser'),
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
      if (env) {
        let context =
          env.context || (env.engines && env.engines.node ? 'node' : 'browser');
        targets.push({
          name,
          distPath,
          env: Object.assign(this.getEnvironment(pkg, context), env)
        });
      }
    }

    // If no explicit targets were defined, add a default.
    if (targets.length === 0) {
      let context = browsers || !node ? 'browser' : 'node';
      targets.push({
        name: 'default',
        env: this.getEnvironment(pkg, context)
      });
    }

    return targets;
  }

  getEnvironment(pkg: PackageJSON, context: EnvironmentContext): Environment {
    let pkgEngines = pkg.engines || {};
    let env: Environment = {
      context,
      includeNodeModules: context === 'browser',
      engines: {}
    };

    if (context === 'node') {
      env.engines.node = pkgEngines.node || DEFAULT_ENGINES.node;
    } else {
      env.engines.browsers =
        pkgEngines.browsers || pkg.browserslist || DEFAULT_ENGINES.browsers;
    }

    return env;
  }
}
