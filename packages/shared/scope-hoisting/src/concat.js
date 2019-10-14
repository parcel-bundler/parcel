// @flow

import type {Bundle, Asset, Symbol, BundleGraph} from '@parcel/types';
import * as babylon from '@babel/parser';
import path from 'path';
import * as t from '@babel/types';
import * as walk from 'babylon-walk';
import {getName, getIdentifier} from './utils';
import fs from 'fs';
import nullthrows from 'nullthrows';
import {PromiseQueue} from '@parcel/utils';

const HELPERS_PATH = path.join(__dirname, 'helpers.js');
const HELPERS = fs.readFileSync(path.join(__dirname, 'helpers.js'), 'utf8');

const PRELUDE_PATH = path.join(__dirname, 'prelude.js');
const PRELUDE = fs.readFileSync(path.join(__dirname, 'prelude.js'), 'utf8');

type AssetASTMap = Map<string, Object>;
type TraversalContext = {|
  parent: ?AssetASTMap,
  children: AssetASTMap
|};

// eslint-disable-next-line no-unused-vars
export async function concat(bundle: Bundle, bundleGraph: BundleGraph) {
  let queue = new PromiseQueue({maxConcurrent: 32});
  bundle.traverse((node, shouldWrap) => {
    switch (node.type) {
      case 'dependency':
        // Mark assets that should be wrapped, based on metadata in the incoming dependency tree
        if (shouldWrap || node.value.meta.shouldWrap) {
          let resolved = bundleGraph.getDependencyResolution(node.value);
          if (resolved) {
            resolved.meta.shouldWrap = true;
          }
          return true;
        }
        break;
      case 'asset':
        queue.add(() => processAsset(bundle, node.value));
    }
  });

  let outputs = new Map(await queue.run());
  let result = [...parse(HELPERS, HELPERS_PATH)];

  // If this is an entry bundle and it has non esmodule child bundles,
  // we need to add the prelude code, which allows registering modules dynamically at runtime.
  let isEntry = !bundleGraph.hasParentBundleOfType(bundle, 'js');
  let hasChildBundles = bundle.hasChildBundles();
  let needsPrelude =
    isEntry && hasChildBundles && bundle.env.outputFormat === 'global';
  if (needsPrelude) {
    result.unshift(...parse(PRELUDE, PRELUDE_PATH));
  }

  let usedExports = getUsedExports(bundle, bundleGraph);

  bundle.traverseAssets<TraversalContext>({
    enter(asset, context) {
      if (shouldExcludeAsset(asset, usedExports)) {
        return context;
      }

      return {
        parent: context && context.children,
        children: new Map()
      };
    },
    exit(asset, context) {
      if (!context || shouldExcludeAsset(asset, usedExports)) {
        return;
      }

      let statements = nullthrows(outputs.get(asset.id));
      let statementIndices: Map<string, number> = new Map();
      for (let i = 0; i < statements.length; i++) {
        let statement = statements[i];
        if (t.isExpressionStatement(statement)) {
          for (let depAsset of findRequires(bundleGraph, asset, statement)) {
            if (!statementIndices.has(depAsset.id)) {
              statementIndices.set(depAsset.id, i);
            }
          }
        }
      }

      for (let [assetId, ast] of [...context.children].reverse()) {
        let index = statementIndices.has(assetId)
          ? nullthrows(statementIndices.get(assetId))
          : 0;
        statements.splice(index, 0, ...ast);
      }

      // If this module is referenced by another JS bundle, or is an entry module in a child bundle,
      // add code to register the module with the module system.

      if (context.parent) {
        context.parent.set(asset.id, statements);
      } else {
        result.push(...statements);
      }
    }
  });

  return t.file(t.program(result));
}

async function processAsset(bundle: Bundle, asset: Asset) {
  let code = await asset.getCode();
  let statements = parse(code, asset.filePath);

  if (statements[0]) {
    addComment(statements[0], ` ASSET: ${asset.filePath}`);
  }

  if (asset.meta.shouldWrap) {
    statements = wrapModule(asset, statements);
  }

  return [asset.id, statements];
}

function parse(code, filename) {
  let ast = babylon.parse(code, {
    sourceFilename: filename,
    allowReturnOutsideFunction: true,
    plugins: ['dynamicImport']
  });

  return ast.program.body;
}

function addComment(statement, comment) {
  if (!statement.leadingComments) {
    statement.leadingComments = [];
  }
  statement.leadingComments.push({
    type: 'CommentLine',
    value: comment
  });
}

