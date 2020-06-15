// @flow
import type {
  FilePath,
  RawParcelConfig,
  ResolvedParcelConfigFile,
  PackageName,
} from '@parcel/types';
import type {
  ParcelOptions,
  ProcessedParcelConfig,
  ExtendableParcelConfigPipeline,
} from './types';

import {
  isDirectoryInside,
  resolveConfig,
  resolve,
  validateSchema,
} from '@parcel/utils';
import ThrowableDiagnostic from '@parcel/diagnostic';
import {parse} from 'json5';
import path from 'path';
import assert from 'assert';

import ParcelConfig from './ParcelConfig';
import ParcelConfigSchema from './ParcelConfig.schema';

type ConfigMap<K, V> = {[K]: V, ...};

export default async function loadParcelConfig(options: ParcelOptions) {
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

export async function resolveParcelConfig(options: ParcelOptions) {
  let filePath = getResolveFrom(options);
  let configPath = await resolveConfig(options.inputFS, filePath, [
    '.parcelrc',
  ]);
  if (!configPath) {
    return null;
  }

  return readAndProcessConfigChain(configPath, options);
}

export function create(
  config: ResolvedParcelConfigFile,
  options: ParcelOptions,
) {
  return processConfigChain(config, config.filePath, options);
}

export async function readAndProcessConfigChain(
  configPath: FilePath,
  options: ParcelOptions,
) {
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
  map: ?ConfigMap<any, any>,
  filePath: FilePath,
): ConfigMap<any, any> | typeof undefined {
  if (!map) return undefined;

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
    bundler: configFile.bundler
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
) {
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
  if (configFile.extends) {
    let exts = Array.isArray(configFile.extends)
      ? configFile.extends
      : [configFile.extends];
    for (let ext of exts) {
      let resolved = await resolveExtends(ext, filePath, options);
      extendedFiles.push(resolved);
      let {
        extendedFiles: moreExtendedFiles,
        config: baseConfig,
      } = await readAndProcessConfigChain(resolved, options);
      extendedFiles = extendedFiles.concat(moreExtendedFiles);
      config = mergeConfigs(baseConfig, resolvedFile);
    }
  }

  return {config, extendedFiles};
}

export async function resolveExtends(
  ext: string,
  configPath: FilePath,
  options: ParcelOptions,
) {
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
  ext: ProcessedParcelConfig,
): ParcelConfig {
  return new ParcelConfig(
    {
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
): any {
  if (!ext) {
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

      ext = [
        ...ext.slice(0, spreadIndex),
        ...(base || []),
        ...ext.slice(spreadIndex + 1),
      ];
    }
  }

  return ext;
}

export function mergeMaps<K, V>(
  base: ?ConfigMap<K, V>,
  ext: ?ConfigMap<K, V>,
  merger?: (a: V, b: V) => V,
): ConfigMap<K, V> {
  if (!ext) {
    return base || {};
  }

  if (!base) {
    return ext;
  }

  // Add the extension options first so they have higher precedence in the output glob map
  let res: ConfigMap<K, V> = {};
  for (let k in ext) {
    // Flow doesn't correctly infer the type. See https://github.com/facebook/flow/issues/1736.
    let key: K = (k: any);
    res[key] = merger && base[key] ? merger(base[key], ext[key]) : ext[key];
  }

  // Add base options that aren't defined in the extension
  for (let k in base) {
    let key: K = (k: any);
    if (!res[key]) {
      res[key] = base[key];
    }
  }

  return res;
}
