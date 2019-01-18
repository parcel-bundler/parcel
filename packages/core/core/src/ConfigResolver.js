// @flow
import type {FilePath, ParcelConfig, Glob, PackageName} from '@parcel/types';
import {resolveConfig} from '@parcel/utils/config';
import Config from './Config';
import fs from '@parcel/fs';
import {parse} from 'json5';
import path from 'path';
import localRequire from '@parcel/utils/localRequire';
import assert from 'assert';

type Pipeline = Array<PackageName>;
type GlobMap<T> = {[Glob]: T};

export default class ConfigResolver {
  async resolve(rootDir: FilePath): Promise<?Config> {
    let configPath = await resolveConfig(path.join(rootDir, 'index'), [
      '.parcelrc'
    ]);
    if (!configPath) {
      return null;
    }

    let config = await this.loadConfig(configPath, rootDir);
    console.log(config);
    return new Config(config, configPath);
  }

  async loadConfig(configPath: FilePath, rootDir: FilePath) {
    let config: ParcelConfig = parse(await fs.readFile(configPath));
    return await this.processConfig(config, configPath, rootDir);
  }

  async processConfig(
    config: ParcelConfig,
    configPath: FilePath,
    rootDir: FilePath
  ) {
    let relativePath = path.relative(process.cwd(), configPath);
    this.validateConfig(config, relativePath);

    if (config.extends) {
      let exts = Array.isArray(config.extends)
        ? config.extends
        : [config.extends];
      for (let ext of exts) {
        let resolved = await this.resolveExtends(ext, configPath);
        let baseConfig = await this.loadConfig(resolved, rootDir);
        config = this.mergeConfigs(baseConfig, config);
      }
    }

    return config;
  }

  async resolveExtends(ext: string, configPath: FilePath) {
    if (ext.startsWith('.')) {
      return path.resolve(configPath, ext);
    } else {
      let [resolved] = await localRequire.resolve(ext, configPath);
      return resolved;
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
    this.validateGlobMap(
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
    this.validateGlobMap(
      config.packagers,
      this.validatePackageName.bind(this),
      'packager',
      'packagers',
      relativePath
    );
    this.validateGlobMap(
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

  validateGlobMap<T>(
    globMap: ?GlobMap<T>,
    validator: (v: T, p: string, k: string, p: FilePath) => void,
    pluginType: string,
    key: string,
    relativePath: FilePath
  ) {
    if (!globMap) {
      return;
    }

    assert(
      typeof globMap === 'object',
      `"${key} must be an object in ${relativePath}`
    );
    for (let glob in globMap) {
      validator(globMap[glob], pluginType, `${key}["${glob}"]`, relativePath);
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
      resolvers: this.mergePipelines(base.resolvers, ext.resolvers),
      transforms: this.mergeGlobMap(
        base.transforms,
        ext.transforms,
        this.mergePipelines
      ),
      loaders: this.mergeGlobMap(base.loaders, ext.loaders),
      bundler: ext.bundler || base.bundler,
      namers: this.mergePipelines(base.namers, ext.namers),
      packagers: this.mergeGlobMap(base.packagers, ext.packagers),
      optimizers: this.mergeGlobMap(
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
      let restIndex = ext.indexOf('...');
      if (restIndex >= 0) {
        ext = [
          ...ext.slice(0, restIndex),
          ...(base || []),
          ...ext.slice(restIndex + 1)
        ];
        if (ext.includes('...')) {
          throw new Error(
            'Only one rest parameter can be included in a config pipeline'
          );
        }
      }
    }

    return ext;
  }

  mergeGlobMap<T>(
    base: ?GlobMap<T>,
    ext: ?GlobMap<T>,
    merger?: (a: T, b: T) => T
  ): GlobMap<T> {
    if (!ext) {
      return base || {};
    }

    if (!base) {
      return ext;
    }

    // Add the extension options first so they have higher precedence in the output glob map
    let res: GlobMap<T> = {};
    for (let glob in ext) {
      res[glob] =
        merger && base[glob] ? merger(base[glob], ext[glob]) : ext[glob];
    }

    // Add base options that aren't defined in the extension
    for (let glob in base) {
      if (!res[glob]) {
        res[glob] = base[glob];
      }
    }

    return res;
  }
}
