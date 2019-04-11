// @flow
import type {
  FilePath,
  PackageJSON,
  Target,
  EnvironmentContext,
  Engines
} from '@parcel/types';
import {loadConfig} from '@parcel/utils/src/config';
import Environment from './Environment';
import path from 'path';
import browserslist from 'browserslist';

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
    let pkgEngines = Object.assign({}, pkg.engines);
    if (!pkgEngines.browsers) {
      pkgEngines.browsers = browserslist.loadConfig({path: rootDir});
    }

    let targets = [];
    let node = pkgEngines.node;
    let browsers = pkgEngines.browsers;

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
        distPathType: 'js',
        env: this.getEnvironment(pkgEngines, mainContext).merge(pkgTargets.main)
      });
    }

    if (typeof pkg.module === 'string' || pkgTargets.module) {
      targets.push({
        name: 'module',
        distPath: pkg.module,
        distPathType: 'js',
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
      targets.push({
        name: 'browser',
        distPath: typeof browser === 'string' ? browser : undefined,
        distPathType: 'js',
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
      let env = pkgTargets[name];
      if (env) {
        let context =
          env.context || (env.engines && env.engines.node ? 'node' : 'browser');
        targets.push({
          name,
          distPath,
          env: this.getEnvironment(pkgEngines, context).merge(env)
        });
      }
    }

    // If no explicit targets were defined, add a default.
    if (targets.length === 0) {
      let context = browsers || !node ? 'browser' : 'node';
      targets.push({
        name: 'default',
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
