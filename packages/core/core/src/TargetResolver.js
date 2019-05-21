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

const DEFAULT_DIST_DIRNAME = 'dist';
const COMMON_TARGETS = ['main', 'module', 'browser'];

export default class TargetResolver {
  async resolve(
    rootDir: FilePath,
    cacheDir: FilePath,
    initialOptions: InitialParcelOptions
  ): Promise<Array<Target>> {
    let packageTargets = await this.resolvePackageTargets(rootDir);

    let serveOptions = initialOptions.serve ?? initialOptions.hot;
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

        return {
          ...target,
          // In the case the supplied target was a relative path, resolve it from
          // cwd just like Node does for other file paths.
          distDir: path.resolve(target.distDir)
        };
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
            // For serve, write the `dist` to inside the parcel cache, which is
            // temporary, likely in a .gitignore or similar, but still readily
            // available for introspection by the user if necessary.
            distDir: path.resolve(cacheDir, DEFAULT_DIST_DIRNAME),
            publicUrl: serveOptions?.publicUrl ?? '/',
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

    let pkg: PackageJSON;
    let pkgDir: FilePath;
    if (conf) {
      pkg = conf.config;
      let pkgFile = conf.files[0];
      if (pkgFile == null) {
        throw new Error('Expected package.json file');
      }
      pkgDir = path.dirname(pkgFile.filePath);
    } else {
      pkg = {};
      pkgDir = process.cwd();
    }

    let pkgTargets = pkg.targets || {};
    let pkgEngines = {...pkg.engines};
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

    for (let targetName of COMMON_TARGETS) {
      let targetDist;
      if (
        targetName === 'browser' &&
        pkg[targetName] != null &&
        typeof pkg[targetName] === 'object'
      ) {
        // The `browser` field can be a file path or an alias map.
        targetDist = pkg[targetName][pkg.name];
      } else {
        targetDist = pkg[targetName];
      }

      if (typeof targetDist === 'string' || pkgTargets[targetName]) {
        let distDir;
        let distEntry;

        if (typeof targetDist === 'string') {
          distDir = path.resolve(pkgDir, path.dirname(targetDist));
          distEntry = path.basename(targetDist);
        } else {
          distDir = path.resolve(pkgDir, DEFAULT_DIST_DIRNAME, targetName);
        }

        targets.set(targetName, {
          name: targetName,
          distDir,
          distEntry,
          publicUrl: pkgTargets[targetName]?.publicUrl ?? '/',
          env: this.getEnvironment(pkgEngines, mainContext).merge(
            pkgTargets[targetName]
          )
        });
      }
    }

    // Custom targets
    for (let name in pkgTargets) {
      if (COMMON_TARGETS.includes(name)) {
        continue;
      }

      let distPath = pkg[name];
      let distDir;
      let distEntry;
      if (distPath == null) {
        distDir = path.resolve(pkgDir, DEFAULT_DIST_DIRNAME, name);
      } else {
        distDir = path.resolve(pkgDir, path.dirname(distPath));
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
          publicUrl: env.publicUrl ?? '/',
          env: this.getEnvironment(pkgEngines, context).merge(env)
        });
      }
    }

    // If no explicit targets were defined, add a default.
    if (targets.size === 0) {
      let context = browsers || !node ? 'browser' : 'node';
      targets.set('default', {
        name: 'default',
        distDir: path.resolve(DEFAULT_DIST_DIRNAME),
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
