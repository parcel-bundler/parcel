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
} from '@parcel/utils';
import ThrowableDiagnostic from '@parcel/diagnostic';
// $FlowFixMe
import {parse} from 'json5';
import path from 'path';
import assert from 'assert';

import ParcelConfig from '../ParcelConfig';
import ParcelConfigSchema from '../ParcelConfig.schema';

const NAMED_PIPELINE_REGEX = /^[\w-.+]+:/;

type ConfigMap<K, V> = {[K]: V, ...};

export type ConfigAndCachePath = {|
  config: ProcessedParcelConfig,
  cachePath: string,
|};

type RunOpts = {|
  input: null,
  ...StaticRunOpts,
|};

export type ParcelConfigRequest = {|
  id: string,
  type: string,
  input: null,
  run: RunOpts => Async<ConfigAndCachePath>,
|};

type ParcelConfigChain = {|
  config: ParcelConfig,
  extendedFiles: Array<FilePath>,
|};

const type = 'parcel_config_request';

export default function createParcelConfigRequest(): ParcelConfigRequest {
  return {
    id: type,
    type,
    async run({api, options}: RunOpts): Promise<ConfigAndCachePath> {
      let {config, extendedFiles} = await loadParcelConfig(options);
      let processedConfig = config.getConfig();

      api.invalidateOnFileUpdate(config.filePath);
      api.invalidateOnFileDelete(config.filePath);

      for (let filePath of extendedFiles) {
        api.invalidateOnFileUpdate(filePath);
        api.invalidateOnFileDelete(filePath);
      }

      if (config.filePath === options.defaultConfig?.filePath) {
        api.invalidateOnFileCreate('**/.parcelrc');
      }

      let cachePath = md5FromObject(processedConfig);
      await options.cache.set(cachePath, processedConfig);
      let result = {config: processedConfig, cachePath};
      // TODO: don't store config twice (once in the graph and once in a separate cache entry)
      api.storeResult(result);
      return result;
    },
    input: null,
  };
}

export async function loadParcelConfig(
  options: ParcelOptions,
): Promise<ParcelConfigChain> {
  // Resolve plugins from cwd when a config is passed programmatically
  let parcelConfig = options.config
    ? await create(
        {
          ...options.config,
          resolveFrom: options.inputFS.cwd(),
        },
        options,
      )
    : await resolveParcelConfig(options);
  if (!parcelConfig && options.defaultConfig) {
    parcelConfig = await create(
      {
        ...options.defaultConfig,
        resolveFrom: options.inputFS.cwd(),
      },
      options,
    );
  }

  if (!parcelConfig) {
    throw new Error('Could not find a .parcelrc');
  }

  return parcelConfig;
}

export async function resolveParcelConfig(
  options: ParcelOptions,
): Promise<?ParcelConfigChain> {
  let filePath = getResolveFrom(options);
  let configPath = await resolveConfig(options.inputFS, filePath, [
    '.parcelrc',
  ]);
  if (configPath == null) {
    return null;
  }

  return readAndProcessConfigChain(configPath, options);
}

export function create(
  config: ResolvedParcelConfigFile,
  options: ParcelOptions,
): Promise<ParcelConfigChain> {
  return processConfigChain(config, config.filePath, options);
}

export async function readAndProcessConfigChain(
  configPath: FilePath,
  options: ParcelOptions,
): Promise<ParcelConfigChain> {
  let contents = await options.inputFS.readFile(configPath, 'utf8');
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
  filePath: FilePath,
  //$FlowFixMe
): any {
  if (pipeline) {
    return pipeline.map(pkg => {
      if (pkg === '...') return pkg;

      return {
        packageName: pkg,
        resolveFrom: filePath,
      };
    });
  }
}

