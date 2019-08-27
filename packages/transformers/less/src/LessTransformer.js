// @flow strict-local

import {Transformer} from '@parcel/plugin';

// E.g: ~library/file.less
const WEBPACK_ALIAS_RE = /^~[^/]/;

export default new Transformer({
  async getConfig({asset, resolve}) {
    let config = await asset.getConfig(['.lessrc', '.lessrc.js'], {
      packageKey: 'less'
    });

    if (config === null) {
      config = {};
    }

    config.filename = asset.filePath;
    config.plugins = [
      ...(config.plugins || []),
      urlPlugin({asset}),
      resolvePathPlugin({asset, resolve})
    ];

    return config;
  },

  async transform({asset, options, config}) {
    const less = await options.packageManager.require('less', asset.filePath);
    const code = await asset.getCode();
    let css;
    try {
      css = (await less.render(code, config)).css;
    } catch (err) {
      // For the error reporter
      err.fileName = err.filename;
      err.loc = {
        line: err.line,
        column: err.column
      };
      throw err;
    }

    asset.type = 'css';
    asset.setCode(css);
    asset.meta.hasDependencies = false;
    return [asset];
  }
});

function urlPlugin({asset}) {
  return {
    install(less, pluginManager) {
      const visitor = new less.visitors.Visitor({
        visitUrl(node) {
          node.value.value = asset.addURLDependency(
            node.value.value,
            node.currentFileInfo.filename
          );
          return node;
        }
      });

      visitor.run = visitor.visit;
      pluginManager.addVisitor(visitor);
    }
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

        async loadFile(rawFilename, ...args) {
          let filename = rawFilename;

          if (WEBPACK_ALIAS_RE.test(filename)) {
            let correctPath = filename.replace(/^~/, '');
            throw new Error(
              `The @import path "${filename}" is using webpack specific syntax, which isn't supported by Parcel.\n\nTo @import files from node_modules, use "${correctPath}"`
            );
          }

          try {
            return await super.loadFile(filename, ...args);
          } catch (err) {
            if (err.type !== 'File') {
              throw err;
            }
            filename = await resolve(asset.filePath, filename);
            return super.loadFile(filename, ...args);
          }
        }
      }

      pluginManager.addFileManager(new LessFileManager());
    }
  };
}