function getUsedExports(
  bundle: Bundle,
  bundleGraph: BundleGraph
): Map<string, Set<Symbol>> {
  let usedExports: Map<string, Set<Symbol>> = new Map();

  let entry = bundle.getMainEntry();
  if (entry) {
    for (let {asset, symbol} of bundleGraph.getExportedSymbols(entry)) {
      if (symbol) {
        markUsed(asset, symbol);
      }
    }
  }

  bundle.traverseAssets(asset => {
    for (let dep of bundleGraph.getDependencies(asset)) {
      let resolvedAsset = bundleGraph.getDependencyResolution(dep);
      if (!resolvedAsset) {
        continue;
      }

      for (let [symbol, identifier] of dep.symbols) {
        if (identifier === '*') {
          continue;
        }

        if (symbol === '*') {
          for (let symbol of resolvedAsset.symbols.keys()) {
            markUsed(resolvedAsset, symbol);
          }
        }

        markUsed(resolvedAsset, symbol);
      }
    }
  });

  function markUsed(asset, symbol) {
    let resolved = bundleGraph.resolveSymbol(asset, symbol);

    let used = usedExports.get(resolved.asset.id);
    if (!used) {
      used = new Set();
      usedExports.set(resolved.asset.id, used);
    }

    used.add(resolved.exportSymbol);
  }

  return usedExports;
}

function shouldExcludeAsset(
  asset: Asset,
  usedExports: Map<string, Set<Symbol>>
) {
  return (
    asset.sideEffects === false &&
    (!usedExports.has(asset.id) ||
      nullthrows(usedExports.get(asset.id)).size === 0)
  );
}

function findRequires(
  bundleGraph: BundleGraph,
  asset: Asset,
  ast: mixed
): Array<Asset> {
  let result = [];
  walk.simple(ast, {
    CallExpression(node) {
      let {arguments: args, callee} = node;
      if (!t.isIdentifier(callee)) {
        return;
      }

      if (callee.name === '$parcel$require') {
        let dep = bundleGraph
          .getDependencies(asset)
          .find(dep => dep.moduleSpecifier === args[1].value);
        if (!dep) {
          throw new Error(`Could not find dep for "${args[1].value}`);
        }
        // can be undefined if AssetGraph#resolveDependency optimized
        // ("deferred") this dependency away as an unused reexport
        let resolution = bundleGraph.getDependencyResolution(dep);
        if (resolution) {
          result.push(resolution);
        }
      }
    }
  });

  return result;
}

function wrapModule(asset: Asset, statements) {
  let body = [];
  let decls = [];
  let fns = [];
  for (let node of statements) {
    // Hoist all declarations out of the function wrapper
    // so that they can be referenced by other modules directly.
    if (t.isVariableDeclaration(node)) {
      for (let decl of node.declarations) {
        if (t.isObjectPattern(decl.id) || t.isArrayPattern(decl.id)) {
          for (let prop of Object.values(t.getBindingIdentifiers(decl.id))) {
            decls.push(t.variableDeclarator(prop));
          }
          if (decl.init) {
            body.push(
              t.expressionStatement(
                t.assignmentExpression('=', decl.id, decl.init)
              )
            );
          }
        } else {
          decls.push(t.variableDeclarator(decl.id));
          if (decl.init) {
            body.push(
              t.expressionStatement(
                t.assignmentExpression(
                  '=',
                  t.identifier(decl.id.name),
                  decl.init
                )
              )
            );
          }
        }
      }
    } else if (t.isFunctionDeclaration(node)) {
      // Function declarations can be hoisted out of the module initialization function
      fns.push(node);
    } else if (t.isClassDeclaration(node)) {
      // Class declarations are not hoisted. We declare a variable outside the
      // function and convert to a class expression assignment.
      decls.push(t.variableDeclarator(t.identifier(node.id.name)));
      body.push(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.identifier(node.id.name),
            t.toExpression(node)
          )
        )
      );
    } else {
      body.push(node);
    }
  }

  let executed = getName(asset, 'executed');
  decls.push(
    t.variableDeclarator(t.identifier(executed), t.booleanLiteral(false))
  );

  let init = t.functionDeclaration(
    getIdentifier(asset, 'init'),
    [],
    t.blockStatement([
      t.ifStatement(t.identifier(executed), t.returnStatement()),
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.identifier(executed),
          t.booleanLiteral(true)
        )
      ),
      ...body
    ])
  );

  return [t.variableDeclaration('var', decls), ...fns, init];
}
