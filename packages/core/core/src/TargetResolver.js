// @flow

import type {
  Engines,
  EnvironmentContext,
  File,
  FilePath,
  OutputFormat,
  PackageJSON,
  PackageName,
  TargetSourceMapOptions
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
const COMMON_TARGETS = ['main', 'module', 'browser', 'types'];

function parseEngines(
  targetName: ?string,
  engines: mixed
): Engines | typeof undefined {
  if (engines === undefined) {
    return;
  } else if (engines && typeof engines === 'object') {
    let result = {};
    for (let key in engines) {
      let value: mixed = engines[key];
      if (key === 'browsers' && Array.isArray(value)) {
        value = value.map(v => {
          if (typeof v !== 'string') {
            throw new Error(
              `Invalid value in engines.browsers array ${
                targetName ? `for target "${targetName}"` : ''
              }: ${String(v)}`
            );
          }
          return v;
        });
      } else if (typeof value !== 'string') {
        throw new Error(
          `Invalid value for engines.${key} ${
            targetName ? `for target "${targetName}"` : ''
          }: ${String(value)}`
        );
      }
      result[key] = value;
    }
    return result;
  } else {
    throw new Error(
      `Invalid engines ${
        targetName ? `for target "${targetName}"` : ''
      }: ${String(engines)}`
    );
  }
}

function stringify(v: ?mixed): string {
  if (v === undefined) return 'undefined';
  else return JSON.stringify(v) || 'undefined';
}

function parseDescriptor(
  targetName: string,
  descriptor: mixed
): {|
  context?: EnvironmentContext | typeof undefined,
  engines?: Engines | typeof undefined,
  includeNodeModules?: boolean | Array<PackageName> | typeof undefined,
  outputFormat?: OutputFormat | typeof undefined,
  publicUrl?: string | typeof undefined,
  distDir?: FilePath | typeof undefined,
  sourceMap?: TargetSourceMapOptions | typeof undefined,
  distDir: FilePath | typeof undefined,
  isLibrary: boolean | typeof undefined
|} {
  if (!(descriptor && typeof descriptor === 'object')) {
    throw new Error(`Empty descriptor for target "${targetName}"`);
  }

  let {
    context,
    distDir,
    engines: _engines,
    includeNodeModules: _includeNodeModules,
    isLibrary,
    outputFormat,
    publicUrl,
    sourceMap: _sourceMap,
    ...rest
  } = descriptor;

  if (Object.keys(rest).length !== 0) {
    throw new Error(
      `Unexpected properties in descriptor for target "${targetName}": ${Object.keys(
        rest
      )
        .map(v => stringify(v))
        .join(',')}`
    );
  }

  if (
    !(
      context === undefined ||
      context === 'browser' ||
      context === 'web-worker' ||
      context === 'service-worker' ||
      context === 'node' ||
      context === 'electron-main' ||
      context === 'electron-renderer'
    )
  ) {
    throw new Error(
      `Invalid context for target "${targetName}": ${stringify(context)}`
    );
  }

  let engines = parseEngines(targetName, _engines);

  if (!(distDir === undefined || typeof distDir === 'string')) {
    throw new Error(
      `Invalid distDir for target "${targetName}": ${stringify(distDir)}`
    );
  }

  let includeNodeModules;
  if (
    _includeNodeModules === undefined ||
    typeof _includeNodeModules === 'boolean'
  ) {
    includeNodeModules = _includeNodeModules;
  } else if (Array.isArray(_includeNodeModules)) {
    includeNodeModules = _includeNodeModules.map(v => {
      if (typeof v !== 'string') {
        throw new Error(
          `Invalid value in includeNodeModules array for target "${targetName}": ${stringify(
            v
          )} in ${stringify(_includeNodeModules)}`
        );
      }
      return v;
    });
  } else {
    throw new Error(
      `Invalid value for includeNodeModules for target "${targetName}": ${stringify(
        _includeNodeModules
      )}`
    );
  }

  if (!(isLibrary === undefined || typeof isLibrary === 'boolean')) {
    throw new Error(
      `Invalid value for isLibrary for target "${targetName}": ${stringify(
        isLibrary
      )}`
    );
  }

  if (
    !(
      outputFormat === undefined ||
      outputFormat === 'esmodule' ||
      outputFormat === 'commonjs' ||
      outputFormat === 'global'
    )
  ) {
    throw new Error(
      `Invalid outputFormat for target "${targetName}": ${stringify(
        outputFormat
      )}`
    );
  }

  if (!(publicUrl === undefined || typeof publicUrl === 'string')) {
    throw new Error(
      `Invalid publicUrl for target "${targetName}": ${stringify(publicUrl)}`
    );
  }

  let sourceMap: TargetSourceMapOptions | typeof undefined;
  if (_sourceMap && typeof _sourceMap === 'object') {
    let {inlineSources, inline, sourceRoot, ...rest} = _sourceMap;
    if (Object.keys(rest).length > 0) {
      throw new Error(
        `Unknown sourceMap options for target "${targetName}": ${stringify(
          Object.keys(rest)
        )}`
      );
    }

    if (!(inline === undefined || typeof inline === 'boolean')) {
      throw new Error(
        `Invalid sourceMap.inline setting for target "${targetName}": ${stringify(
          inline
        )}`
      );
    }
    if (!(inlineSources === undefined || typeof inlineSources === 'boolean')) {
      throw new Error(
        `Invalid sourceMap.inlineSources setting for target "${targetName}": ${stringify(
          inline
        )}`
      );
    }
    if (!(sourceRoot === undefined || typeof sourceRoot === 'string')) {
      throw new Error(
        `Invalid sourceMap.sourceRoot setting for target "${targetName}": ${stringify(
          inline
        )}`
      );
    }

    sourceMap = {
      ...(inlineSources ? {inlineSources} : null),
      ...(inline ? {inline} : null),
      ...(sourceRoot ? {sourceRoot} : null)
    };
  } else if (_sourceMap !== undefined) {
    throw new Error(
      `Invalid sourceMap setting for target "${targetName}": ${stringify(
        _sourceMap
      )}`
    );
  }

  return {
    context,
    distDir,
    engines,
    includeNodeModules,
    isLibrary,
    outputFormat,
    publicUrl,
    sourceMap
  };
}

export default class TargetResolver {
  fs: FileSystem;
  options: ParcelOptions;

  constructor(options: ParcelOptions) {
    this.fs = options.inputFS;
    this.options = options;
  }

  async resolve(rootDir: FilePath): Promise<TargetResolveResult> {
    let optionTargets = this.options.targets;

    let targets: Array<Target>;
    let files: Array<File> = [];
    if (optionTargets) {
      if (Array.isArray(optionTargets)) {
        if (optionTargets.length === 0) {
          throw new Error('Targets was an empty array');
        }

        // If an array of strings is passed, it's a filter on the resolved package
        // targets. Load them, and find the matching targets.
        let packageTargets = await this.resolvePackageTargets(rootDir);
        targets = optionTargets.map(target => {
          let matchingTarget = packageTargets.targets.get(target);
          if (!matchingTarget) {
            throw new Error(`Could not find target with name '${target}'`);
          }
          return matchingTarget;
        });
        files = packageTargets.files;
      } else {
        // Otherwise, it's an object map of target descriptors (similar to those
        // in package.json). Adapt them to native targets.
        targets = Object.entries(optionTargets).map(([name, _descriptor]) => {
          let {distDir, ...descriptor} = parseDescriptor(name, _descriptor);
          if (!distDir) {
            throw new Error(`Missing distDir for target '${name}'`);
          }
          return {
            name,
            distDir: path.resolve(this.fs.cwd(), distDir),
            publicUrl: descriptor.publicUrl,
            env: createEnvironment({
              engines: descriptor.engines,
              context: descriptor.context,
              isLibrary: descriptor.isLibrary,
              includeNodeModules: descriptor.includeNodeModules,
              outputFormat: descriptor.outputFormat
            }),
            sourceMap: descriptor.sourceMap
          };
        });
      }

      if (this.options.serve) {
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
      if (this.options.serve) {
        // In serve mode, we only support a single browser target. Since the user
        // hasn't specified a target, use one targeting modern browsers for development
        let serveOptions = this.options.serve;
        targets = [
          {
            name: 'default',
            // For serve, write the `dist` to inside the parcel cache, which is
            // temporary, likely in a .gitignore or similar, but still readily
            // available for introspection by the user if necessary.
            distDir: path.resolve(this.options.cacheDir, DEFAULT_DIST_DIRNAME),
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
        let packageTargets = await this.resolvePackageTargets(rootDir);
        targets = Array.from(packageTargets.targets.values());
        files = packageTargets.files;
      }
    }

    return {targets, files};
  }

  async resolvePackageTargets(rootDir: FilePath) {
    let conf = await loadConfig(this.fs, path.join(rootDir, 'index'), [
      'package.json'
    ]);

    let pkg;
    let pkgDir: FilePath;
    if (conf) {
      pkg = (conf.config: PackageJSON);
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
    let pkgEngines: Engines = parseEngines(null, pkg.engines) || {};
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
      this.options.defaultEngines ??
      (this.options.mode === 'production'
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

        let _descriptor: mixed = pkgTargets[targetName] || {};
        if (typeof targetDist === 'string') {
          distDir = path.resolve(pkgDir, path.dirname(targetDist));
          distEntry = path.basename(targetDist);
        } else {
          distDir = path.resolve(pkgDir, DEFAULT_DIST_DIRNAME, targetName);
        }

        let descriptor = parseDescriptor(targetName, _descriptor);
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
    for (let targetName in pkgTargets) {
      if (COMMON_TARGETS.includes(targetName)) {
        continue;
      }

      let _descriptor: mixed = pkgTargets[targetName];
      let distPath: mixed = pkg[targetName];
      let distDir;
      let distEntry;
      if (distPath == null) {
        distDir = path.resolve(pkgDir, DEFAULT_DIST_DIRNAME, targetName);
      } else {
        if (typeof distPath !== 'string') {
          throw new Error(
            `Invalid distPath for target "${targetName}": ${stringify(
              distPath
            )}`
          );
        }
        distDir = path.resolve(pkgDir, path.dirname(distPath));
        distEntry = path.basename(distPath);
      }

      if (_descriptor) {
        let descriptor = parseDescriptor(targetName, _descriptor);
        targets.set(targetName, {
          name: targetName,
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
