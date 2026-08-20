// @flow

import {Transformer} from '@parcel/plugin';
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
  async transform({asset, resolve, config, options}) {
    let stylusConfig = config ?? {};
    if (stylusConfig && Array.isArray(stylusConfig.paths)) {
      stylusConfig.paths = stylusConfig.paths.map(p =>
        path.join(options.projectRoot, p),
      );
    }

    let code = await asset.getCode();
    let style = stylus(code, {...stylusConfig});
    style.set('filename', asset.filePath);
    style.set('include css', true);
    // Setup a handler for the URL function so we add dependencies for linked assets.
    // style.define('url', (node: stylus.nodes.String | stylus.nodes.Literal) => {
    //   let filename = asset.addURLDependency(node.val, {
    //     loc: createDependencyLocation(
    //       {line: node.lineno, column: node.column},
    //       node.val,
    //     ),
    //   });
    //   return new stylus.nodes.Literal(`url(${JSON.stringify(filename)})`);
    // });

    style.set(
      'Evaluator',
      await createEvaluator(
        code,
        asset,
        resolve,
        style.options,
        options,
      ),
    );

    asset.type = 'css';
    asset.setCode(style.render());
    return [asset];
  },
}): Transformer);

function attemptResolve(importedPath, filepath, asset, resolve, deps) {
  if (deps.has(importedPath)) {
    return;
  }

  if (/[*[{]/.test(importedPath)) {
    // Invalidate when new files are created that match the glob pattern.
    // let absoluteGlob = path.resolve(path.dirname(filepath), importedPath);
    // asset.invalidateOnFileCreate({glob: absoluteGlob});

    let cwd = path.dirname(filepath);
    let entries = nativeFS.globSync(importedPath, {cwd});
    deps.set(
      importedPath,
        Promise.all(
          entries
            .filter(e => nativeFS.statSync(path.join(cwd, e)).isFile())
            .map(entry =>
              resolve(
                filepath,
                './' + entry,
                {
                  packageConditions: ['stylus', 'style'],
                },
              ),
            ),
        ),
    );
  } else {
    let relative = path.isAbsolute(importedPath) ? './' + path.relative(path.dirname(filepath), importedPath) : importedPath;
    deps.set(
      importedPath,
      resolve(filepath, relative, {
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
  // nativeGlob,
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

        let paths = [
          ...new Set(
            (options.paths || []).concat(path.dirname(filepath || '.')),
          ),
        ];
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
          let code = nativeFS.readFileSync(resolved, 'utf8');
          for (let [path, resolvedPath] of await getDependencies(
            code,
            resolved,
            asset,
            resolve,
            options,
            parcelOptions,
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
) {
  const deps = await getDependencies(
    code,
    asset.filePath,
    asset,
    resolve,
    options,
    parcelOptions,
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
