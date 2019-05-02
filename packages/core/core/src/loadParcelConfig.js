// @flow
import type {
  FilePath,
  ParcelConfig,
  ParcelConfigFile,
  PackageName
} from '@parcel/types';
import {resolveConfig} from '@parcel/utils/src/config';
import Config from './ParcelConfig';
import * as fs from '@parcel/fs';
import {parse} from 'json5';
import path from 'path';
import {localResolve} from '@parcel/utils/src/localRequire';
import assert from 'assert';

type Pipeline = Array<PackageName>;
type ConfigMap<K, V> = {[K]: V};

export default async function loadParcelConfig(filePath, options) {
  // Resolve plugins from cwd when a config is passed programmatically
  let parcelConfig = options.parcelConfig
    ? await create({
        ...options.parcelConfig,
        resolveFrom: options.cwd
      })
    : await resolve(filePath);
  if (!parcelConfig && options.defaultConfig) {
    parcelConfig = await create({
      ...options.defaultConfig,
      resolveFrom: options.cwd
    });
  }

  if (!parcelConfig) {
    throw new Error('Could not find a .parcelrc');
  }

  return parcelConfig;
}

async function resolve(filePath: FilePath): Promise<?Config> {
  let configPath = await resolveConfig(filePath, ['.parcelrc'], {
    noCache: true
  });
  if (!configPath) {
    return null;
  }

  let [config, extendedFiles] = await readAndProcess(configPath);
  return new Config({...config, filePath: configPath});
}

async function create(config: ParcelConfig) {
  let [result, extendedFiles] = await processConfig(config);
  return new Config({extendedFiles, ...result});
}

async function readAndProcess(configPath: FilePath) {
  let config: ParcelConfigFile = parse(await fs.readFile(configPath));
  return processConfig({...config, filePath: configPath});
}

async function processConfig(config: ParcelConfig) {
  let relativePath = path.relative(process.cwd(), config.filePath);
  validateConfig(config, relativePath);

  let extendedFiles = [];

  if (config.extends) {
    let exts = Array.isArray(config.extends)
      ? config.extends
      : [config.extends];
    for (let ext of exts) {
      let resolved = await resolveExtends(ext, config.filePath);
      extendedFiles.push(resolved);
      let [baseConfig, moreExtendedFiles] = await readAndProcess(resolved);
      extendedFiles = extendedFiles.concat(moreExtendedFiles);
      config = mergeConfigs(baseConfig, config);
    }
  }

  return [config, extendedFiles];
}

async function resolveExtends(ext: string, configPath: FilePath) {
  if (ext.startsWith('.')) {
    return path.resolve(path.dirname(configPath), ext);
  } else {
    let [resolved] = await localResolve(ext, configPath);
    return fs.realpath(resolved);
  }
}

function validateConfig(config: ParcelConfig, relativePath: FilePath) {
  validateExtends(config.extends, relativePath);
  validatePipeline(config.resolvers, 'resolver', 'resolvers', relativePath);
  validateMap(
    config.transforms,
    validatePipeline.bind(this),
    'transformer',
    'transforms',
    relativePath
  );
  validatePackageName(config.bundler, 'bundler', 'bundler', relativePath);
  validatePipeline(config.namers, 'namer', 'namers', relativePath);
  validateMap(
    config.runtimes,
    validatePipeline.bind(this),
    'runtime',
    'runtimes',
    relativePath
  );
  validateMap(
    config.packagers,
    validatePackageName.bind(this),
    'packager',
    'packagers',
    relativePath
  );
  validateMap(
    config.optimizers,
    validatePipeline.bind(this),
    'optimizer',
    'optimizers',
    relativePath
  );
  validatePipeline(config.reporters, 'reporter', 'reporters', relativePath);
}

function validateExtends(
  exts: string | Array<string> | void,
  relativePath: FilePath
) {
  if (Array.isArray(exts)) {
    for (let ext of exts) {
      assert(
        typeof ext === 'string',
        `"extends" elements must be strings in ${relativePath}`
      );
      validateExtendsConfig(ext, relativePath);
    }
  } else if (exts) {
    assert(
      typeof exts === 'string',
      `"extends" must be a string or array of strings in ${relativePath}`
    );
    validateExtendsConfig(exts, relativePath);
  }
}

