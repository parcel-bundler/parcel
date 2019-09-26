// @flow

import type {
  TargetDescriptor,
  File,
  FilePath,
  PackageJSON
} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {ParcelOptions, Target} from './types';

import {loadConfig} from '@parcel/utils';
import {createEnvironment} from './Environment';
import path from 'path';
import browserslist from 'browserslist';

type TargetResolveResult = {|
  targets: Array<Target>,
  files: Array<File>
|};

const DEFAULT_DEVELOPMENT_ENGINES = {
  node: 'current',
  browsers: [
    'last 1 Chrome version',
    'last 1 Safari version',
    'last 1 Firefox version',
    'last 1 Edge version'
  ]
};

const DEFAULT_PRODUCTION_ENGINES = {
  browsers: ['>= 0.25%'],
  node: '8'
};

const DEFAULT_DIST_DIRNAME = 'dist';
const COMMON_TARGETS = ['main', 'module', 'browser'];

export default class TargetResolver {
  fs: FileSystem;
  constructor(fs: FileSystem) {
    this.fs = fs;
  }

  async resolve(
    rootDir: FilePath,
    cacheDir: FilePath,
    initialOptions: ParcelOptions
  ): Promise<TargetResolveResult> {
    let optionTargets = initialOptions.targets;

    let targets: Array<Target>;
    let files: Array<File> = [];
    if (optionTargets) {
      if (Array.isArray(optionTargets)) {
        if (optionTargets.length === 0) {
          throw new Error('Targets was an empty array');
        }

        // If an array of strings is passed, it's a filter on the resolved package
        // targets. Load them, and find the matching targets.
        let packageTargets = await this.resolvePackageTargets(
          rootDir,
          initialOptions
        );
        targets = optionTargets.map(target => {
          let matchingTarget = packageTargets.targets.get(target);
          if (!matchingTarget) {
            throw new Error(`Could not find target with name ${target}`);
          }
          return matchingTarget;
        });
        files = packageTargets.files;
      } else {
        // Otherwise, it's an object map of target descriptors (similar to those
        // in package.json). Adapt them to native targets.
        targets = Object.entries(optionTargets).map(([name, _descriptor]) => {
          // $FlowFixMe
          let descriptor: TargetDescriptor = _descriptor;
          return {
            name,
            distDir: path.resolve(this.fs.cwd(), descriptor.distDir),
            publicUrl: descriptor.publicUrl,
            env: createEnvironment(descriptor),
            sourceMap: descriptor.sourceMap
          };
        });
      }

      if (initialOptions.serve) {
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
      // Explicit targets were not provided. Either use a modern target for server
      // mode, or simply use the package.json targets.
      if (initialOptions.serve) {
        // In serve mode, we only support a single browser target. Since the user
        // hasn't specified a target, use one targeting modern browsers for development
        let serveOptions = initialOptions.serve;
        targets = [
          {
            name: 'default',
            // For serve, write the `dist` to inside the parcel cache, which is
            // temporary, likely in a .gitignore or similar, but still readily
            // available for introspection by the user if necessary.
            distDir: path.resolve(cacheDir, DEFAULT_DIST_DIRNAME),
            publicUrl: serveOptions.publicUrl ?? '/',
            env: createEnvironment({
              context: 'browser',
              engines: {
                browsers: DEFAULT_DEVELOPMENT_ENGINES.browsers
              }
            })
          }
        ];
      } else {
        let packageTargets = await this.resolvePackageTargets(
          rootDir,
          initialOptions
        );
        targets = Array.from(packageTargets.targets.values());
        files = packageTargets.files;
      }
    }

    return {targets, files};
  }

  async resolvePackageTargets(rootDir: FilePath, options: ParcelOptions) {
    let conf = await loadConfig(this.fs, path.join(rootDir, 'index'), [
      'package.json'
    ]);

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
      pkgDir = this.fs.cwd();
    }

    let pkgTargets = pkg.targets || {};
    let pkgEngines = {...pkg.engines};
    if (!pkgEngines.browsers) {
      let browserslistBrowsers = browserslist.loadConfig({path: rootDir});
      if (browserslistBrowsers) {
        pkgEngines.browsers = browserslistBrowsers;
      }
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
    let moduleContext =
      pkg.browser || pkgTargets.browser ? 'browser' : mainContext;

    let defaultEngines =
      options.defaultEngines ??
      (options.mode === 'production'
        ? DEFAULT_PRODUCTION_ENGINES
        : DEFAULT_DEVELOPMENT_ENGINES);
    let context = browsers || !node ? 'browser' : 'node';
    if (context === 'browser' && pkgEngines.browsers == null) {
      pkgEngines.browsers = defaultEngines.browsers;
    } else if (context === 'node' && pkgEngines.node == null) {
      pkgEngines.node = defaultEngines.node;
    }

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

        let descriptor = pkgTargets[targetName] || {};
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
          publicUrl: descriptor.publicUrl ?? '/',
          env: createEnvironment({
            engines: descriptor.engines ?? pkgEngines,
            context:
              descriptor.context ??
              (targetName === 'browser'
                ? 'browser'
                : targetName === 'module'
                ? moduleContext
                : mainContext),
            includeNodeModules: descriptor.includeNodeModules ?? false,
            outputFormat:
              descriptor.outputFormat ??
              (targetName === 'module' ? 'esmodule' : 'commonjs'),
            isLibrary: true
          }),
          sourceMap: descriptor.sourceMap
        });
      }
    }

    // Custom targets
    for (let name in pkgTargets) {
      if (COMMON_TARGETS.includes(name)) {
        continue;
      }

      let descriptor = pkgTargets[name];
      let distPath = pkg[name];
      let distDir;
      let distEntry;
      if (distPath == null) {
        distDir = path.resolve(pkgDir, DEFAULT_DIST_DIRNAME, name);
      } else {
        distDir = path.resolve(pkgDir, path.dirname(distPath));
        distEntry = path.basename(distPath);
      }

      if (descriptor) {
        targets.set(name, {
          name,
          distDir,
          distEntry,
          publicUrl: descriptor.publicUrl ?? '/',
          env: createEnvironment({
            engines: descriptor.engines ?? pkgEngines,
            context: descriptor.context,
            includeNodeModules: descriptor.includeNodeModules,
            outputFormat: descriptor.outputFormat,
            isLibrary: descriptor.isLibrary
          }),
          sourceMap: descriptor.sourceMap
        });
      }
    }

    // If no explicit targets were defined, add a default.
    if (targets.size === 0) {
      targets.set('default', {
        name: 'default',
        distDir: path.resolve(this.fs.cwd(), DEFAULT_DIST_DIRNAME),
        publicUrl: '/',
        env: createEnvironment({
          engines: pkgEngines,
          context
        })
      });
    }

    return {
      targets,
      files: conf ? conf.files : []
    };
  }
}
