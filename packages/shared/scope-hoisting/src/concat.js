// @flow

import type {Bundle, Asset, Symbol, BundleGraph} from '@parcel/types';
import type {CallExpression, Identifier, Statement} from '@babel/types';

import {parse as babelParse} from '@babel/parser';
import path from 'path';
import * as t from '@babel/types';
import {
  isArrayPattern,
  isClassDeclaration,
  isExpressionStatement,
  isFunctionDeclaration,
  isIdentifier,
  isObjectPattern,
  isVariableDeclaration,
  isStringLiteral,
} from '@babel/types';
import {simple as walkSimple} from '@parcel/babylon-walk';
import {getName, getIdentifier} from './utils';
import fs from 'fs';
import nullthrows from 'nullthrows';
import invariant from 'assert';
import {PromiseQueue} from '@parcel/utils';
import {assertString, needsPrelude} from './utils';

const HELPERS_PATH = path.join(__dirname, 'helpers.js');
const HELPERS = fs.readFileSync(path.join(__dirname, 'helpers.js'), 'utf8');

const PRELUDE_PATH = path.join(__dirname, 'prelude.js');
const PRELUDE = fs.readFileSync(path.join(__dirname, 'prelude.js'), 'utf8');

type AssetASTMap = Map<string, Array<Statement>>;
type TraversalContext = {|
  parent: ?AssetASTMap,
  children: AssetASTMap,
|};

// eslint-disable-next-line no-unused-vars
export async function concat(bundle: Bundle, bundleGraph: BundleGraph) {
  let queue = new PromiseQueue({maxConcurrent: 32});
  bundle.traverse((node, shouldWrap) => {
    switch (node.type) {
      case 'dependency':
        // Mark assets that should be wrapped, based on metadata in the incoming dependency tree
        if (shouldWrap || node.value.meta.shouldWrap) {
          let resolved = bundleGraph.getDependencyResolution(
            node.value,
            bundle,
          );
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

  let outputs = new Map<string, Array<Statement>>(await queue.run());
  let result = [...parse(HELPERS, HELPERS_PATH)];
  if (needsPrelude(bundle, bundleGraph)) {
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
        children: new Map(),
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
        if (isExpressionStatement(statement)) {
          for (let depAsset of findRequires(
            bundle,
            bundleGraph,
            asset,
            statement,
          )) {
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
    },
  });

  return t.file(t.program(result));
}

async function processAsset(bundle: Bundle, asset: Asset) {
  let code = await asset.getCode();
  let statements: Array<Statement> = parse(code, asset.filePath);

  if (statements[0]) {
    t.addComment(statements[0], 'leading', ` ASSET: ${asset.filePath}`, true);
  }

  if (asset.meta.shouldWrap) {
    statements = wrapModule(asset, statements);
  }

  return [asset.id, statements];
}

function parse(code, filename) {
  let ast = babelParse(code, {
    sourceFilename: filename,
    allowReturnOutsideFunction: true,
    plugins: ['dynamicImport'],
  });

  return ast.program.body;
}

function getUsedExports(
  bundle: Bundle,
  bundleGraph: BundleGraph,
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
      let resolvedAsset = bundleGraph.getDependencyResolution(dep, bundle);
      if (!resolvedAsset) {
        continue;
      }

      for (let [symbol, identifier] of dep.symbols) {
        if (identifier === '*') {
          continue;
        }

        if (symbol === '*') {
          for (let {asset, symbol} of bundleGraph.getExportedSymbols(
            resolvedAsset,
          )) {
            if (symbol) {
              markUsed(asset, symbol);
            }
          }
        }

        markUsed(resolvedAsset, symbol);
      }
    }

    // If the asset is referenced by another bundle, include all exports.
    if (bundleGraph.isAssetReferencedByAssetType(asset, 'js')) {
      markUsed(asset, '*');
      for (let {asset: a, symbol} of bundleGraph.getExportedSymbols(asset)) {
        if (symbol) {
          markUsed(a, symbol);
        }
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
  usedExports: Map<string, Set<Symbol>>,
) {
  return (
    asset.sideEffects === false &&
    !asset.meta.isCommonJS &&
    (!usedExports.has(asset.id) ||
      nullthrows(usedExports.get(asset.id)).size === 0)
  );
}

function findRequires(
  bundle: Bundle,
  bundleGraph: BundleGraph,
  asset: Asset,
  ast: mixed,
): Array<Asset> {
  let result = [];
  walkSimple(ast, {
    CallExpression(node: CallExpression) {
      let {arguments: args, callee} = node;
      if (!isIdentifier(callee)) {
        return;
      }

      if (callee.name === '$parcel$require') {
        let [, src] = args;
        invariant(isStringLiteral(src));
        let dep = bundleGraph
          .getDependencies(asset)
          .find(dep => dep.moduleSpecifier === src.value);
        if (!dep) {
          throw new Error(`Could not find dep for "${src.value}`);
        }
        // can be undefined if AssetGraph#resolveDependency optimized
        // ("deferred") this dependency away as an unused reexport
        let resolution = bundleGraph.getDependencyResolution(dep, bundle);
        if (resolution) {
          result.push(resolution);
        }
      }
    },
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
    if (isVariableDeclaration(node)) {
      for (let decl of node.declarations) {
        let {id, init} = decl;
        if (isObjectPattern(id) || isArrayPattern(id)) {
          // $FlowFixMe it is an identifier
          for (let prop: Identifier of Object.values(
            t.getBindingIdentifiers(id),
          )) {
            decls.push(t.variableDeclarator(prop));
          }
          if (init) {
            body.push(
              t.expressionStatement(t.assignmentExpression('=', id, init)),
            );
          }
        } else {
          invariant(isIdentifier(id));
          decls.push(t.variableDeclarator(id));
          let {init} = decl;
          if (init) {
            body.push(
              t.expressionStatement(
                t.assignmentExpression('=', t.identifier(id.name), init),
              ),
            );
          }
        }
      }
    } else if (isFunctionDeclaration(node)) {
      // Function declarations can be hoisted out of the module initialization function
      fns.push(node);
    } else if (isClassDeclaration(node)) {
      let {id} = node;
      invariant(isIdentifier(id));
      // Class declarations are not hoisted. We declare a variable outside the
      // function and convert to a class expression assignment.
      decls.push(t.variableDeclarator(t.identifier(id.name)));
      body.push(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.identifier(id.name),
            t.toExpression(node),
          ),
        ),
      );
    } else {
      body.push(node);
    }
  }

  let executed = getName(asset, 'executed');
  decls.push(
    t.variableDeclarator(t.identifier(executed), t.booleanLiteral(false)),
  );

  let execId = getIdentifier(asset, 'exec');
  let exec = t.functionDeclaration(execId, [], t.blockStatement(body));

  let init = t.functionDeclaration(
    getIdentifier(asset, 'init'),
    [],
    t.blockStatement([
      t.ifStatement(
        t.unaryExpression('!', t.identifier(executed)),
        t.blockStatement([
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.identifier(executed),
              t.booleanLiteral(true),
            ),
          ),
          t.expressionStatement(t.callExpression(execId, [])),
        ]),
      ),
      t.returnStatement(
        t.identifier(assertString(asset.meta.exportsIdentifier)),
      ),
    ]),
  );

  return ([
    t.variableDeclaration('var', decls),
    ...fns,
    exec,
    init,
  ]: Array<Statement>);
}
