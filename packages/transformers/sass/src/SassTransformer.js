// @flow
import {Transformer} from '@parcel/plugin';
import {promisify} from '@parcel/utils';
import path from 'path';
import {EOL} from 'os';
import SourceMap from '@parcel/source-map';

// E.g: ~library/file.sass
const WEBPACK_ALIAS_RE = /^~[^/]/;

export default (new Transformer({
  async loadConfig({config, options}) {
    let configFile = await config.getConfig(['.sassrc', '.sassrc.js'], {
      packageKey: 'sass',
    });

    let configResult = {
      contents: configFile ? configFile.contents : {},
      isSerialisable: true,
    };

    if (configFile && path.extname(configFile.filePath) === '.js') {
      config.shouldInvalidateOnStartup();
      config.shouldReload();

      configResult.isSerialisable = false;
    }

    if (configResult.contents.importer === undefined) {
      configResult.contents.importer = [];
    } else if (!Array.isArray(configResult.contents.importer)) {
      configResult.contents.importer = [configResult.contents.importer];
    }

    // Always emit sourcemap
    configResult.contents.sourceMap = true;
    // sources are created relative to the directory of outFile
    configResult.contents.outFile = path.join(
      options.projectRoot,
      'style.css.map',
    );
    configResult.contents.omitSourceMapUrl = true;
    configResult.contents.sourceMapContents = false;

    config.setResult(configResult);
  },

  preSerializeConfig({config}) {
    if (!config.result) return;

    // Ensure we dont try to serialise functions
    if (!config.result.isSerialisable) {
      config.result.contents = {};
    }
  },

  async transform({asset, options, config, resolve}) {
    let rawConfig = config ? config.contents : {};
    let sass = await options.packageManager.require('sass', asset.filePath, {
      shouldAutoInstall: options.shouldAutoInstall,
    });

    const sassRender = promisify(sass.render.bind(sass));
    let css;
    try {
      let code = await asset.getCode();
      let result = await sassRender({
        ...rawConfig,
        file: asset.filePath,
        data: rawConfig.data ? rawConfig.data + EOL + code : code,
        importer: [...rawConfig.importer, resolvePathImporter({resolve})],
        indentedSyntax:
          typeof rawConfig.indentedSyntax === 'boolean'
            ? rawConfig.indentedSyntax
            : asset.type === 'sass',
      });

      css = result.css;
      for (let included of result.stats.includedFiles) {
        if (included !== asset.filePath) {
          asset.addIncludedFile(included);
        }
      }

      if (result.map != null) {
        let map = new SourceMap(options.projectRoot);
        map.addRawMappings(JSON.parse(result.map));
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
}): Transformer);

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
