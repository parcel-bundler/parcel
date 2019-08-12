// @flow strict-local

import {Transformer} from '@parcel/plugin';
import localRequire from '@parcel/local-require';
import {promisify} from '@parcel/utils';

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

    if (url[0] === '/' || url[0] === '~') {
      resolve(prev, url)
        .then(resolvedPath => {
          done({file: resolvedPath});
        })
        .catch(err => {
          done(err);
        });
    } else {
      done(url);
    }
  };
}
