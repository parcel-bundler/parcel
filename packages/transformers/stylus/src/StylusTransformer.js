// @flow

import {Transformer} from '@parcel/plugin';
import {createDependencyLocation, isGlob, glob, globSync} from '@parcel/utils';
import path from 'path';
import nativeFS from 'fs';
import stylus from 'stylus';
import Parser from 'stylus/lib/parser';
import DepsResolver from 'stylus/lib/visitor/deps-resolver';
import nodes from 'stylus/lib/nodes';
import utils from 'stylus/lib/utils';
import Evaluator from 'stylus/lib/visitor/evaluator';

const URL_RE = /^(?:url\s*\(\s*)?['"]?(?:[#/]|(?:https?:)?\/\/)/i;

export default (new Transformer({
  async loadConfig({config}) {
    let configFile = await config.getConfig(
      ['.stylusrc', '.stylusrc.js', '.stylusrc.cjs', '.stylusrc.mjs'],
      {
        packageKey: 'stylus',
      },
    );

    if (configFile) {
      // Resolve relative paths from config file
      if (configFile.contents.paths) {
        configFile.contents.paths = configFile.contents.paths.map(p =>
          path.resolve(path.dirname(configFile.filePath), p),
        );
      }

      return configFile.contents;
    }
  },

  async transform({asset, resolve, config, options}) {
    let stylusConfig = config ?? {};
    let code = await asset.getCode();
    let style = stylus(code, {...stylusConfig});
    style.set('filename', asset.filePath);
    style.set('include css', true);
    // Setup a handler for the URL function so we add dependencies for linked assets.
    style.define('url', (node: stylus.nodes.String | stylus.nodes.Literal) => {
      let filename = asset.addURLDependency(node.val, {
        loc: createDependencyLocation(
          {line: node.lineno, column: node.column},
          node.val,
        ),
      });
      return new stylus.nodes.Literal(`url(${JSON.stringify(filename)})`);
    });

    let {resolved: stylusPath} = await options.packageManager.resolve(
      'stylus',
      __filename,
    );
    let nativeGlob = await options.packageManager.require('glob', stylusPath);

    style.set(
      'Evaluator',
      await createEvaluator(
        code,
        asset,
        resolve,
        style.options,
        options,
        nativeGlob,
      ),
    );

    asset.type = 'css';
    asset.setCode(style.render());
    asset.meta.hasDependencies = false;
    return [asset];
  },
}): Transformer);

function attemptResolve(importedPath, filepath, asset, resolve, deps) {
  if (deps.has(importedPath)) {
    return;
  }

  if (isGlob(importedPath)) {
    // Invalidate when new files are created that match the glob pattern.
    let absoluteGlob = path.resolve(path.dirname(filepath), importedPath);
    asset.invalidateOnFileCreate({glob: absoluteGlob});

    deps.set(
      importedPath,
      glob(absoluteGlob, asset.fs, {
        onlyFiles: true,
      }).then(entries =>
        Promise.all(
          entries.map(entry =>
            resolve(
              filepath,
              './' + path.relative(path.dirname(filepath), entry),
              {
                packageConditions: ['stylus', 'style'],
              },
            ),
          ),
        ),
      ),
    );
  } else {
    deps.set(
      importedPath,
      resolve(filepath, importedPath, {
        packageConditions: ['stylus', 'style'],
      }),
    );
  }
}

async function getDependencies(
  code,
  filepath,
  asset,
  resolve,
  options,
  parcelOptions,
  nativeGlob,
  seen = new Set(),
  includeImports = true,
) {
  seen.add(filepath);

  nodes.filename = asset.filePath;

  let parser = new Parser(code, options);
  let ast = parser.parse();
  let deps = new Map();

  if (includeImports && options.imports) {
    for (let importedPath of options.imports) {
      attemptResolve(importedPath, filepath, asset, resolve, deps);
    }
  }

  class ImportVisitor extends DepsResolver {
    visitImport(imported) {
      let importedPath = imported.path.first.string;
      attemptResolve(importedPath, filepath, asset, resolve, deps);
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
      if (resolved && (!Array.isArray(resolved) || resolved.length > 0)) {
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

        // Patch the native FS so we use Parcel's FS, and track files that are
        // checked so we invalidate the cache when they are created.
        let restore = patchNativeFS(asset.fs, nativeGlob);

        let paths = [
          ...new Set(
            (options.paths || []).concat(path.dirname(filepath || '.')),
          ),
        ];
        found = utils.find(importedPath, paths, filepath);
        if (!found) {
          found = utils.lookupIndex(originalPath, paths, filepath);
        }

        for (let invalidation of restore()) {
          asset.invalidateOnFileCreate(invalidation);
        }

        if (!found) {
          throw new Error('failed to locate file ' + originalPath);
        }
      }

      // Recursively process resolved files as well to get nested deps
      for (let resolved of found) {
        if (!seen.has(resolved)) {
          asset.invalidateOnFileChange(resolved);

          let code = await asset.fs.readFile(resolved, 'utf8');
          for (let [path, resolvedPath] of await getDependencies(
            code,
            resolved,
            asset,
            resolve,
            options,
            parcelOptions,
            nativeGlob,
            seen,
            false,
          )) {
            res.set(path, resolvedPath);
          }
        }
      }
    }),
  );

  return res;
}

async function createEvaluator(
  code,
  asset,
  resolve,
  options,
  parcelOptions,
  nativeGlob,
) {
  const deps = await getDependencies(
    code,
    asset.filePath,
    asset,
    resolve,
    options,
    parcelOptions,
    nativeGlob,
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
                let restore = patchNativeFS(asset.fs, nativeGlob);
                let res = super.visitImport(imported.clone());
                restore();
                return res;
              }),
            );
          }
        }
      }

      // Patch the native FS so stylus uses Parcel's FS to read the file.
      let restore = patchNativeFS(asset.fs, nativeGlob);

      // Done. Let stylus do its thing.
      let res = super.visitImport(imported);

      restore();
      return res;
    }
  }

  return CustomEvaluator;
}

function patchNativeFS(fs, nativeGlob) {
  let invalidations = [];
  let readFileSync = nativeFS.readFileSync;
  let statSync = nativeFS.statSync;

  // $FlowFixMe
  nativeFS.readFileSync = (filename, encoding) => {
    return fs.readFileSync(filename, encoding);
  };

  // $FlowFixMe
  nativeFS.statSync = p => {
    try {
      return fs.statSync(p);
    } catch (err) {
      // Track files that were checked but don't exist so that we watch for their creation.
      if (!p.includes(`node_modules${path.sep}stylus`)) {
        invalidations.push({filePath: p});
      }
      throw err;
    }
  };

  // Patch the `glob` module as well so we use the Parcel FS and track invalidations.
  let glob = nativeGlob.sync;
  nativeGlob.sync = p => {
    let res = globSync(p, fs);
    if (!p.includes(`node_modules${path.sep}stylus`)) {
      // Sometimes stylus passes file paths with no glob parts to the `glob` module.
      // We want to avoid treating these as globs for performance.
      if (isGlob(p)) {
        invalidations.push({glob: p});
      } else if (res.length === 0) {
        invalidations.push({filePath: p});
      }
    }
    return res;
  };

  return () => {
    // $FlowFixMe
    nativeFS.readFileSync = readFileSync;
    // $FlowFixMe
    nativeFS.statSync = statSync;
    nativeGlob.sync = glob;
    return invalidations;
  };
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
