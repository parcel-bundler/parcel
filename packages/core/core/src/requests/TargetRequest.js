// @flow strict-local

import type {Diagnostic} from '@parcel/diagnostic';
import type {FileSystem} from '@parcel/fs';
import type {
  Async,
  Engines,
  FilePath,
  PackageJSON,
  PackageTargetDescriptor,
  TargetDescriptor,
} from '@parcel/types';
import type {StaticRunOpts, RunAPI} from '../RequestTracker';
import type {Entry, ParcelOptions, Target} from '../types';
import type {ConfigAndCachePath} from './ParcelConfigRequest';

import ThrowableDiagnostic, {
  generateJSONCodeHighlights,
  getJSONSourceLocation,
} from '@parcel/diagnostic';
import path from 'path';
import {
  loadConfig,
  resolveConfig,
  md5FromObject,
  validateSchema,
} from '@parcel/utils';
import {createEnvironment} from '../Environment';
import createParcelConfigRequest, {
  getCachedParcelConfig,
} from './ParcelConfigRequest';
// $FlowFixMe
import browserslist from 'browserslist';
import jsonMap from 'json-source-map';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import {
  COMMON_TARGET_DESCRIPTOR_SCHEMA,
  DESCRIPTOR_SCHEMA,
  PACKAGE_DESCRIPTOR_SCHEMA,
  ENGINES_SCHEMA,
} from '../TargetDescriptor.schema';
import {BROWSER_ENVS} from '../public/Environment';
import {optionsProxy} from '../utils';

type RunOpts = {|
  input: Entry,
  ...StaticRunOpts<Array<Target>>,
|};

const DEFAULT_DIST_DIRNAME = 'dist';
const COMMON_TARGETS = ['main', 'module', 'browser', 'types'];

export type TargetRequest = {|
  id: string,
  +type: 'target_request',
  run: RunOpts => Async<Array<Target>>,
  input: Entry,
|};

const type = 'target_request';

export default function createTargetRequest(input: Entry): TargetRequest {
  return {
    id: `${type}:${md5FromObject(input)}`,
    type,
    run,
    input,
  };
}

async function run({input, api, options}: RunOpts) {
  let targetResolver = new TargetResolver(
    api,
    optionsProxy(options, api.invalidateOnOptionChange),
  );
  let targets = await targetResolver.resolve(input.packagePath);

  let configResult = nullthrows(
    await api.runRequest<null, ConfigAndCachePath>(createParcelConfigRequest()),
  );
  let parcelConfig = getCachedParcelConfig(configResult, options);

  // Find named pipelines for each target.
  let pipelineNames = new Set(parcelConfig.getNamedPipelines());
  for (let target of targets) {
    if (pipelineNames.has(target.name)) {
      target.pipeline = target.name;
    }
  }

  return targets;
}

export class TargetResolver {
  fs: FileSystem;
  api: RunAPI;
  options: ParcelOptions;

  constructor(api: RunAPI, options: ParcelOptions) {
    this.api = api;
    this.fs = options.inputFS;
    this.options = options;
  }

  async resolve(rootDir: FilePath): Promise<Array<Target>> {
    let optionTargets = this.options.targets;

    let packageTargets = await this.resolvePackageTargets(rootDir);
    let targets: Array<Target>;
    if (optionTargets) {
      if (Array.isArray(optionTargets)) {
        if (optionTargets.length === 0) {
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `Targets option is an empty array`,
              origin: '@parcel/core',
            },
          });
        }

