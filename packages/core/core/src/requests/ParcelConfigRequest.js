// @flow strict-local
import type {
  Async,
  FilePath,
  PackageName,
  RawParcelConfig,
  ResolvedParcelConfigFile,
} from '@parcel/types';
import type {StaticRunOpts} from '../RequestTracker';
import type {
  ExtendableParcelConfigPipeline,
  ParcelOptions,
  ProcessedParcelConfig,
} from '../types';

import {
  isDirectoryInside,
  md5FromObject,
  resolveConfig,
  resolve,
  validateSchema,
  findAlternativeNodeModules,
  findAlternativeFiles,
} from '@parcel/utils';
import ThrowableDiagnostic, {
  generateJSONCodeHighlights,
} from '@parcel/diagnostic';
import {parse} from 'json5';
import path from 'path';
import assert from 'assert';

import ParcelConfigSchema from '../ParcelConfig.schema';
import {optionsProxy} from '../utils';
import ParcelConfig from '../ParcelConfig';

type ConfigMap<K, V> = {[K]: V, ...};

export type ConfigAndCachePath = {|
  config: ProcessedParcelConfig,
  cachePath: string,
|};

type RunOpts = {|
  input: null,
  ...StaticRunOpts<ConfigAndCachePath>,
|};

export type ParcelConfigRequest = {|
  id: string,
  type: string,
  input: null,
  run: RunOpts => Async<ConfigAndCachePath>,
|};

type ParcelConfigChain = {|
  config: ProcessedParcelConfig,
  extendedFiles: Array<FilePath>,
|};

const type = 'parcel_config_request';

export default function createParcelConfigRequest(): ParcelConfigRequest {
  return {
    id: type,
    type,
    async run({api, options}: RunOpts): Promise<ConfigAndCachePath> {
      let {config, extendedFiles, usedDefault} = await loadParcelConfig(
        optionsProxy(options, api.invalidateOnOptionChange),
      );

      api.invalidateOnFileUpdate(config.filePath);
      api.invalidateOnFileDelete(config.filePath);

      for (let filePath of extendedFiles) {
        api.invalidateOnFileUpdate(filePath);
        api.invalidateOnFileDelete(filePath);
      }

      if (usedDefault) {
        api.invalidateOnFileCreate('**/.parcelrc');
      }

      let cachePath = md5FromObject(config);
      await options.cache.set(cachePath, config);
      let result = {config, cachePath};
      // TODO: don't store config twice (once in the graph and once in a separate cache entry)
      api.storeResult(result);
      return result;
    },
    input: null,
  };
}

const parcelConfigCache = new Map();

export function getCachedParcelConfig(
  result: ConfigAndCachePath,
  options: ParcelOptions,
): ParcelConfig {
  let {config: processedConfig, cachePath} = result;
  let config = parcelConfigCache.get(cachePath);
  if (config) {
    return config;
  }

  config = new ParcelConfig(
    processedConfig,
    options.packageManager,
    options.inputFS,
    options.shouldAutoInstall,
  );

  parcelConfigCache.set(cachePath, config);
  return config;
}

export async function loadParcelConfig(
  options: ParcelOptions,
): Promise<{|...ParcelConfigChain, usedDefault: boolean|}> {
  let parcelConfig = await resolveParcelConfig(options);

  if (!parcelConfig) {
    throw new Error('Could not find a .parcelrc');
  }

  return parcelConfig;
}

