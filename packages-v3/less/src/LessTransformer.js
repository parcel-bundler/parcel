// @flow
import {typeof default as Less} from 'less';
import path from 'path';
import {Transformer} from '@parcel/plugin';
import less from 'less';
import fs from 'fs';

// E.g: ~library/file.less
const WEBPACK_ALIAS_RE = /^~[^/]/;

type LessConfig = {
  sourceMap: any,
  filename: string,
  plugins: Array<any>,
  ...
};

export default (new Transformer({
  async transform({asset, options, config, resolve}) {
    asset.type = 'css';

    let code = await asset.getCode();
    let result;
    try {
      let lessConfig: LessConfig = {};

      if (config?.paths) {
        lessConfig.paths = config?.paths.map(p => path.join(options.projectRoot, p));
      }

      if (asset.env.sourceMap) {
        lessConfig.sourceMap = {};
      }

      lessConfig.filename = asset.filePath;
      lessConfig.relativeUrls = true;
      console.log(lessConfig);
      lessConfig.plugins = [
        // ...(lessConfig.plugins || []),
        // urlPlugin({asset}),
        resolvePathPlugin({asset, resolve}),
      ];

      result = await less.render(code, lessConfig);
    } catch (err) {
      // For the error reporter
      err.fileName = err.filename;
      err.loc = {
        line: err.line,
        column: err.column,
      };
      throw err;
    }
    asset.setCode(result.css, result.map);

    return [asset];
  },
}): Transformer);

function urlPlugin({asset}) {
  return {
    install(less: Less, pluginManager) {
      // This is a hack; no such interface exists, even conceptually, in Less.
      type LessNodeWithValue = less.tree.Node & {value: any, ...};

      const visitor = new less.visitors.Visitor({
        visitUrl(node) {
          const valueNode = ((node.value: any): LessNodeWithValue);
          const stringValue = (valueNode.value: string);
          if (
            !stringValue.startsWith('#') // IE's `behavior: url(#default#VML)`)
          ) {
            valueNode.value = asset.addURLDependency(stringValue, {});
          }
          return node;
        },
      });

      // $FlowFixMe[method-unbinding]
      visitor.run = visitor.visit;
      pluginManager.addVisitor(visitor);
    },
  };
}

function resolvePathPlugin({asset, resolve}) {
  return {
    install(less, pluginManager) {
      class LessFileManager extends less.FileManager {
        supports() {
          return true;
        }

        supportsSync() {
          return false;
        }

        async loadFile(rawFilename, currentDirectory, options) {
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
          let filePath;
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
