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

export default class ConfigResolver {
  async resolve(filePath: FilePath): Promise<?Config> {
    let configPath = await resolveConfig(filePath, ['.parcelrc'], {
      noCache: true
    });
    if (!configPath) {
      return null;
    }

    let [config, extendedFiles] = await this.loadConfig(configPath);
    return new Config({...config, filePath: configPath});
  }

  async create(config: ParcelConfig) {
    let [result, extendedFiles] = await this.processConfig(config);
    return new Config({extendedFiles, ...result});
  }

  async loadConfig(configPath: FilePath) {
    let config: ParcelConfigFile = parse(await fs.readFile(configPath));
    return this.processConfig({...config, filePath: configPath});
  }

  async processConfig(config: ParcelConfig) {
    let relativePath = path.relative(process.cwd(), config.filePath);
    this.validateConfig(config, relativePath);

    let extendedFiles = [];

    if (config.extends) {
      let exts = Array.isArray(config.extends)
        ? config.extends
        : [config.extends];
      for (let ext of exts) {
        let resolved = await this.resolveExtends(ext, config.filePath);
        extendedFiles.push(resolved);
        let [baseConfig, moreExtendedFiles] = await this.loadConfig(resolved);
        extendedFiles = extendedFiles.concat(moreExtendedFiles);
        config = this.mergeConfigs(baseConfig, config);
      }
    }

    return [config, extendedFiles];
  }

  async resolveExtends(ext: string, configPath: FilePath) {
    if (ext.startsWith('.')) {
      return path.resolve(path.dirname(configPath), ext);
    } else {
      let [resolved] = await localResolve(ext, configPath);
      return fs.realpath(resolved);
    }
  }

  validateConfig(config: ParcelConfig, relativePath: FilePath) {
    this.validateExtends(config.extends, relativePath);
    this.validatePipeline(
      config.resolvers,
      'resolver',
      'resolvers',
      relativePath
    );
    this.validateMap(
      config.transforms,
      this.validatePipeline.bind(this),
      'transformer',
      'transforms',
      relativePath
    );
    this.validatePackageName(
      config.bundler,
      'bundler',
      'bundler',
      relativePath
    );
    this.validatePipeline(config.namers, 'namer', 'namers', relativePath);
    this.validateMap(
      config.runtimes,
      this.validatePipeline.bind(this),
      'runtime',
      'runtimes',
      relativePath
    );
    this.validateMap(
      config.packagers,
      this.validatePackageName.bind(this),
      'packager',
      'packagers',
      relativePath
    );
    this.validateMap(
      config.optimizers,
      this.validatePipeline.bind(this),
      'optimizer',
      'optimizers',
      relativePath
    );
    this.validatePipeline(
      config.reporters,
      'reporter',
      'reporters',
      relativePath
    );
  }

  validateExtends(exts: string | Array<string> | void, relativePath: FilePath) {
    if (Array.isArray(exts)) {
      for (let ext of exts) {
        assert(
          typeof ext === 'string',
          `"extends" elements must be strings in ${relativePath}`
        );
        this.validateExtendsConfig(ext, relativePath);
      }
    } else if (exts) {
      assert(
        typeof exts === 'string',
        `"extends" must be a string or array of strings in ${relativePath}`
      );
      this.validateExtendsConfig(exts, relativePath);
    }
  }

  validateExtendsConfig(ext: string, relativePath: FilePath) {
    if (!ext.startsWith('.')) {
      this.validatePackageName(ext, 'config', 'extends', relativePath);
    }
  }

  validatePipeline(
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
        this.validatePackageName(pkg, pluginType, key, relativePath);
      }
    }
  }

  validateMap<K, V>(
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

  validatePackageName(
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

  mergeConfigs(base: ParcelConfig, ext: ParcelConfig): ParcelConfig {
    return {
      filePath: base.filePath, // TODO: revisit this - it should resolve plugins based on the actual config they are defined in
      resolvers: this.mergePipelines(base.resolvers, ext.resolvers),
      transforms: this.mergeMaps(
        base.transforms,
        ext.transforms,
        this.mergePipelines
      ),
      bundler: ext.bundler || base.bundler,
      namers: this.mergePipelines(base.namers, ext.namers),
      runtimes: this.mergeMaps(base.runtimes, ext.runtimes),
      packagers: this.mergeMaps(base.packagers, ext.packagers),
      optimizers: this.mergeMaps(
        base.optimizers,
        ext.optimizers,
        this.mergePipelines
      ),
      reporters: this.mergePipelines(base.reporters, ext.reporters)
    };
  }

  mergePipelines(base: ?Pipeline, ext: ?Pipeline): Pipeline {
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

  mergeMaps<K, V>(
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
}
