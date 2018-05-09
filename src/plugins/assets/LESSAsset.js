const promisify = require('../../utils/promisify');
const Resolver = require('../../Resolver');
const syncPromise = require('../../utils/syncPromise');
const fs = require('../../utils/fs');
const path = require('path');

const LESSAsset = {
  type: 'css',

  async parse(code, state) {
    // less should be installed locally in the module that's being required
    let less = await state.require('less');
    let render = promisify(less.render.bind(less));

    let opts =
      (await state.getConfig(['.lessrc', '.lessrc.js'], {
        packageKey: 'less'
      })) || {};
    opts.filename = state.name;
    opts.plugins = (opts.plugins || []).concat(urlPlugin(state));

    return await render(code, opts);
  },

  collectDependencies(ast, state) {
    for (let dep of ast.imports) {
      state.addDependency(dep, {includedInParent: true});
    }
  },

  generate(ast) {
    return [
      {
        type: 'css',
        value: ast ? ast.css : '',
        hasDependencies: false
      }
    ];
  }
};

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
    async resolve(filename, currentDirectory) {
      return (await resolver.resolve(
        filename,
        path.join(currentDirectory, 'index')
      )).path;
    }

    async loadFile(filename, currentDirectory) {
      filename = await this.resolve(filename, currentDirectory);
      let contents = await fs.readFile(filename, 'utf8');
      return {contents, filename};
    }

    loadFileSync(filename, currentDirectory) {
      return syncPromise(this.loadFile(filename, currentDirectory));
    }
  }

  return LessFileManager;
}

module.exports = {
  Asset: {
    less: LESSAsset
  }
};