        // If an array of strings is passed, it's a filter on the resolved package
        // targets. Load them, and find the matching targets.
        targets = optionTargets.map(target => {
          let matchingTarget = packageTargets.get(target);
          if (!matchingTarget) {
            throw new ThrowableDiagnostic({
              diagnostic: {
                message: `Could not find target with name "${target}"`,
                origin: '@parcel/core',
              },
            });
          }
          return matchingTarget;
        });
      } else {
        // Otherwise, it's an object map of target descriptors (similar to those
        // in package.json). Adapt them to native targets.
        targets = Object.entries(optionTargets).map(([name, _descriptor]) => {
          let {distDir, ...descriptor} = parseDescriptor(
            name,
            _descriptor,
            null,
            JSON.stringify({targets: optionTargets}, null, '\t'),
          );
          if (distDir == null) {
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
                        type: 'value',
                      },
                    ],
                  ),
                },
              },
            });
          }
          let target: Target = {
            name,
            distDir: path.resolve(this.fs.cwd(), distDir),
            publicUrl:
              descriptor.publicUrl ??
              this.options.defaultTargetOptions.publicUrl,
            env: createEnvironment({
              engines: descriptor.engines,
              context: descriptor.context,
              isLibrary: descriptor.isLibrary,
              includeNodeModules: descriptor.includeNodeModules,
              outputFormat: descriptor.outputFormat,
              shouldOptimize:
                this.options.defaultTargetOptions.shouldOptimize &&
                descriptor.optimize !== false,
              shouldScopeHoist:
                this.options.defaultTargetOptions.shouldScopeHoist &&
                descriptor.scopeHoist !== false,
              sourceMap: normalizeSourceMap(this.options, descriptor.sourceMap),
            }),
          };

          if (descriptor.distEntry != null) {
            target.distEntry = descriptor.distEntry;
          }

          return target;
        });
      }

      let serve = this.options.serveOptions;
      if (serve) {
        // In serve mode, we only support a single browser target. If the user
        // provided more than one, or the matching target is not a browser, throw.
        if (targets.length > 1) {
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `More than one target is not supported in serve mode`,
              origin: '@parcel/core',
            },
          });
        }
        if (!BROWSER_ENVS.has(targets[0].env.context)) {
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `Only browser targets are supported in serve mode`,
              origin: '@parcel/core',
            },
          });
        }
        targets[0].distDir = serve.distDir;
      }
    } else {
      // Explicit targets were not provided. Either use a modern target for server
      // mode, or simply use the package.json targets.
      if (this.options.serveOptions) {
        // In serve mode, we only support a single browser target. Since the user
        // hasn't specified a target, use one targeting modern browsers for development
        targets = [
          {
            name: 'default',
            distDir: this.options.serveOptions.distDir,
            publicUrl: this.options.defaultTargetOptions.publicUrl ?? '/',
            env: createEnvironment({
              context: 'browser',
              engines: {},
              shouldOptimize: this.options.defaultTargetOptions.shouldOptimize,
              shouldScopeHoist: this.options.defaultTargetOptions
                .shouldScopeHoist,
              sourceMap: this.options.defaultTargetOptions.sourceMaps
                ? {}
                : undefined,
            }),
          },
        ];
      } else {
        targets = Array.from(packageTargets.values());
      }
    }

    return targets;
  }

  async resolvePackageTargets(rootDir: FilePath): Promise<Map<string, Target>> {
    let conf = await loadConfig(this.fs, path.join(rootDir, 'index'), [
      'package.json',
    ]);

    // Invalidate whenever a package.json file is added.
    // TODO: we really only need to invalidate if added *above* rootDir...
    this.api.invalidateOnFileCreate(`**/package.json`);

    let pkg;
    let pkgContents;
    let pkgFilePath: ?FilePath;
    let pkgDir: FilePath;
    let pkgMap;
    if (conf) {
      pkg = (conf.config: PackageJSON);
      let pkgFile = conf.files[0];
      if (pkgFile == null) {
        throw new ThrowableDiagnostic({
          diagnostic: {
            message: `Expected package.json file in ${rootDir}`,
            origin: '@parcel/core',
          },
        });
      }
      pkgFilePath = pkgFile.filePath;
      pkgDir = path.dirname(pkgFilePath);
      pkgContents = await this.fs.readFile(pkgFilePath, 'utf8');
      pkgMap = jsonMap.parse(pkgContents.replace(/\t/g, ' '));

      this.api.invalidateOnFileUpdate(pkgFilePath);
      this.api.invalidateOnFileDelete(pkgFilePath);
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
        'Invalid engines in package.json',
      ) || {};
    if (pkgEngines.browsers == null) {
      let env =
        this.options.env.BROWSERSLIST_ENV ??
        this.options.env.NODE_ENV ??
        this.options.mode;

      if (pkg.browserslist != null) {
        let pkgBrowserslist = pkg.browserslist;
        let browserslist =
          typeof pkgBrowserslist === 'object' && !Array.isArray(pkgBrowserslist)
            ? pkgBrowserslist[env]
            : pkgBrowserslist;

        pkgEngines = {
          ...pkgEngines,
          browsers: browserslist,
        };
      } else {
        let browserslistConfig = await resolveConfig(
          this.fs,
          path.join(rootDir, 'index'),
          ['browserslist', '.browserslistrc'],
        );

        this.api.invalidateOnFileCreate('**/{browserslist,.browserslistrc}');

        if (browserslistConfig != null) {
          let contents = await this.fs.readFile(browserslistConfig, 'utf8');
          let config = browserslist.parseConfig(contents);
          let browserslistBrowsers = config[env] || config.defaults;

          if (browserslistBrowsers) {
            pkgEngines = {
              ...pkgEngines,
              browsers: browserslistBrowsers,
            };
          }

          // Invalidate whenever browserslist config file or relevant environment variables change
          this.api.invalidateOnFileUpdate(browserslistConfig);
          this.api.invalidateOnFileDelete(browserslistConfig);
          this.api.invalidateOnEnvChange('BROWSERSLIST_ENV');
          this.api.invalidateOnEnvChange('NODE_ENV');
        }
      }
    }

    let targets: Map<string, Target> = new Map();
    let node = pkgEngines.node;
    let browsers = pkgEngines.browsers;

    // If there is a separate `browser` target, or an `engines.node` field but no browser targets, then
    // the `main` and `module` targets refer to node, otherwise browser.
    let mainContext =
      pkg.browser ?? pkgTargets.browser ?? (node != null && !browsers)
        ? 'node'
        : 'browser';
    let moduleContext =
      pkg.browser ?? pkgTargets.browser ? 'browser' : mainContext;

    let defaultEngines = this.options.defaultTargetOptions.engines;
    let context = browsers ?? !node ? 'browser' : 'node';
    if (
      context === 'browser' &&
      pkgEngines.browsers == null &&
      defaultEngines?.browsers != null
    ) {
      pkgEngines = {
        ...pkgEngines,
        browsers: defaultEngines.browsers,
      };
    } else if (
      context === 'node' &&
      pkgEngines.node == null &&
      defaultEngines?.node != null
    ) {
      pkgEngines = {
        ...pkgEngines,
        node: defaultEngines.node,
      };
    }

    for (let targetName of COMMON_TARGETS) {
      let targetDist;
      let pointer;
      if (
        targetName === 'browser' &&
        pkg[targetName] != null &&
        typeof pkg[targetName] === 'object'
      ) {
        // The `browser` field can be a file path or an alias map.
        targetDist = pkg[targetName][pkg.name];
        pointer = `/${targetName}/${pkg.name}`;
      } else {
        targetDist = pkg[targetName];
        pointer = `/${targetName}`;
      }

      if (typeof targetDist === 'string' || pkgTargets[targetName]) {
        let distDir;
        let distEntry;
        let loc;

        invariant(typeof pkgFilePath === 'string');
        invariant(pkgMap != null);

        let _descriptor: mixed = pkgTargets[targetName] ?? {};
        if (typeof targetDist === 'string') {
          distDir = path.resolve(pkgDir, path.dirname(targetDist));
          distEntry = path.basename(targetDist);
          loc = {
            filePath: pkgFilePath,
            ...getJSONSourceLocation(pkgMap.pointers[pointer], 'value'),
          };
        } else {
          distDir =
            this.options.defaultTargetOptions.distDir ??
            path.join(pkgDir, DEFAULT_DIST_DIRNAME, targetName);
        }

        if (_descriptor == false) {
          continue;
        }

        let descriptor = parseCommonTargetDescriptor(
          targetName,
          _descriptor,
          pkgFilePath,
          pkgContents,
        );

        let isLibrary =
          typeof distEntry === 'string'
            ? path.extname(distEntry) === '.js'
            : false;
        targets.set(targetName, {
          name: targetName,
          distDir,
          distEntry,
          publicUrl:
            descriptor.publicUrl ?? this.options.defaultTargetOptions.publicUrl,
          env: createEnvironment({
            engines: descriptor.engines ?? pkgEngines,
            context:
              descriptor.context ??
              (targetName === 'browser'
                ? 'browser'
                : targetName === 'module'
                ? moduleContext
                : mainContext),
            includeNodeModules: descriptor.includeNodeModules ?? !isLibrary,
            outputFormat:
              descriptor.outputFormat ??
              (isLibrary
                ? targetName === 'module'
                  ? 'esmodule'
                  : 'commonjs'
                : 'global'),
            isLibrary: isLibrary,
            shouldOptimize:
              this.options.defaultTargetOptions.shouldOptimize &&
              descriptor.optimize !== false,
            shouldScopeHoist:
              this.options.defaultTargetOptions.shouldScopeHoist &&
              descriptor.scopeHoist !== false,
            sourceMap: normalizeSourceMap(this.options, descriptor.sourceMap),
          }),
          loc,
        });
      }
    }

    let customTargets = (Object.keys(pkgTargets): Array<string>).filter(
      targetName => !COMMON_TARGETS.includes(targetName),
    );

    // Custom targets
    for (let targetName of customTargets) {
      let distPath: mixed = pkg[targetName];
      let distDir;
      let distEntry;
      let loc;
      if (distPath == null) {
        distDir =
          this.options.defaultTargetOptions.distDir ??
          path.join(pkgDir, DEFAULT_DIST_DIRNAME);
        if (customTargets.length >= 2) {
          distDir = path.join(distDir, targetName);
        }
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
              filePath: pkgFilePath ?? undefined,
              codeFrame: {
                code: contents,
                codeHighlights: generateJSONCodeHighlights(contents, [
                  {
                    key: `/${targetName}`,
                    type: 'value',
                    message: 'Expected type string',
                  },
                ]),
              },
            },
          });
        }
        distDir = path.resolve(pkgDir, path.dirname(distPath));
        distEntry = path.basename(distPath);

        invariant(typeof pkgFilePath === 'string');
        invariant(pkgMap != null);
        loc = {
          filePath: pkgFilePath,
          ...getJSONSourceLocation(pkgMap.pointers[`/${targetName}`], 'value'),
        };
      }

      if (targetName in pkgTargets) {
        let descriptor = parsePackageDescriptor(
          targetName,
          pkgTargets[targetName],
          pkgFilePath,
          pkgContents,
        );
        let pkgDir = path.dirname(nullthrows(pkgFilePath));
        targets.set(targetName, {
          name: targetName,
          distDir:
            descriptor.distDir != null
              ? path.resolve(pkgDir, descriptor.distDir)
              : distDir,
          distEntry,
          publicUrl:
            descriptor.publicUrl ?? this.options.defaultTargetOptions.publicUrl,
          env: createEnvironment({
            engines: descriptor.engines ?? pkgEngines,
            context: descriptor.context,
            includeNodeModules: descriptor.includeNodeModules,
            outputFormat: descriptor.outputFormat,
            isLibrary: descriptor.isLibrary,
            shouldOptimize:
              this.options.defaultTargetOptions.shouldOptimize &&
              descriptor.optimize !== false,
            shouldScopeHoist:
              this.options.defaultTargetOptions.shouldScopeHoist &&
              descriptor.scopeHoist !== false,
            sourceMap: normalizeSourceMap(this.options, descriptor.sourceMap),
          }),
          loc,
        });
      }
    }

    // If no explicit targets were defined, add a default.
    if (targets.size === 0) {
      targets.set('default', {
        name: 'default',
        distDir:
          this.options.defaultTargetOptions.distDir ??
          path.join(pkgDir, DEFAULT_DIST_DIRNAME),
        publicUrl: this.options.defaultTargetOptions.publicUrl,
        env: createEnvironment({
          engines: pkgEngines,
          context,
          shouldOptimize: this.options.defaultTargetOptions.shouldOptimize,
          shouldScopeHoist: this.options.defaultTargetOptions.shouldScopeHoist,
          sourceMap: this.options.defaultTargetOptions.sourceMaps
            ? {}
            : undefined,
        }),
      });
    }

    assertNoDuplicateTargets(targets, pkgFilePath, pkgContents);

    return targets;
  }
}

