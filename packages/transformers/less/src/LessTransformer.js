// @flow
import {typeof default as Less} from 'less';
import path from 'path';
import {Transformer} from '@parcel/plugin';
import SourceMap from '@parcel/source-map';
import less from 'less';

import {load} from './loadConfig';

// E.g: ~library/file.less
const WEBPACK_ALIAS_RE = /^~[^/]/;

type LessConfig = {
  sourceMap: any,
  filename: string,
  plugins: Array<any>,
  ...
};

export default (new Transformer({
  loadConfig({config}) {
    return load({config});
  },

  async transform({asset, options, config, resolve}) {
    asset.type = 'css';
    asset.meta.hasDependencies = false;

    let code = await asset.getCode();
    let result;
    try {
      let lessConfig: LessConfig = config ? {...config.config} : {};

      if (asset.env.sourceMap) {
        lessConfig.sourceMap = {};
      }

      lessConfig.filename = asset.filePath;
      lessConfig.plugins = [
        ...(lessConfig.plugins || []),
        urlPlugin({asset}),
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

    if (result.map != null) {
      let map = new SourceMap(options.projectRoot);
      let rawMap = JSON.parse(result.map);
      map.addVLQMap({
        ...rawMap,
        sources: rawMap.sources.map(s => path.relative(options.projectRoot, s)),
      });
      asset.setMap(map);
    }

    asset.setCode(result.css);

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
                  contents = await asset.fs.readFile(filePath, 'utf8');
                  break outer;
                } catch (err) {
                  asset.invalidateOnFileCreate({filePath});
                }
              }
            }
          }

          if (!contents) {
            filePath = await resolve(asset.filePath, filename);
            contents = await asset.fs.readFile(filePath, 'utf8');
          }

          if (filePath) {
            asset.invalidateOnFileChange(filePath);
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
