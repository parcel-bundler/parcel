// const CSSAsset = require('./CSSAsset');
const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const Resolver = require('../Resolver');
const fs = require('../utils/fs');
const {dirname} = require('path');

const URL_RE = /^(?:url\s*\(\s*)?['"]?(?:[#/]|(?:https?:)?\/\/)/i;

class StylusAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'css';
  }

  async parse(code) {
    // stylus should be installed locally in the module that's being required
    let stylus = await localRequire('stylus', this.name);
    let opts = await this.getConfig(['.stylusrc', '.stylusrc.js'], {
      packageKey: 'stylus'
    });
    let style = stylus(code, opts);
    style.set('filename', this.name);
    style.set('include css', true);
    // Setup a handler for the URL function so we add dependencies for linked assets.
    style.define('url', node => {
      let filename = this.addURLDependency(node.val, node.filename);
      return new stylus.nodes.Literal(`url(${JSON.stringify(filename)})`);
    });
    style.set('Evaluator', await createEvaluator(code, this, style.options));

    return style;
  }

  generate() {
    return [
      {
        type: 'css',
        value: this.ast.render(),
        hasDependencies: false
      }
    ];
  }

  generateErrorMessage(err) {
    let index = err.message.indexOf('\n');
    err.codeFrame = err.message.slice(index + 1);
    err.message = err.message.slice(0, index);
    return err;
  }
}

async function getDependencies(
  code,
  filepath,
  asset,
  options,
  seen = new Set()
) {
  seen.add(filepath);
  const [Parser, DepsResolver, nodes, utils] = await Promise.all(
    ['parser', 'visitor/deps-resolver', 'nodes', 'utils'].map(dep =>
      localRequire('stylus/lib/' + dep, filepath)
    )
  );

  nodes.filename = asset.name;

  let parser = new Parser(code, options);
  let ast = parser.parse();
  let deps = new Map();
  let resolver = new Resolver(
    Object.assign({}, asset.options, {
      extensions: ['.styl', '.css']
    })
  );

  class ImportVisitor extends DepsResolver {
    visitImport(imported) {
      let path = imported.path.first.string;

      if (!deps.has(path)) {
        deps.set(path, resolver.resolve(path, filepath));
      }
    }
  }

  new ImportVisitor(ast, options).visit(ast);

  // Recursively process depdendencies, and return a map with all resolved paths.
  let res = new Map();
  await Promise.all(
    Array.from(deps.entries()).map(async ([path, resolved]) => {
      try {
        resolved = (await resolved).path;
      } catch (err) {
        resolved = null;
      }

      let found;
      if (resolved) {
        found = [resolved];
        res.set(path, resolved);
      } else {
        // If we couldn't resolve, try the normal stylus resolver.
        // We just need to do this to keep track of the dependencies - stylus does the real work.

        // support optional .styl
        let originalPath = path;
        if (!/\.styl$/i.test(path)) {
          path += '.styl';
        }

        let paths = (options.paths || []).concat(dirname(filepath || '.'));
        found = utils.find(path, paths, filepath);
        if (!found) {
          found = utils.lookupIndex(originalPath, paths, filepath);
        }

        if (!found) {
          throw new Error('failed to locate file ' + originalPath);
        }
      }

      // Recursively process resolved files as well to get nested deps
      for (let resolved of found) {
        if (!seen.has(resolved)) {
          asset.addDependency(resolved, {includedInParent: true});

          let code = await fs.readFile(resolved, 'utf8');
          for (let [path, resolvedPath] of await getDependencies(
            code,
            resolved,
            asset,
            options,
            seen
          )) {
            res.set(path, resolvedPath);
          }
        }
      }
    })
  );

  return res;
}

async function createEvaluator(code, asset, options) {
  const deps = await getDependencies(code, asset.name, asset, options);
  const Evaluator = await localRequire(
    'stylus/lib/visitor/evaluator',
    asset.name
  );

  // This is a custom stylus evaluator that extends stylus with support for the node
  // require resolution algorithm. It also adds all dependencies to the parcel asset
  // tree so the file watcher works correctly, etc.
  class CustomEvaluator extends Evaluator {
    visitImport(imported) {
      let node = this.visit(imported.path).first;
      let path = node.string;
      if (node.name !== 'url' && path && !URL_RE.test(path)) {
        let resolved = deps.get(path);

        // First try resolving using the node require resolution algorithm.
        // This allows stylus files in node_modules to be resolved properly.
        // If we find something, update the AST so stylus gets the absolute path to load later.
        if (resolved) {
          node.string = resolved;
        }
      }

      // Done. Let stylus do its thing.
      return super.visitImport(imported);
    }
  }

  return CustomEvaluator;
}

module.exports = StylusAsset;