function processMap(
  // $FlowFixMe
  map: ?ConfigMap<any, any>,
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
      };
    } else {
      res[k] = processPipeline(map[k], filePath);
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
    resolvers: processPipeline(configFile.resolvers, configFile.filePath),
    transformers: processMap(configFile.transformers, configFile.filePath),
    bundler:
      configFile.bundler != null
        ? {
            packageName: configFile.bundler,
            resolveFrom: configFile.filePath,
          }
        : undefined,
    namers: processPipeline(configFile.namers, configFile.filePath),
    runtimes: processMap(configFile.runtimes, configFile.filePath),
    packagers: processMap(configFile.packagers, configFile.filePath),
    optimizers: processMap(configFile.optimizers, configFile.filePath),
    reporters: processPipeline(configFile.reporters, configFile.filePath),
    validators: processMap(configFile.validators, configFile.filePath),
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
  let resolvedFile: ProcessedParcelConfig = processConfig({
    filePath,
    ...configFile,
  });
  let config = new ParcelConfig(
    resolvedFile,
    options.packageManager,
    options.autoinstall,
  );

  let extendedFiles: Array<FilePath> = [];
  if (configFile.extends != null) {
    let exts = Array.isArray(configFile.extends)
      ? configFile.extends
      : [configFile.extends];
    if (exts.length !== 0) {
      let [extStart, ...otherExts] = exts;
      let extStartResolved = await resolveExtends(extStart, filePath, options);
      extendedFiles.push(extStartResolved);
      let {
        extendedFiles: extStartMoreExtendedFiles,
        config: extStartConfig,
      } = await readAndProcessConfigChain(extStartResolved, options);
      extendedFiles = extendedFiles.concat(extStartMoreExtendedFiles);
      for (let ext of otherExts) {
        let resolved = await resolveExtends(ext, filePath, options);
        extendedFiles.push(resolved);
        let {
          extendedFiles: moreExtendedFiles,
          config: nextConfig,
        } = await readAndProcessConfigChain(resolved, options);
        extendedFiles = extendedFiles.concat(moreExtendedFiles);
        extStartConfig = mergeConfigs(extStartConfig, nextConfig);
      }
      // Merge with the inline config last
      config = mergeConfigs(extStartConfig, resolvedFile);
    }
  }

  return {config, extendedFiles};
}

export async function resolveExtends(
  ext: string,
  configPath: FilePath,
  options: ParcelOptions,
): Promise<FilePath> {
  if (ext.startsWith('.')) {
    return path.resolve(path.dirname(configPath), ext);
  } else {
    let {resolved} = await resolve(options.inputFS, ext, {
      basedir: path.dirname(configPath),
      extensions: ['.json'],
    });
    return options.inputFS.realpath(resolved);
  }
}

export function validateConfigFile(
  config: RawParcelConfig | ResolvedParcelConfigFile,
  relativePath: FilePath,
) {
  validateNotEmpty(config, relativePath);

  validateSchema.diagnostic(
    ParcelConfigSchema,
    config,
    relativePath,
    JSON.stringify(config, null, '\t'),
    '@parcel/core',
    '',
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
  base: ParcelConfig,
  ext: ProcessedParcelConfig | ParcelConfig,
): ParcelConfig {
  return new ParcelConfig(
    {
      filePath: ext.filePath,
      resolvers: mergePipelines(base.resolvers, ext.resolvers),
      transformers: mergeMaps(
        base.transformers,
        ext.transformers,
        mergePipelines,
        true,
      ),
      validators: mergeMaps(base.validators, ext.validators, mergePipelines),
      bundler: ext.bundler || base.bundler,
      namers: mergePipelines(base.namers, ext.namers),
      runtimes: mergeMaps(base.runtimes, ext.runtimes, mergePipelines),
      packagers: mergeMaps(base.packagers, ext.packagers),
      optimizers: mergeMaps(base.optimizers, ext.optimizers, mergePipelines),
      reporters: mergePipelines(base.reporters, ext.reporters),
    },
    base.packageManager,
    base.autoinstall,
  );
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
  if (!ext || ext.length === 0) {
    return base || [];
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
  hasNamedPipelines: boolean = false,
): ConfigMap<K, V> {
  if (!ext || Object.keys(ext).length === 0) {
    return base || {};
  }

  if (!base) {
    return ext;
  }

  let res: ConfigMap<K, V> = {};
  if (hasNamedPipelines) {
    // in res, all named pipelines should come before the other pipelines
    for (let k in ext) {
      // $FlowFixMe Flow doesn't correctly infer the type. See https://github.com/facebook/flow/issues/1736.
      let key: K = (k: any);
      if (NAMED_PIPELINE_REGEX.test(key)) {
        res[key] =
          merger && base[key] != null ? merger(base[key], ext[key]) : ext[key];
      }
    }

    // Add base options that aren't defined in the extension
    for (let k in base) {
      // $FlowFixMe
      let key: K = (k: any);
      if (NAMED_PIPELINE_REGEX.test(key)) {
        if (res[key] == null) {
          res[key] = base[key];
        }
      }
    }
  }

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