export async function resolveParcelConfig(
  options: ParcelOptions,
): Promise<?{|...ParcelConfigChain, usedDefault: boolean|}> {
  let resolveFrom = getResolveFrom(options);
  let configPath =
    options.config != null
      ? (
          await resolve(options.inputFS, options.config, {
            basedir: resolveFrom,
          })
        ).resolved
      : await resolveConfig(options.inputFS, resolveFrom, ['.parcelrc']);

  let usedDefault = false;
  if (configPath == null && options.defaultConfig != null) {
    usedDefault = true;
    configPath = (
      await resolve(options.inputFS, options.defaultConfig, {
        basedir: resolveFrom,
      })
    ).resolved;
  }

  if (configPath == null) {
    return null;
  }

  let contents;
  try {
    contents = await options.inputFS.readFile(configPath, 'utf8');
  } catch (e) {
    throw new ThrowableDiagnostic({
      diagnostic: {
        message: `Could not find parcel config at ${path.relative(
          options.projectRoot,
          configPath,
        )}`,
        origin: '@parcel/core',
      },
    });
  }

  let {config, extendedFiles} = await parseAndProcessConfig(
    configPath,
    contents,
    options,
  );
  return {config, extendedFiles, usedDefault};
}

export function create(
  config: ResolvedParcelConfigFile,
  options: ParcelOptions,
): Promise<ParcelConfigChain> {
  return processConfigChain(config, config.filePath, options);
}

// eslint-disable-next-line require-await
export async function parseAndProcessConfig(
  configPath: FilePath,
  contents: string,
  options: ParcelOptions,
): Promise<ParcelConfigChain> {
  let config: RawParcelConfig;
  try {
    config = parse(contents);
  } catch (e) {
    let pos = {
      line: e.lineNumber,
      column: e.columnNumber,
    };
    throw new ThrowableDiagnostic({
      diagnostic: {
        message: 'Failed to parse .parcelrc',
        origin: '@parcel/core',

        filePath: configPath,
        language: 'json5',
        codeFrame: {
          code: contents,
          codeHighlights: [
            {
              start: pos,
              end: pos,
              message: e.message,
            },
          ],
        },
      },
    });
  }
  return processConfigChain(config, configPath, options);
}

function processPipeline(
  pipeline: ?Array<PackageName>,
  keyPath: string,
  filePath: FilePath,
  //$FlowFixMe
): any {
  if (pipeline) {
    return pipeline.map((pkg, i) => {
      if (pkg === '...') return pkg;

      return {
        packageName: pkg,
        resolveFrom: filePath,
        keyPath: `${keyPath}/${i}`,
      };
    });
  }
}

function processMap(
  // $FlowFixMe
  map: ?ConfigMap<any, any>,
  keyPath: string,
  filePath: FilePath,
  // $FlowFixMe
): ConfigMap<any, any> | typeof undefined {
  if (!map) return undefined;

  // $FlowFixMe
  let res: ConfigMap<any, any> = {};
  for (let k in map) {
    if (typeof map[k] === 'string') {
      res[k] = {
        packageName: map[k],
        resolveFrom: filePath,
        keyPath: `${keyPath}/${k}`,
      };
    } else {
      res[k] = processPipeline(map[k], `${keyPath}/${k}`, filePath);
    }
  }

  return res;
}

export function processConfig(
  configFile: ResolvedParcelConfigFile,
): ProcessedParcelConfig {
  return {
    extends: configFile.extends,
    filePath: configFile.filePath,
    resolveFrom: configFile.resolveFrom,
    resolvers: processPipeline(
      configFile.resolvers,
      '/resolvers',
      configFile.filePath,
    ),
    transformers: processMap(
      configFile.transformers,
      '/transformers',
      configFile.filePath,
    ),
    bundler:
      configFile.bundler != null
        ? {
            packageName: configFile.bundler,
            resolveFrom: configFile.filePath,
            keyPath: '/bundler',
          }
        : undefined,
    namers: processPipeline(configFile.namers, '/namers', configFile.filePath),
    runtimes: processMap(configFile.runtimes, '/runtimes', configFile.filePath),
    packagers: processMap(
      configFile.packagers,
      '/packagers',
      configFile.filePath,
    ),
    optimizers: processMap(
      configFile.optimizers,
      '/optimizers',
      configFile.filePath,
    ),
    reporters: processPipeline(
      configFile.reporters,
      '/reporters',
      configFile.filePath,
    ),
    validators: processMap(
      configFile.validators,
      '/validators',
      configFile.filePath,
    ),
  };
}