function parseEngines(
  engines: mixed,
  pkgPath: ?FilePath,
  pkgContents: ?string,
  prependKey: string,
  message: string,
): Engines | typeof undefined {
  if (engines === undefined) {
    return engines;
  } else {
    validateSchema.diagnostic(
      ENGINES_SCHEMA,
      {data: engines, source: pkgContents, filePath: pkgPath, prependKey},
      '@parcel/core',
      message,
    );
    // $FlowFixMe we just verified this
    return engines;
  }
}

function parseDescriptor(
  targetName: string,
  descriptor: mixed,
  pkgPath: ?FilePath,
  pkgContents: ?string,
): TargetDescriptor {
  validateSchema.diagnostic(
    DESCRIPTOR_SCHEMA,
    {
      data: descriptor,
      source: pkgContents,
      filePath: pkgPath,
      prependKey: `/targets/${targetName}`,
    },
    '@parcel/core',
    `Invalid target descriptor for target "${targetName}"`,
  );

  // $FlowFixMe we just verified this
  return descriptor;
}

function parsePackageDescriptor(
  targetName: string,
  descriptor: mixed,
  pkgPath: ?FilePath,
  pkgContents: ?string,
): PackageTargetDescriptor {
  validateSchema.diagnostic(
    PACKAGE_DESCRIPTOR_SCHEMA,
    {
      data: descriptor,
      source: pkgContents,
      filePath: pkgPath,
      prependKey: `/targets/${targetName}`,
    },
    '@parcel/core',
    `Invalid target descriptor for target "${targetName}"`,
  );
  // $FlowFixMe we just verified this
  return descriptor;
}

