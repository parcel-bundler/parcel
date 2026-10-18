import type {MutableAsset, ResolveFn} from '@parcel/plugin';
import path from 'path';
import {Transformer} from '@parcel/plugin';
import less from 'less';
import fs from 'fs';

// E.g: ~library/file.less
const WEBPACK_ALIAS_RE = /^~[^/]/;

type LessConfig = {
  paths?: Array<string>;
};

// Methods of less's FileManager that are missing from @types/less.
declare global {
  namespace Less {
    interface AbstractFileManager {
      extractUrlParts(url: string): {rawPath: string; filename: string};
      tryAppendExtension(path: string, ext: string): string;
    }
  }
}

export default new Transformer<LessConfig | undefined>({
  async transform({asset, options, config, resolve}) {
    asset.type = 'css';

    let code = asset.getCode();
    let result;
    try {
      let lessConfig: Less.Options & {relativeUrls?: boolean} = {};

      if (config?.paths) {
        lessConfig.paths = config.paths.map(p =>
          path.join(options.projectRoot, p),
        );
      }

      if (asset.target.sourceMap) {
        lessConfig.sourceMap = {};
      }

      lessConfig.filename = asset.filePath;
      lessConfig.relativeUrls = true;
      lessConfig.plugins = [resolvePathPlugin({asset, resolve})];

      result = await less.render(code, lessConfig);
    } catch (err: any) {
      // For the error reporter
      err.fileName = err.filename;
      err.loc = {
        line: err.line,
        column: err.column,
      };
      throw err;
    }
    asset.setCode(result.css, result.map ? JSON.parse(result.map) : null);
  },
});

function resolvePathPlugin({
  asset,
  resolve,
}: {
  asset: MutableAsset;
  resolve: ResolveFn;
}): Less.Plugin {
  return {
    install(less, pluginManager) {
      class LessFileManager extends less.FileManager {
        supports() {
          return true;
        }

        supportsSync() {
          return false;
        }

        async loadFile(
          rawFilename: string,
          currentDirectory: string,
          options: Less.LoadFileOptions,
        ) {
          let filename = rawFilename;

          if (WEBPACK_ALIAS_RE.test(filename)) {
            let correctPath = filename.replace(/^~/, '');
            throw new Error(
              `The @import path "${filename}" is using webpack specific syntax, which isn't supported by Parcel.\n\nTo @import files from node_modules, use "${correctPath}"`,
            );
          }

          // Based on https://github.com/less/less.js/blob/master/packages/less/src/less-node/file-manager.js
          let isAbsoluteFilename = this.isPathAbsolute(filename);
          let paths = isAbsoluteFilename ? [''] : [currentDirectory];
          if (options.paths) {
            paths.push(...options.paths);
          }

          let prefixes = options.prefixes || [''];
          let fileParts = this.extractUrlParts(filename);
          let filePath = filename;
          let contents;

          if (filename[0] !== '~') {
            outer: for (let p of paths) {
              for (let prefix of prefixes) {
                filePath = fileParts.rawPath + prefix + fileParts.filename;
                if (p) {
                  filePath = path.join(p, filePath);
                }

                if (options.ext) {
                  filePath = this.tryAppendExtension(filePath, options.ext);
                }

                try {
                  contents = fs.readFileSync(filePath, 'utf8');
                  break outer;
                } catch {}
              }
            }
          }

          if (!contents) {
            filePath = await resolve(asset.filePath, filename, {
              packageConditions: ['less', 'style'],
            });
            contents = fs.readFileSync(filePath, 'utf8');
          }

          return {
            contents,
            filename: filePath,
          };
        }
      }

      pluginManager.addFileManager(new LessFileManager());
    },
  };
}
