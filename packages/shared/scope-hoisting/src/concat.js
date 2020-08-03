// @flow

import type {
  Asset,
  BundleGraph,
  PluginOptions,
  NamedBundle,
  Symbol,
} from '@parcel/types';
import type {
  CallExpression,
  ClassDeclaration,
  Identifier,
  Node,
  Statement,
  VariableDeclaration,
} from '@babel/types';

import {parse as babelParse} from '@babel/parser';
import path from 'path';
import * as t from '@babel/types';
import {
  isArrayPattern,
  isExpressionStatement,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isIdentifier,
  isObjectPattern,
  isProgram,
  isStringLiteral,
  isVariableDeclaration,
} from '@babel/types';
import {simple as walkSimple, traverse} from '@parcel/babylon-walk';
import {PromiseQueue, relativeUrl} from '@parcel/utils';
import invariant from 'assert';
import fs from 'fs';
import nullthrows from 'nullthrows';
import {assertString, getName, getIdentifier} from './utils';

const HELPERS_PATH = path.join(__dirname, 'helpers.js');
const HELPERS = parse(
  fs.readFileSync(path.join(__dirname, 'helpers.js'), 'utf8'),
  HELPERS_PATH,
);

type AssetASTMap = Map<string, Array<Statement>>;
type TraversalContext = {|
  parent: ?AssetASTMap,
  children: AssetASTMap,
|};

