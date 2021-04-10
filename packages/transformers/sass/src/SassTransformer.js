// @flow
import {Transformer} from '@parcel/plugin';
import path from 'path';
import {EOL} from 'os';
import SourceMap from '@parcel/source-map';
import sass from 'sass';
import {pathToFileURL} from 'url';
import {promisify} from 'util';

// E.g: ~library/file.sass
const WEBPACK_ALIAS_RE = /^~[^/]/;

export default (new Transformer({
  async loadConfig({config, options}) {
    let configFile = await config.getConfig(['.sassrc', '.sassrc.js'], {
      packageKey: 'sass',
    });

    let configResult = configFile ? configFile.contents : {};

    // Resolve relative paths from config file
    if (configFile && configResult.includePaths) {
      configResult.includePaths = configResult.includePaths.map(p =>
        path.resolve(path.dirname(configFile.filePath), p),
      );
    }

    if (configFile && path.extname(configFile.filePath) === '.js') {
      config.shouldInvalidateOnStartup();
    }

    if (configResult.importer === undefined) {
      configResult.importer = [];
    } else if (!Array.isArray(configResult.importer)) {
      configResult.importer = [configResult.importer];
    }

    // Always emit sourcemap
    configResult.sourceMap = true;
    // sources are created relative to the directory of outFile
    configResult.outFile = path.join(options.projectRoot, 'style.css.map');
    configResult.omitSourceMapUrl = true;
    configResult.sourceMapContents = false;

    config.setResult(configResult);
  },

  async transform({asset, options, config, resolve}) {
    let rawConfig = config ?? {};
    let sassRender = promisify(sass.render.bind(sass));
    let css;
    try {
      let code = await asset.getCode();
      let result = await sassRender({
        ...rawConfig,
        file: asset.filePath,
        data: rawConfig.data ? rawConfig.data + EOL + code : code,
        importer: [
          ...rawConfig.importer,
          resolvePathImporter({
            asset,
            resolve,
            includePaths: rawConfig.includePaths,
            options,
          }),
        ],
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

function resolvePathImporter({asset, resolve, includePaths, options}) {
  // This is a reimplementation of the Sass resolution algorithm that uses Parcel's
  // FS and tracks all tried files so they are watched for creation.
  async function resolvePath(url, prev) {
    /*
      Imports are resolved by trying, in order:
        * Loading a file relative to the file in which the `@import` appeared.
        * Each custom importer.
        * Loading a file relative to the current working directory (This rule doesn't really make sense for Parcel).
        * Each load path in `includePaths`
        * Each load path specified in the `SASS_PATH` environment variable, which should be semicolon-separated on Windows and colon-separated elsewhere.

      See: https://sass-lang.com/documentation/js-api#importer
      See also: https://github.com/sass/dart-sass/blob/006e6aa62f2417b5267ad5cdb5ba050226fab511/lib/src/importer/node/implementation.dart
    */

    let paths = [path.dirname(prev)];
    if (includePaths) {
      paths.push(...includePaths);
    }

    asset.invalidateOnEnvChange('SASS_PATH');
    if (options.env.SASS_PATH) {
      paths.push(
        ...options.env.SASS_PATH.split(
          process.platform === 'win32' ? ';' : ':',
        ),
      );
    }

    let filePath;
    let contents;

    if (url[0] !== '~') {
      for (let p of paths) {
        filePath = path.resolve(p, url);
        try {
          contents = await asset.fs.readFile(filePath, 'utf8');
          break;
        } catch (err) {
          asset.invalidateOnFileCreate({filePath});
        }
      }
    }

    // If none of the default sass rules apply, try Parcel's resolver.
    if (!contents) {
      filePath = await resolve(prev, url);
      contents = await asset.fs.readFile(filePath, 'utf8');
    }

    if (filePath) {
      return {
        file: pathToFileURL(filePath).toString(),
        contents,
      };
    }
  }

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

    resolvePath(url, prev).then(done, done);
  };
}
