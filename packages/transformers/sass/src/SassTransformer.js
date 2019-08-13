// @flow strict-local

import {Transformer} from '@parcel/plugin';
import localRequire from '@parcel/local-require';
import {promisify} from '@parcel/utils';

// E.g: ~library/file.sass
const WEBPACK_ALIAS_RE = /^~[^/]/;

export default new Transformer({
  async getConfig({asset, resolve}) {
    let config = await asset.getConfig(['.sassrc', '.sassrc.js'], {
      packageKey: 'sass'
    });

    if (config === null) {
      config = {};
    }

    config.file = asset.filePath;

    if (config.importer === undefined) {
      config.importer = [];
    } else if (!Array.isArray(config.importer)) {
      config.importer = [config.importer];
    }

    config.importer = [...config.importer, resolvePathImporter({resolve})];

    return config;
  },

  async transform({asset, config}) {
    let sass = await localRequire('sass', asset.filePath);
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
        done(null);
      });
  };
}
