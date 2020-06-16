// @flow

import {Transformer} from '@parcel/plugin';
import {isGlob, glob} from '@parcel/utils';
import path from 'path';

const URL_RE = /^(?:url\s*\(\s*)?['"]?(?:[#/]|(?:https?:)?\/\/)/i;

export default new Transformer({
  async loadConfig({config}) {
    let configFile = await config.getConfig(['.stylusrc', '.stylusrc.js'], {
      packageKey: 'stylus',
    });

    if (configFile) {
      let isJavascript = path.extname(configFile.filePath) === '.js';
      if (isJavascript) {
        config.shouldInvalidateOnStartup();
        config.shouldReload();
      }

      config.setResult({
        contents: configFile.contents,
        isSerialisable: !isJavascript,
      });
    }
  },

  preSerializeConfig({config}) {
    if (!config.result) return;

    // Ensure we dont try to serialise functions
    if (!config.result.isSerialisable) {
      config.result.contents = {};
    }
  },

  async transform({asset, resolve, config, options}) {
    let stylusConfig = config ? config.contents : {};
    // stylus should be installed locally in the module that's being required
    let stylus = await options.packageManager.require(
      'stylus',
      asset.filePath,
      {autoinstall: options.autoinstall},
    );

    let code = await asset.getCode();
    let style = stylus(code, stylusConfig);
    style.set('filename', asset.filePath);
    style.set('include css', true);
    // Setup a handler for the URL function so we add dependencies for linked assets.
    style.define('url', node => {
      let filename = asset.addURLDependency(node.val, node.filename);
      return new stylus.nodes.Literal(`url(${JSON.stringify(filename)})`);
    });
    style.set(
      'Evaluator',
      await createEvaluator(code, asset, resolve, style.options, options),
    );

    asset.type = 'css';
    asset.setCode(style.render());
    asset.meta.hasDependencies = false;
    return [asset];
  },
});

async function getDependencies(
  code,
  filepath,
  asset,
  resolve,
  options,
  parcelOptions,
  seen = new Set(),
) {
  seen.add(filepath);
  const [Parser, DepsResolver, nodes, utils] = await Promise.all(
    ['parser', 'visitor/deps-resolver', 'nodes', 'utils'].map(dep =>
      parcelOptions.packageManager.require('stylus/lib/' + dep, filepath, {
        autoinstall: options.autoinstall,
      }),
    ),
  );

  nodes.filename = asset.filePath;

  let parser = new Parser(code, options);
  let ast = parser.parse();
  let deps = new Map();

  class ImportVisitor extends DepsResolver {
    visitImport(imported) {
      let importedPath = imported.path.first.string;

      if (!deps.has(importedPath)) {
        if (isGlob(importedPath)) {
          deps.set(
            importedPath,
            glob(
              path.resolve(path.dirname(filepath), importedPath),
              parcelOptions.inputFS,
              {
                onlyFiles: true,
              },
            ).then(entries =>
              Promise.all(
                entries.map(entry =>
                  resolve(
                    filepath,
                    './' + path.relative(path.dirname(filepath), entry),
                  ),
                ),
              ),
            ),
          );
        } else {
          deps.set(importedPath, resolve(filepath, importedPath));
        }
      }
    }
  }

  new ImportVisitor(ast, options).visit(ast);

  // Recursively process depdendencies, and return a map with all resolved paths.
  let res = new Map();
  await Promise.all(
    Array.from(deps.entries()).map(async ([importedPath, resolved]) => {
      try {
        resolved = await resolved;
      } catch (err) {
        resolved = null;
      }

      let found;
      if (resolved) {
        found = Array.isArray(resolved) ? resolved : [resolved];
        res.set(importedPath, resolved);
      } else {
        // If we couldn't resolve, try the normal stylus resolver.
        // We just need to do this to keep track of the dependencies - stylus does the real work.

        // support optional .styl
        let originalPath = importedPath;
        if (!/\.styl$/i.test(importedPath)) {
          importedPath += '.styl';
        }

        let paths = (options.paths || []).concat(path.dirname(filepath || '.'));
        found = utils.find(importedPath, paths, filepath);
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
          await asset.addIncludedFile({filePath: resolved});

          let code = await asset.fs.readFile(resolved, 'utf8');
          for (let [path, resolvedPath] of await getDependencies(
            code,
            resolved,
            asset,
            resolve,
            options,
            parcelOptions,
            seen,
          )) {
            res.set(path, resolvedPath);
          }
        }
      }
    }),
  );

  return res;
}

async function createEvaluator(code, asset, resolve, options, parcelOptions) {
  const deps = await getDependencies(
    code,
    asset.filePath,
    asset,
    resolve,
    options,
    parcelOptions,
  );
  const Evaluator = await parcelOptions.packageManager.require(
    'stylus/lib/visitor/evaluator',
    asset.filePath,
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
          if (!Array.isArray(resolved)) {
            node.string = resolved;
          } else {
            // If the import resolves to multiple files (i.e. glob),
            // replace it with a separate import node for each file
            return mergeBlocks(
              resolved.map(resolvedPath => {
                node.string = resolvedPath;
                return super.visitImport(imported.clone());
              }),
            );
          }
        }
      }

      // Done. Let stylus do its thing.
      return super.visitImport(imported);
    }
  }

  return CustomEvaluator;
}

/**
 * Puts the content of all given node blocks into the first one, essentially merging them.
 */
function mergeBlocks(blocks) {
  let finalBlock;
  for (const block of blocks) {
    if (finalBlock) {
      // $FlowFixMe - finalBlock is definitely defined
      block.nodes.forEach(node => finalBlock.push(node));
    } else {
      finalBlock = block;
    }
  }
  return finalBlock;
}
