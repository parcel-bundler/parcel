// @flow
import type {PluginLogger} from '@parcel/logger';

import {Transformer} from '@parcel/plugin';
import {promisify, resolve} from '@parcel/utils';
import {dirname} from 'path';
import {NodeFS} from '@parcel/fs';

// E.g: ~library/file.sass
const WEBPACK_ALIAS_RE = /^~[^/]/;
const fs = new NodeFS();

let didWarnAboutNodeSass = false;

async function warnAboutNodeSassBeingUnsupported(
  filePath,
  logger: PluginLogger
) {
  if (!didWarnAboutNodeSass) {
    try {
      // TODO: replace this with the actual filesystem later
      await resolve(fs, 'node-sass', {basedir: dirname(filePath)});
      logger.warn({
        origin: '@parcel/transformer-sass',
        message:
          '`node-sass` is unsupported in Parcel 2, it will use Dart Sass a.k.a. `sass`'
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
  async getConfig({asset, resolve}) {
    let config = await asset.getConfig(['.sassrc', '.sassrc.js'], {
      packageKey: 'sass'
    });

    if (config === null) {
      config = {};
    }

    if (asset.isInline) {
      config.data = await asset.getCode();
    } else {
      config.file = asset.filePath;
    }

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

    return config;
  },

  async transform({asset, options, config, logger}) {
    await warnAboutNodeSassBeingUnsupported(asset.filePath, logger);
    let sass = await options.packageManager.require('sass', asset.filePath);
    const sassRender = promisify(sass.render.bind(sass));

    let css;
    try {
      css = (await sassRender(config)).css;
    } catch (err) {
      // Adapt the Error object for the reporter.
      err.fileName = err.file;
      err.loc = {
        line: err.line,
        column: err.column
      };

      throw err;
    }

    asset.type = 'css';
    asset.setCode(css);
    return [asset];
  }
});

function resolvePathImporter({resolve}) {
  return function(rawUrl, prev, done) {
    let url = rawUrl.replace(/^file:\/\//, '');

    if (WEBPACK_ALIAS_RE.test(url)) {
      const correctPath = url.replace(/^~/, '');
      const error = new Error(
        `The @import path "${url}" is using webpack specific syntax, which isn't supported by Parcel.\n\nTo @import files from node_modules, use "${correctPath}"`
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
