// @flow
import type {FilePath} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {PluginLogger} from '@parcel/logger';

import {Transformer} from '@parcel/plugin';
import {promisify, resolve} from '@parcel/utils';
import {dirname, join as joinPath} from 'path';
import {EOL} from 'os';
import SourceMap from '@parcel/source-map';

// E.g: ~library/file.sass
const WEBPACK_ALIAS_RE = /^~[^/]/;

let didWarnAboutNodeSass = false;
async function warnAboutNodeSassBeingUnsupported(
  fs: FileSystem,
  filePath: FilePath,
  logger: PluginLogger,
) {
  if (!didWarnAboutNodeSass) {
    try {
      await resolve(fs, 'node-sass', {basedir: dirname(filePath)});
      logger.warn({
        origin: '@parcel/transformer-sass',
        message:
          '`node-sass` is unsupported in Parcel 2, it will use Dart Sass a.k.a. `sass`',
      });
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') {
        throw err;
      }
    } finally {
      didWarnAboutNodeSass = true;
    }
  }
}

export default new Transformer({
  async getConfig({asset, resolve, options}) {
    let config = await asset.getConfig(['.sassrc', '.sassrc.js'], {
      packageKey: 'sass',
    });

    if (config === null) {
      config = {};
    }

    const code = await asset.getCode();
    config.data = config.data ? config.data + EOL + code : code;
    config.file = asset.filePath;

    if (config.importer === undefined) {
      config.importer = [];
    } else if (!Array.isArray(config.importer)) {
      config.importer = [config.importer];
    }

    config.importer = [...config.importer, resolvePathImporter({resolve})];

    config.indentedSyntax =
      typeof config.indentedSyntax === 'boolean'
        ? config.indentedSyntax
        : asset.type === 'sass';

    if (options.sourceMaps) {
      config.sourceMap = true;
      // sources are created relative to the directory of outFile
      config.outFile = joinPath(options.projectRoot, 'style.css.map');
      config.omitSourceMapUrl = true;
      config.sourceMapContents = false;
    }

    return config;
  },

  async transform({asset, options, config, logger}) {
    await warnAboutNodeSassBeingUnsupported(
      options.inputFS,
      asset.filePath,
      logger,
    );
    let sass = await options.packageManager.require('sass', asset.filePath, {
      autoinstall: options.autoinstall,
    });
    const sassRender = promisify(sass.render.bind(sass));

    let css;
    try {
      let result = await sassRender(config);

      css = result.css;
      for (let included of result.stats.includedFiles) {
        if (included !== asset.filePath) {
          asset.addIncludedFile({filePath: included});
        }
      }

      if (result.map != null) {
        let map = new SourceMap();
        let {mappings, sources, names} = JSON.parse(result.map);
        map.addRawMappings(mappings, sources, names);
        asset.setMap(map);
      }
    } catch (err) {
      // Adapt the Error object for the reporter.
      err.fileName = err.file;
      err.loc = {
        line: err.line,
        column: err.column,
      };

      throw err;
    }

    asset.type = 'css';
    asset.setCode(css);
    return [asset];
  },
});

function resolvePathImporter({resolve}) {
  return function(rawUrl, prev, done) {
    let url = rawUrl.replace(/^file:\/\//, '');

    if (WEBPACK_ALIAS_RE.test(url)) {
      const correctPath = url.replace(/^~/, '');
      const error = new Error(
        `The @import path "${url}" is using webpack specific syntax, which isn't supported by Parcel.\n\nTo @import files from node_modules, use "${correctPath}"`,
      );
      done(error);
      return;
    }

    resolve(prev, url)
      .then(resolvedPath => {
        done({file: resolvedPath});
      })
      .catch(() => {
        /*
         We return `null` instead of an error so that Sass' resolution algorithm can continue.

         Imports are resolved by trying, in order:
           * Loading a file relative to the file in which the `@import` appeared.
           * Each custom importer.
           * Loading a file relative to the current working directory.
           * Each load path in `includePaths`
           * Each load path specified in the `SASS_PATH` environment variable, which should be semicolon-separated on Windows and colon-separated elsewhere.

         See: https://sass-lang.com/documentation/js-api#importer
        */
        done(null);
      });
  };
}
