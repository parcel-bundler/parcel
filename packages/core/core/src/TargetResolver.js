// @flow

import type {
  Engines,
  File,
  FilePath,
  PackageJSON,
  PackageTargetDescriptor,
  TargetDescriptor
} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {ParcelOptions, Target} from './types';

import ThrowableDiagnostic, {
  generateJSONCodeHighlights
} from '@parcel/diagnostic';
import {loadConfig, validateSchema} from '@parcel/utils';
import {createEnvironment} from './Environment';
import path from 'path';
import browserslist from 'browserslist';
import DESCRIPTOR_SCHEMA, {ENGINES_SCHEMA} from './TargetDescriptor.schema';

export type TargetResolveResult = {|
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
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `Targets is an empty array`,
              origin: '@parcel/core'
            }
          });
        }

        // If an array of strings is passed, it's a filter on the resolved package
        // targets. Load them, and find the matching targets.
        let packageTargets = await this.resolvePackageTargets(rootDir);
        targets = optionTargets.map(target => {
          let matchingTarget = packageTargets.targets.get(target);
          if (!matchingTarget) {
            throw new ThrowableDiagnostic({
              diagnostic: {
                message: `Could not find target with name "${target}"`,
                origin: '@parcel/core'
              }
            });
          }
          return matchingTarget;
        });
        files = packageTargets.files;
      } else {
        // Otherwise, it's an object map of target descriptors (similar to those
        // in package.json). Adapt them to native targets.
        targets = Object.entries(optionTargets).map(([name, _descriptor]) => {
          let {distDir, ...descriptor} = parseDescriptor(
            name,
            _descriptor,
            null,
            {targets: optionTargets}
          );
          if (!distDir) {
            let optionTargetsString = JSON.stringify(optionTargets, null, '\t');
            throw new ThrowableDiagnostic({
              diagnostic: {
                message: `Missing distDir for target "${name}"`,
                origin: '@parcel/core',
                codeFrame: {
                  code: optionTargetsString,
                  codeHighlights: generateJSONCodeHighlights(
                    optionTargetsString,
                    [
                      {
                        key: `/${name}`,
                        type: 'value'
                      }
                    ]
                  )
                }
              }
            });
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
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `More than one target is not supported in serve mode`,
              origin: '@parcel/core'
            }
          });
        }
        if (targets[0].env.context !== 'browser') {
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `Only browser targets are supported in serve mode`,
              origin: '@parcel/core'
            }
          });
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
    let pkgContents;
    let pkgFilePath: ?FilePath;
    let pkgDir: FilePath;
    if (conf) {
      pkg = (conf.config: PackageJSON);
      let pkgFile = conf.files[0];
      if (pkgFile == null) {
        throw new ThrowableDiagnostic({
          diagnostic: {
            message: `Expected package.json file in ${rootDir}`,
            origin: '@parcel/core'
          }
        });
      }
      pkgFilePath = pkgFile.filePath;
      pkgDir = path.dirname(pkgFilePath);
      pkgContents = await this.fs.readFile(pkgFilePath, 'utf8');
    } else {
      pkg = {};
      pkgDir = this.fs.cwd();
    }

    let pkgTargets = pkg.targets || {};
    let pkgEngines: Engines =
      parseEngines(
        pkg.engines,
        pkgFilePath,
        pkgContents,
        '/engines',
        'Invalid engines in package.json'
      ) || {};
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

        let descriptor = parseDescriptor(
          targetName,
          _descriptor,
          pkgFilePath,
          pkgContents
        );
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
          let contents: string =
            typeof pkgContents === 'string'
              ? pkgContents
              : // $FlowFixMe
                JSON.stringify(pkgContents, null, '\t');
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `Invalid distPath for target "${targetName}"`,
              origin: '@parcel/core',
              language: 'json',
              filePath: pkgFilePath || undefined,
              codeFrame: {
                code: contents,
                codeHighlights: generateJSONCodeHighlights(contents, [
                  {
                    key: `/${targetName}`,
                    type: 'value',
                    message: 'Expected type string'
                  }
                ])
              }
            }
          });
        }
        distDir = path.resolve(pkgDir, path.dirname(distPath));
        distEntry = path.basename(distPath);
      }

      if (_descriptor) {
        let descriptor = parseDescriptor(
          targetName,
          _descriptor,
          pkgFilePath,
          pkgContents
        );
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

function parseEngines(
  engines: mixed,
  pkgPath: ?FilePath,
  pkgContents: string | mixed,
  prependKey: string,
  message: string
): Engines | typeof undefined {
  if (engines === undefined) {
    return engines;
  } else {
    validateSchema.diagnostic(
      ENGINES_SCHEMA,
      engines,
      pkgPath,
      pkgContents,
      '@parcel/core',
      prependKey,
      message
    );

    // $FlowFixMe we just verified this
    return engines;
  }
}

function parseDescriptor(
  targetName: string,
  descriptor: mixed,
  pkgPath: ?FilePath,
  pkgContents: string | mixed
): TargetDescriptor | PackageTargetDescriptor {
  validateSchema.diagnostic(
    DESCRIPTOR_SCHEMA,
    descriptor,
    pkgPath,
    pkgContents,
    '@parcel/core',
    `/targets/${targetName}`,
    `Invalid target descriptor for target "${targetName}"`
  );

  // $FlowFixMe we just verified this
  return descriptor;
}