// eslint-disable-next-line no-unused-vars
export async function concat({
  bundle,
  bundleGraph,
  options,
  wrappedAssets,
}: {|
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
  options: PluginOptions,
  wrappedAssets: Set<string>,
|}): Promise<BabelNodeFile> {
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
          if (resolved && resolved.sideEffects) {
            wrappedAssets.add(resolved.id);
          }
          return true;
        }
        break;
      case 'asset':
        queue.add(() =>
          processAsset(options, bundle, node.value, wrappedAssets),
        );
    }
  });

  let outputs = new Map<string, Array<Statement>>(await queue.run());
  let result = [...HELPERS];

  let usedExports = getUsedExports(bundle, bundleGraph);

  // Node: for each asset, the order of `$parcel$require` calls and the corresponding
  // `asset.getDependencies()` must be the same!
  bundle.traverseAssets<TraversalContext>({
    enter(asset, context) {
      if (shouldSkipAsset(bundleGraph, asset, usedExports)) {
        return context;
      }

      return {
        parent: context && context.children,
        children: new Map(),
      };
    },
    exit(asset, context) {
      if (!context || shouldSkipAsset(bundleGraph, asset, usedExports)) {
        return;
      }

      let statements = nullthrows(outputs.get(asset.id));
      let statementIndices: Map<string, number> = new Map();
      for (let i = 0; i < statements.length; i++) {
        let statement = statements[i];
        if (
          isVariableDeclaration(statement) ||
          isExpressionStatement(statement)
        ) {
          for (let {depAsset, hoist} of findRequires(
            bundle,
            bundleGraph,
            asset,
            statement,
          )) {
            if (!statementIndices.has(depAsset.id)) {
              statementIndices.set(depAsset.id, hoist ? 0 : i);
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

async function processAsset(
  options: PluginOptions,
  bundle: NamedBundle,
  asset: Asset,
  wrappedAssets: Set<string>,
) {
  let statements: Array<Statement>;
  if (asset.astGenerator && asset.astGenerator.type === 'babel') {
    let ast = await asset.getAST();
    statements = t.cloneNode(nullthrows(ast).program.program).body;
  } else {
    let code = await asset.getCode();
    statements = parse(code, relativeUrl(options.projectRoot, asset.filePath));
  }

  if (wrappedAssets.has(asset.id)) {
    statements = wrapModule(asset, statements);
  }

  if (statements[0]) {
    t.addComment(
      statements[0],
      'leading',
      ` ASSET: ${path.relative(options.projectRoot, asset.filePath)}`,
      true,
    );
  }

  return [asset.id, statements];
}

function parse(code, sourceFilename) {
  let ast = babelParse(code, {
    sourceFilename,
    allowReturnOutsideFunction: true,
    plugins: ['dynamicImport'],
  });

  return ast.program.body;
}

function getUsedExports(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
): Map<string, Set<Symbol>> {
  let usedExports: Map<string, Set<Symbol>> = new Map();

  let entry = bundle.getMainEntry();
  if (entry) {
    for (let {asset, symbol, exportSymbol} of bundleGraph.getExportedSymbols(
      entry,
    )) {
      if (symbol) {
        markUsed(asset, exportSymbol);
      }
    }
  }

  bundle.traverseAssets(asset => {
    let incomingDeps = bundleGraph.getIncomingDependencies(asset);
    let usedAssetSymbols = new Set();
    for (let dep of incomingDeps) {
      for (let [s] of dep.symbols) {
        usedAssetSymbols.add(s);
      }
    }
    let assetSymbolsReverse = new Map<Symbol, Array<Symbol>>();
    for (let [exportSymbol, {local}] of asset.symbols) {
      let list = assetSymbolsReverse.get(local);
      if (!list) {
        list = [];
        assetSymbolsReverse.set(local, list);
      }
      list.push(exportSymbol);
    }

    for (let dep of bundleGraph.getDependencies(asset)) {
      let resolvedAsset = bundleGraph.getDependencyResolution(dep, bundle);
      if (!resolvedAsset) {
        continue;
      }

      for (let [symbol, {local}] of dep.symbols) {
        if (local === '*') {
          continue;
        }
        if (dep.isWeak) {
          let reexportedAs = assetSymbolsReverse.get(local) ?? [];
          if (
            !reexportedAs ||
            reexportedAs.every(s => !usedAssetSymbols.has(s))
          ) {
            continue;
          }
        }

        if (symbol === '*') {
          for (let {
            asset,
            symbol,
            exportSymbol,
          } of bundleGraph.getExportedSymbols(resolvedAsset)) {
            if (symbol) {
              markUsed(asset, exportSymbol);
            }
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

function shouldSkipAsset(
  bundleGraph: BundleGraph<NamedBundle>,
  asset: Asset,
  usedExports: Map<string, Set<Symbol>>,
) {
  return (
    asset.sideEffects === false &&
    !asset.meta.isCommonJS &&
    (!usedExports.has(asset.id) ||
      nullthrows(usedExports.get(asset.id)).size === 0) &&
    !bundleGraph.getIncomingDependencies(asset).find(d =>
      // Don't exclude assets that was imported as a wildcard
      d.symbols.hasExportSymbol('*'),
    )
  );
}

const FIND_REQUIRES_VISITOR = {
  CallExpression(
    node: CallExpression,
    {
      bundle,
      bundleGraph,
      asset,
      result,
    }: {|
      bundle: NamedBundle,
      bundleGraph: BundleGraph<NamedBundle>,
      asset: Asset,
      result: Array<{|depAsset: Asset, hoist?: boolean|}>,
    |},
  ) {
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
        result.push({
          depAsset: resolution,
          hoist: !!dep.meta.hoist,
        });
      }
    }
  },
};

function findRequires(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
  asset: Asset,
  ast: Node,
): Array<{|depAsset: Asset, hoist?: boolean|}> {
  let result = [];
  walkSimple(ast, FIND_REQUIRES_VISITOR, {asset, bundle, bundleGraph, result});

  return result;
}

// Toplevel var/let/const declarations, function declarations and all `var` declarations
// in a non-function scope need to be hoisted.
const WRAP_MODULE_VISITOR = {
  VariableDeclaration(path, {decls}) {
    // $FlowFixMe
    let {node, parent} = (path: {|node: VariableDeclaration, parent: Node|});
    let isParentForX =
      isForInStatement(parent, {left: node}) ||
      isForOfStatement(parent, {left: node});
    let isParentFor = isForStatement(parent, {init: node});

    if (node.kind === 'var' || isProgram(path.parent)) {
      let replace: Array<any> = [];
      for (let decl of node.declarations) {
        let {id, init} = decl;
        if (isObjectPattern(id) || isArrayPattern(id)) {
          // $FlowFixMe it is an identifier
          let ids: Array<Identifier> = Object.values(
            t.getBindingIdentifiers(id),
          );
          for (let prop of ids) {
            decls.push(t.variableDeclarator(prop));
          }
        } else {
          decls.push(t.variableDeclarator(id));
          invariant(t.isIdentifier(id));
        }

        if (isParentForX) {
          replace.push(id);
        } else if (init) {
          replace.push(t.assignmentExpression('=', id, init));
        }
      }

      if (replace.length > 0) {
        let n = replace.length > 1 ? t.sequenceExpression(replace) : replace[0];
        if (!(isParentFor || isParentForX)) {
          n = t.expressionStatement(n);
        }

        path.replaceWith(n);
      } else {
        path.remove();
      }
    }
    path.skip();
  },
  FunctionDeclaration(path, {fns}) {
    fns.push(path.node);
    path.remove();
  },
  ClassDeclaration(path, {decls}) {
    // $FlowFixMe
    let {node} = (path: {|node: ClassDeclaration|});
    let {id} = node;
    invariant(isIdentifier(id));

    // Class declarations are not hoisted (they behave like `let`). We declare a variable
    // outside the function and convert to a class expression assignment.
    decls.push(t.variableDeclarator(id));
    path.replaceWith(
      t.expressionStatement(
        t.assignmentExpression('=', id, t.toExpression(node)),
      ),
    );
    path.skip();
  },
  'Function|Class'(path) {
    path.skip();
  },
  shouldSkip(node) {
    return t.isExpression(node);
  },
};

function wrapModule(asset: Asset, statements) {
  let decls = [];
  let fns = [];
  let program = t.program(statements);
  traverse(program, WRAP_MODULE_VISITOR, {decls, fns});

  let executed = getName(asset, 'executed');
  decls.push(
    t.variableDeclarator(t.identifier(executed), t.booleanLiteral(false)),
  );

  let execId = getIdentifier(asset, 'exec');
  let exec = t.functionDeclaration(execId, [], t.blockStatement(program.body));

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