export async function processConfigChain(
  configFile: RawParcelConfig | ResolvedParcelConfigFile,
  filePath: FilePath,
  options: ParcelOptions,
): Promise<ParcelConfigChain> {
  // Validate config...
  let relativePath = path.relative(options.inputFS.cwd(), filePath);
  validateConfigFile(configFile, relativePath);

  // Process config...
  let config: ProcessedParcelConfig = processConfig({
    filePath,
    ...configFile,
  });

  let extendedFiles: Array<FilePath> = [];
  if (configFile.extends != null) {
    let exts = Array.isArray(configFile.extends)
      ? configFile.extends
      : [configFile.extends];
    let errors = [];
    if (exts.length !== 0) {
      let extStartConfig;
      let i = 0;
      for (let ext of exts) {
        try {
          let key = Array.isArray(configFile.extends)
            ? `/extends/${i}`
            : '/extends';
          let resolved = await resolveExtends(ext, filePath, key, options);
          extendedFiles.push(resolved);
          let {
            extendedFiles: moreExtendedFiles,
            config: nextConfig,
          } = await processExtendedConfig(
            filePath,
            key,
            ext,
            resolved,
            options,
          );
          extendedFiles = extendedFiles.concat(moreExtendedFiles);
          extStartConfig = extStartConfig
            ? mergeConfigs(extStartConfig, nextConfig)
            : nextConfig;
        } catch (err) {
          errors.push(err);
        }

        i++;
      }

      // Merge with the inline config last
      if (extStartConfig) {
        config = mergeConfigs(extStartConfig, config);
      }
    }

    if (errors.length > 0) {
      throw new ThrowableDiagnostic({
        diagnostic: errors.flatMap(e => e.diagnostics),
      });
    }
  }

  return {config, extendedFiles};
}

export async function resolveExtends(
  ext: string,
  configPath: FilePath,
  extendsKey: string,
  options: ParcelOptions,
): Promise<FilePath> {
  if (ext.startsWith('.')) {
    return path.resolve(path.dirname(configPath), ext);
  } else {
    try {
      let {resolved} = await resolve(options.inputFS, ext, {
        basedir: path.dirname(configPath),
        extensions: ['.json'],
      });
      return options.inputFS.realpath(resolved);
    } catch (err) {
      let parentContents = await options.inputFS.readFile(configPath, 'utf8');
      let alternatives = await findAlternativeNodeModules(
        options.inputFS,
        ext,
        path.dirname(configPath),
      );
      throw new ThrowableDiagnostic({
        diagnostic: {
          message: 'Cannot find extended parcel config',
          origin: '@parcel/core',
          filePath: configPath,
          language: 'json5',
          codeFrame: {
            code: parentContents,
            codeHighlights: generateJSONCodeHighlights(parentContents, [
              {
                key: extendsKey,
                type: 'value',
                message: `Cannot find module "${ext}"${
                  alternatives[0] ? `, did you mean "${alternatives[0]}"?` : ''
                }`,
              },
            ]),
          },
        },
      });
    }
  }
}

async function processExtendedConfig(
  configPath: FilePath,
  extendsKey: string,
  extendsSpecifier: string,
  resolvedExtendedConfigPath: FilePath,
  options: ParcelOptions,
): Promise<ParcelConfigChain> {
  let contents;
  try {
    contents = await options.inputFS.readFile(
      resolvedExtendedConfigPath,
      'utf8',
    );
  } catch (e) {
    let parentContents = await options.inputFS.readFile(configPath, 'utf8');
    let alternatives = await findAlternativeFiles(
      options.inputFS,
      extendsSpecifier,
      path.dirname(resolvedExtendedConfigPath),
    );
    throw new ThrowableDiagnostic({
      diagnostic: {
        message: 'Cannot find extended parcel config',
        origin: '@parcel/core',
        filePath: configPath,
        language: 'json5',
        codeFrame: {
          code: parentContents,
          codeHighlights: generateJSONCodeHighlights(parentContents, [
            {
              key: extendsKey,
              type: 'value',
              message: `"${extendsSpecifier}" does not exist${
                alternatives[0] ? `, did you mean "./${alternatives[0]}"?` : ''
              }`,
            },
          ]),
        },
      },
    });
  }

  return parseAndProcessConfig(resolvedExtendedConfigPath, contents, options);
}

