// @flow

import type {FilePath, MutableAsset} from '@parcel/types';

import {md5FromString} from '@parcel/utils';
import {Transformer} from '@parcel/plugin';
import * as fs from '@parcel/fs';
import FileSystemLoader from 'css-modules-loader-core/lib/file-system-loader';
import localRequire from '@parcel/local-require';
import nullthrows from 'nullthrows';
import path from 'path';
import postcss from 'postcss';
import semver from 'semver';
import valueParser from 'postcss-value-parser';

import loadPlugins from './loadPlugins';

const COMPOSES_RE = /composes:.+from\s*("|').*("|')\s*;?/;
const FROM_IMPORT_RE = /.+from\s*(?:"|')(.*)(?:"|')\s*;?/;
const MODULE_BY_NAME_RE = /\.module\./;

type ParcelPostCSSConfig = {
  plugins: Array<mixed>,
  from: FilePath,
  to: FilePath
};

export default new Transformer({
  async getConfig({asset, resolve}): Promise<?ParcelPostCSSConfig> {
    let configFile: mixed = await asset.getConfig(
      ['.postcssrc', '.postcssrc.json', '.postcssrc.js', 'postcss.config.js'],
      {packageKey: 'postcss'}
    );

    // Use a basic, modules-only PostCSS config if the file opts in by a name
    // like foo.module.css
    if (configFile == null && asset.filePath.match(MODULE_BY_NAME_RE)) {
      configFile = {
        plugins: {
          'postcss-modules': {}
        }
      };
    }

    if (configFile == null) {
      return;
    }

    if (typeof configFile !== 'object') {
      throw new Error('PostCSS config should be an object.');
    }

    if (
      configFile.plugins == null ||
      typeof configFile.plugins !== 'object' ||
      Object.keys(configFile.plugins) === 0
    ) {
      throw new Error('PostCSS config must have plugins');
    }

    let originalModulesConfig;
    let configFilePlugins = configFile.plugins;
    if (
      configFilePlugins != null &&
      typeof configFilePlugins === 'object' &&
      configFilePlugins['postcss-modules'] != null
    ) {
      originalModulesConfig = configFilePlugins['postcss-modules'];
      delete configFilePlugins['postcss-modules'];
    }

    let plugins = await loadPlugins(configFilePlugins, asset.filePath);

    if (originalModulesConfig) {
      let postcssModules = await localRequire(
        'postcss-modules',
        asset.filePath
      );

      plugins.push(
        postcssModules({
          getJSON: (filename, json) => (asset.meta.cssModules = json),
          Loader: createLoader(asset, resolve),
          generateScopedName: (name, filename) =>
            `_${name}_${md5FromString(filename).substr(0, 5)}`,
          ...originalModulesConfig
        })
      );
    }

    return {
      plugins,
      from: asset.filePath,
      to: asset.filePath
    };
  },

  canReuseAST({ast}) {
    return ast.type === 'postcss' && semver.satisfies(ast.version, '^7.0.0');
  },

  async parse({asset}) {
    return {
      type: 'postcss',
      version: '7.0.0',
      program: postcss.parse(await asset.getCode(), {
        from: asset.filePath
      })
    };
  },

  async transform({
    asset,
    config
  }: {
    asset: MutableAsset,
    config: ?ParcelPostCSSConfig
  }) {
    if (!config) {
      return [asset];
    }

    let ast = nullthrows(asset.ast);
    if (COMPOSES_RE.test(await asset.getCode())) {
      ast.program.walkDecls(decl => {
        let [, importPath] = FROM_IMPORT_RE.exec(decl.value) || [];
        if (decl.prop === 'composes' && importPath != null) {
          let parsed = valueParser(decl.value);

          parsed.walk(node => {
            if (node.type === 'string') {
              asset.addDependency({
                moduleSpecifier: importPath,
                loc: decl.source.start
              });
            }
          });
        }
      });
    }

    let {root} = await postcss(config.plugins).process(ast.program, config);
    ast.program = root;

    let assets = [asset];
    if (asset.meta.cssModules) {
      assets.push({
        type: 'js',
        filePath: asset.filePath + '.js',
        code:
          'module.exports = ' +
          JSON.stringify(asset.meta.cssModules, null, 2) +
          ';'
      });
    }
    return assets;
  },

  generate({asset}) {
    let ast = nullthrows(asset.ast);

    let code = '';
    postcss.stringify(ast.program, c => (code += c));

    return {
      code
    };
  }
});

function createLoader(
  asset: MutableAsset,
  resolve: (from: FilePath, to: string) => Promise<FilePath>
) {
  return class ParcelFileSystemLoader extends FileSystemLoader {
    async fetch(composesPath, relativeTo) {
      let importPath = composesPath.replace(/^["']|["']$/g, '');
      let resolved = await resolve(relativeTo, importPath);
      let rootRelativePath = path.resolve(path.dirname(relativeTo), resolved);
      let root = path.resolve('/');
      // fixes an issue on windows which is part of the css-modules-loader-core
      // see https://github.com/css-modules/css-modules-loader-core/issues/230
      if (rootRelativePath.startsWith(root)) {
        rootRelativePath = rootRelativePath.substr(root.length);
      }

      let source = await fs.readFile(resolved, 'utf-8');
      let {exportTokens} = await this.core.load(
        source,
        rootRelativePath,
        undefined,
        this.fetch.bind(this)
      );
      return exportTokens;
    }

    get finalSource() {
      return '';
    }
  };
}
