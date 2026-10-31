import type {MutableAsset, ResolveFn} from '@parcel/plugin';
import {Transformer} from '@parcel/plugin';
import path from 'path';
import nativeFS from 'fs';
import stylus from 'stylus';
import Parser from 'stylus/lib/parser';
import DepsResolver from 'stylus/lib/visitor/deps-resolver';
import nodes from 'stylus/lib/nodes/index';
import * as utils from 'stylus/lib/utils';
import Evaluator from 'stylus/lib/visitor/evaluator';

const URL_RE = /^(?:url\s*\(\s*)?['"]?(?:[#/]|(?:https?:)?\/\/)/i;

type StylusConfig = stylus.RenderOptions & Record<string, unknown>;
type ResolvedPath = string | Array<string>;

export default new Transformer<StylusConfig | undefined>({
  async transform({asset, resolve, config, options}) {
    let stylusConfig = {...config};
    if (Array.isArray(stylusConfig.paths)) {
      stylusConfig.paths = stylusConfig.paths.map(p =>
        path.join(options.projectRoot, p),
      );
    }

    let code = asset.getCode();
    let style = stylus(code, stylusConfig);
    style.set('filename', asset.filePath);
    style.set('include css', true);
    // Rewrite relative url()s in imported files to be relative to the entry file,
    // so the CSS transformer resolves them correctly after compilation.
    style.define('url', stylus.resolver({}));
    style.set(
      'Evaluator',
      await createEvaluator(code, asset, resolve, style.options),
    );

    asset.type = 'css';
    asset.setCode(style.render());
  },
});

function attemptResolve(
  importedPath: string,
  filepath: string,
  resolve: ResolveFn,
  deps: Map<string, Promise<ResolvedPath>>,
) {
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
          .map(entry => resolveStylesheet(resolve, filepath, './' + entry)),
      ),
    );
  } else {
    let relative = path.isAbsolute(importedPath)
      ? './' + path.relative(path.dirname(filepath), importedPath)
      : importedPath;
    deps.set(importedPath, resolveStylesheet(resolve, filepath, relative));
  }
}

/** Resolves a stylesheet import to the path of a file, or rejects. */
async function resolveStylesheet(
  resolve: ResolveFn,
  from: string,
  specifier: string,
): Promise<string> {
  let resolved = await resolve(from, specifier, {
    importType: 'stylesheet',
    packageConditions: ['stylus', 'style'],
  });
  if (resolved?.filePath == null) {
    throw new Error(`Could not resolve '${specifier}' to a file`);
  }
  return resolved.filePath;
}

async function getDependencies(
  code: string,
  filepath: string,
  asset: MutableAsset,
  resolve: ResolveFn,
  options: stylus.RenderOptions,
  seen: Set<string> = new Set(),
  includeImports = true,
): Promise<Map<string, ResolvedPath>> {
  seen.add(filepath);

  nodes.filename = asset.filePath;

  let parser = new Parser(code, options);
  let ast = parser.parse();
  let deps = new Map<string, Promise<ResolvedPath>>();

  if (includeImports && options.imports) {
    for (let importedPath of options.imports) {
      attemptResolve(importedPath, filepath, resolve, deps);
    }
  }

  class ImportVisitor extends DepsResolver {
    visitImport(imported: any) {
      let importedPath = imported.path.first.string;
      attemptResolve(importedPath, filepath, resolve, deps);
    }
  }

  new ImportVisitor(ast, options).visit(ast);

  // Recursively process depdendencies, and return a map with all resolved paths.
  let res = new Map<string, ResolvedPath>();
  await Promise.all(
    Array.from(deps.entries()).map(async ([importedPath, promise]) => {
      let resolved;
      try {
        resolved = await promise;
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
  code: string,
  asset: MutableAsset,
  resolve: ResolveFn,
  options: stylus.RenderOptions,
) {
  const deps = await getDependencies(
    code,
    asset.filePath,
    asset,
    resolve,
    options,
  );

  // This is a custom stylus evaluator that extends stylus with support for the node
  // require resolution algorithm. It also adds all dependencies to the parcel asset
  // tree so the file watcher works correctly, etc.
  class CustomEvaluator extends Evaluator {
    visitImport(imported: any): any {
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
function mergeBlocks(blocks: Array<any>) {
  let finalBlock;
  for (const block of blocks) {
    if (finalBlock) {
      block.nodes.forEach((node: any) => finalBlock.push(node));
    } else {
      finalBlock = block;
    }
  }
  return finalBlock;
}