export function validateConfigFile(
  config: RawParcelConfig | ResolvedParcelConfigFile,
  relativePath: FilePath,
) {
  validateNotEmpty(config, relativePath);

  validateSchema.diagnostic(
    ParcelConfigSchema,
    {data: config, filePath: relativePath},
    '@parcel/core',
    'Invalid Parcel Config',
  );
}

export function validateNotEmpty(
  config: RawParcelConfig | ResolvedParcelConfigFile,
  relativePath: FilePath,
) {
  assert.notDeepStrictEqual(config, {}, `${relativePath} can't be empty`);
}

export function mergeConfigs(
  base: ProcessedParcelConfig,
  ext: ProcessedParcelConfig,
): ProcessedParcelConfig {
  return {
    filePath: ext.filePath,
    resolvers: mergePipelines(base.resolvers, ext.resolvers),
    transformers: mergeMaps(
      base.transformers,
      ext.transformers,
      mergePipelines,
    ),
    validators: mergeMaps(base.validators, ext.validators, mergePipelines),
    bundler: ext.bundler || base.bundler,
    namers: mergePipelines(base.namers, ext.namers),
    runtimes: mergeMaps(base.runtimes, ext.runtimes, mergePipelines),
    packagers: mergeMaps(base.packagers, ext.packagers),
    optimizers: mergeMaps(base.optimizers, ext.optimizers, mergePipelines),
    reporters: mergePipelines(base.reporters, ext.reporters),
  };
}

function getResolveFrom(options: ParcelOptions) {
  let cwd = options.inputFS.cwd();
  let dir = isDirectoryInside(cwd, options.projectRoot)
    ? cwd
    : options.projectRoot;
  return path.join(dir, 'index');
}

export function mergePipelines(
  base: ?ExtendableParcelConfigPipeline,
  ext: ?ExtendableParcelConfigPipeline,
  // $FlowFixMe
): any {
  if (ext == null) {
    return base ?? [];
  }

  if (base) {
    // Merge the base pipeline if a rest element is defined
    let spreadIndex = ext.indexOf('...');
    if (spreadIndex >= 0) {
      if (ext.filter(v => v === '...').length > 1) {
        throw new Error(
          'Only one spread element can be included in a config pipeline',
        );
      }

      return [
        ...ext.slice(0, spreadIndex),
        ...(base || []),
        ...ext.slice(spreadIndex + 1),
      ];
    }
  }

  return ext;
}

export function mergeMaps<K: string, V>(
  base: ?ConfigMap<K, V>,
  ext: ?ConfigMap<K, V>,
  merger?: (a: V, b: V) => V,
): ConfigMap<K, V> {
  if (!ext || Object.keys(ext).length === 0) {
    return base || {};
  }

  if (!base) {
    return ext;
  }

  let res: ConfigMap<K, V> = {};
  // Add the extension options first so they have higher precedence in the output glob map
  for (let k in ext) {
    //$FlowFixMe Flow doesn't correctly infer the type. See https://github.com/facebook/flow/issues/1736.
    let key: K = (k: any);
    res[key] =
      merger && base[key] != null ? merger(base[key], ext[key]) : ext[key];
  }

  // Add base options that aren't defined in the extension
  for (let k in base) {
    // $FlowFixMe
    let key: K = (k: any);
    if (res[key] == null) {
      res[key] = base[key];
    }
  }

  return res;
}