function parseCommonTargetDescriptor(
  targetName: string,
  descriptor: mixed,
  pkgPath: ?FilePath,
  pkgContents: ?string,
): PackageTargetDescriptor {
  validateSchema.diagnostic(
    COMMON_TARGET_DESCRIPTOR_SCHEMA,
    {
      data: descriptor,
      source: pkgContents,
      filePath: pkgPath,
      prependKey: `/targets/${targetName}`,
    },
    '@parcel/core',
    `Invalid target descriptor for target "${targetName}"`,
  );

  // $FlowFixMe we just verified this
  return descriptor;
}

function assertNoDuplicateTargets(targets, pkgFilePath, pkgContents) {
  // Detect duplicate targets by destination path and provide a nice error.
  // Without this, an assertion is thrown much later after naming the bundles and finding duplicates.
  let targetsByPath: Map<string, Array<string>> = new Map();
  for (let target of targets.values()) {
    if (target.distEntry != null) {
      let distPath = path.join(target.distDir, target.distEntry);
      if (!targetsByPath.has(distPath)) {
        targetsByPath.set(distPath, []);
      }
      targetsByPath.get(distPath)?.push(target.name);
    }
  }

  let diagnostics: Array<Diagnostic> = [];
  for (let [targetPath, targetNames] of targetsByPath) {
    if (targetNames.length > 1 && pkgContents != null && pkgFilePath != null) {
      diagnostics.push({
        message: `Multiple targets have the same destination path "${path.relative(
          path.dirname(pkgFilePath),
          targetPath,
        )}"`,
        origin: '@parcel/core',
        language: 'json',
        filePath: pkgFilePath || undefined,
        codeFrame: {
          code: pkgContents,
          codeHighlights: generateJSONCodeHighlights(
            pkgContents,
            targetNames.map(t => ({
              key: `/${t}`,
              type: 'value',
            })),
          ),
        },
      });
    }
  }

  if (diagnostics.length > 0) {
    // Only add hints to the last diagnostic so it isn't duplicated on each one
    diagnostics[diagnostics.length - 1].hints = [
      'Try removing the duplicate targets, or changing the destination paths.',
    ];

    throw new ThrowableDiagnostic({
      diagnostic: diagnostics,
    });
  }
}

function normalizeSourceMap(options: ParcelOptions, sourceMap) {
  if (options.defaultTargetOptions.sourceMaps) {
    if (typeof sourceMap === 'boolean') {
      return sourceMap ? {} : undefined;
    } else {
      return sourceMap ?? {};
    }
  } else {
    return undefined;
  }
}
