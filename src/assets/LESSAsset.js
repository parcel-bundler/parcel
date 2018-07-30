const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const promisify = require('../utils/promisify');
const Resolver = require('../Resolver');
const fs = require('../utils/fs');
const path = require('path');
const parseCSSImport = require('../utils/parseCSSImport');

class LESSAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'css';
  }

  async parse(code) {
    // less should be installed locally in the module that's being required
    let less = await localRequire('less', this.name);
    let render = promisify(less.render.bind(less));

    let opts =
      (await this.getConfig(['.lessrc', '.lessrc.js'], {
        packageKey: 'less'
      })) || {};
    opts.filename = this.name;
    opts.plugins = (opts.plugins || []).concat(urlPlugin(this));

    return await render(code, opts);
  }

  collectDependencies() {
    for (let dep of this.ast.imports) {
      this.addDependency(dep, {
        includedInParent: true
      });
    }
  }

  generate() {
    return [
      {
        type: 'css',
        value: this.ast ? this.ast.css : '',
        hasDependencies: false
      }
    ];
  }
}

function urlPlugin(asset) {
  return {
    install: (less, pluginManager) => {
      let visitor = new less.visitors.Visitor({
        visitUrl: node => {
          node.value.value = asset.addURLDependency(
            node.value.value,
            node.currentFileInfo.filename
          );
          return node;
        }
      });

      visitor.run = visitor.visit;
      pluginManager.addVisitor(visitor);

      let LessFileManager = getFileManager(less, asset.options);
      pluginManager.addFileManager(new LessFileManager());
    }
  };
}

function getFileManager(less, options) {
  const resolver = new Resolver({
    extensions: ['.css', '.less'],
    rootDir: options.rootDir
  });

  class LessFileManager extends less.FileManager {
    supports() {
      return true;
    }

    supportsSync() {
      return false;
    }

    async loadFile(filename, currentDirectory, options) {
      let resolved = await this.findResolution(
        filename,
        currentDirectory,
        options
      );

      return {
        contents: await fs.readFile(resolved.path, 'utf8'),
        filename: resolved.path
      };
    }

    async findResolution(filename, currentDirectory, options) {
      const filenamesTried = [];
      let paths = path.isAbsolute(filename) ? [] : [currentDirectory];

      if (options.paths) {
        paths = paths.concat(options.paths);
      }

      if (!path.isAbsolute(filename) && !paths.includes('.') === -1) {
        paths.push('.');
      }

      // promise is guaranteed to be asyncronous
      // which helps as it allows the file handle
      // to be closed before it continues with the next file
      return new Promise(function(resolve, reject) {
        (async function tryPathIndex(i) {
          if (i < paths.length) {
            let fullFilename = resolver.resolveFilename(
              parseCSSImport(filename),
              paths[i]
            );
            try {
              const resolution = await resolver.resolve(fullFilename, paths[i]);
              if (resolution) {
                resolve(resolution);
              } else {
                throw new Error();
              }
            } catch (err) {
              filenamesTried.push(fullFilename);
              tryPathIndex(i + 1);
            }
          } else {
            reject({
              type: 'File',
              message:
                "'" +
                filename +
                "' wasn't found. Tried - " +
                filenamesTried.join(',')
            });
          }
        })(0);
      });
    }
  }

  return LessFileManager;
}

module.exports = LESSAsset;
