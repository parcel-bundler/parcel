// @flow strict-local

import {Transformer} from '@parcel/plugin';
import localRequire from '@parcel/local-require';

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

  async transform({asset, config}) {
    const less = await localRequire('less', asset.filePath);
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
          if (filename[0] == '/' || filename[0] == '~') {
            filename = await resolve(asset.filePath, filename);
          }
          return super.loadFile(filename, ...args);
        }
      }

      pluginManager.addFileManager(new LessFileManager());
    }
  };
}
