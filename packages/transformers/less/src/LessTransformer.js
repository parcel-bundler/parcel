// @flow strict-local
import path from 'path';
import {Transformer} from '@parcel/plugin';
import SourceMap from '@parcel/source-map';

// E.g: ~library/file.less
const WEBPACK_ALIAS_RE = /^~[^/]/;

export default new Transformer({
  async getConfig({asset, resolve, options}) {
    let config = await asset.getConfig(['.lessrc', '.lessrc.js'], {
      packageKey: 'less',
    });

    if (config === null) {
      config = {};
    }

    config.filename = asset.filePath;
    config.plugins = [
      ...(config.plugins || []),
      urlPlugin({asset}),
      resolvePathPlugin({asset, resolve}),
    ];
    config.rewriteUrls = 'all';

    if (options.sourceMaps) {
      config.sourceMap = {};
    }

    return config;
  },

  async transform({asset, options, config}) {
    asset.type = 'css';
    asset.meta.hasDependencies = false;

    let less = await options.packageManager.require('less', asset.filePath, {
      autoinstall: options.autoinstall,
    });

    let code = await asset.getCode();
    let result;
    try {
      result = await less.render(code, config);
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
      let map = new SourceMap();
      let {mappings, sources, names} = JSON.parse(result.map);
      map.addRawMappings(
        mappings,
        sources.map(s => path.relative(options.projectRoot, s)),
        names,
      );
      asset.setMap(map);
    }

    asset.setCode(result.css);

    return [asset];
  },
});

function urlPlugin({asset}) {
  return {
    install(less, pluginManager) {
      const visitor = new less.visitors.Visitor({
        visitUrl(node) {
          if (
            !node.value.value.startsWith('#') // IE's `behavior: url(#default#VML)`)
          ) {
            node.value.value = asset.addURLDependency(
              node.value.value,
              node.currentFileInfo.filename,
            );
          }
          return node;
        },
      });

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

        async loadFile(rawFilename, ...args) {
          let filename = rawFilename;

          if (WEBPACK_ALIAS_RE.test(filename)) {
            let correctPath = filename.replace(/^~/, '');
            throw new Error(
              `The @import path "${filename}" is using webpack specific syntax, which isn't supported by Parcel.\n\nTo @import files from node_modules, use "${correctPath}"`,
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
    },
  };
}