function validateExtendsConfig(ext: string, relativePath: FilePath) {
  if (!ext.startsWith('.')) {
    validatePackageName(ext, 'config', 'extends', relativePath);
  }
}

function validatePipeline(
  pipeline: ?Pipeline,
  pluginType: string,
  key: string,
  relativePath: FilePath
) {
  if (!pipeline) {
    return;
  }

  assert(
    Array.isArray(pipeline),
    `"${key}" must be an array in ${relativePath}`
  );
  assert(
    pipeline.every(pkg => typeof pkg === 'string'),
    `"${key}" elements must be strings in ${relativePath}`
  );
  for (let pkg of pipeline) {
    if (pkg !== '...') {
      validatePackageName(pkg, pluginType, key, relativePath);
    }
  }
}

function validateMap<K, V>(
  globMap: ?ConfigMap<K, V>,
  validator: (v: V, p: string, k: string, p: FilePath) => void,
  pluginType: string,
  configKey: string,
  relativePath: FilePath
) {
  if (!globMap) {
    return;
  }

  assert(
    typeof globMap === 'object',
    `"${configKey}" must be an object in ${relativePath}`
  );
  for (let k in globMap) {
    // Flow doesn't correctly infer the type. See https://github.com/facebook/flow/issues/1736.
    let key: K = (k: any);
    validator(globMap[key], pluginType, `${configKey}["${k}"]`, relativePath);
  }
}

function validatePackageName(
  pkg: ?PackageName,
  pluginType: string,
  key: string,
  relativePath: FilePath
) {
  if (!pkg) {
    return;
  }

  assert(
    typeof pkg === 'string',
    `"${key}" must be a string in ${relativePath}`
  );

  if (pkg.startsWith('@parcel')) {
    assert(
      pkg.replace(/^@parcel\//, '').startsWith(`${pluginType}-`),
      `Official parcel ${pluginType} packages must be named according to "@parcel/${pluginType}-{name}" but got "${pkg}" in ${relativePath}.`
    );
  } else if (pkg.startsWith('@')) {
    let [scope, name] = pkg.split('/');
    assert(
      name.startsWith(`parcel-${pluginType}-`),
      `Scoped parcel ${pluginType} packages must be named according to "${scope}/parcel-${pluginType}-{name}" but got "${pkg}" in ${relativePath}.`
    );
  } else {
    assert(
      pkg.startsWith(`parcel-${pluginType}-`),
      `Parcel ${pluginType} packages must be named according to "parcel-${pluginType}-{name}" but got "${pkg}" in ${relativePath}.`
    );
  }
}

function mergeConfigs(base: ParcelConfig, ext: ParcelConfig): ParcelConfig {
  return {
    filePath: base.filePath, // TODO: revisit this - it should resolve plugins based on the actual config they are defined in
    resolvers: mergePipelines(base.resolvers, ext.resolvers),
    transforms: mergeMaps(base.transforms, ext.transforms, mergePipelines),
    bundler: ext.bundler || base.bundler,
    namers: mergePipelines(base.namers, ext.namers),
    runtimes: mergeMaps(base.runtimes, ext.runtimes),
    packagers: mergeMaps(base.packagers, ext.packagers),
    optimizers: mergeMaps(base.optimizers, ext.optimizers, mergePipelines),
    reporters: mergePipelines(base.reporters, ext.reporters)
  };
}

function mergePipelines(base: ?Pipeline, ext: ?Pipeline): Pipeline {
  if (!ext) {
    return base || [];
  }

  if (base) {
    // Merge the base pipeline if a rest element is defined
    let spreadIndex = ext.indexOf('...');
    if (spreadIndex >= 0) {
      if (ext.filter(v => v === '...').length > 1) {
        throw new Error(
          'Only one spread element can be included in a config pipeline'
        );
      }

      ext = [
        ...ext.slice(0, spreadIndex),
        ...(base || []),
        ...ext.slice(spreadIndex + 1)
      ];
    }
  }

  return ext;
}

function mergeMaps<K, V>(
  base: ?ConfigMap<K, V>,
  ext: ?ConfigMap<K, V>,
  merger?: (a: V, b: V) => V
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
