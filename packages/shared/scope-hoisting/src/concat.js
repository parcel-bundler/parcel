// @flow

import type {
  Asset,
  BundleGraph,
  PluginOptions,
  NamedBundle,
} from '@parcel/types';
import type {
  CallExpression,
  Expression,
  Identifier,
  LVal,
  Node,
  Statement,
  VariableDeclaration,
} from '@babel/types';

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
import {
  simple as walkSimple,
  traverse2,
  REMOVE,
  SKIP,
} from '@parcel/babylon-walk';
import {PromiseQueue, relativeUrl, relativePath} from '@parcel/utils';
import invariant from 'assert';
import fs from 'fs';
import nullthrows from 'nullthrows';
import template from '@babel/template';
import {
  assertString,
  getName,
  getIdentifier,
  parse,
  needsPrelude,
  needsDefaultInterop,
} from './utils';

const PRELUDE_PATH = path.join(__dirname, 'prelude.js');
const PRELUDE = parse(
  fs.readFileSync(path.join(__dirname, 'prelude.js'), 'utf8'),
  PRELUDE_PATH,
);

const DEFAULT_INTEROP_TEMPLATE = template.statement<
  {|
    NAME: LVal,
    MODULE: Expression,
  |},
  VariableDeclaration,
>('var NAME = $parcel$interopDefault(MODULE);');

const ESMODULE_TEMPLATE = template.statement<
  {|EXPORTS: Expression|},
  Statement,
>(`$parcel$defineInteropFlag(EXPORTS);`);

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
  parcelRequireName,
}: {|
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
  options: PluginOptions,
  wrappedAssets: Set<string>,
  parcelRequireName: string,
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
          processAsset(options, bundleGraph, bundle, node.value, wrappedAssets),
        );
    }
  });

  let outputs = new Map<string, Array<Statement>>(await queue.run());
  let result = [];

  if (needsPrelude(bundle, bundleGraph)) {
    result.push(
      ...parse(`var parcelRequireName = "${parcelRequireName}";`, PRELUDE_PATH),
      ...PRELUDE,
    );
  }

  // Note: for each asset, the order of `$parcel$require` calls and the corresponding
  // `asset.getDependencies()` must be the same!
  bundle.traverseAssets<TraversalContext>({
    enter(asset, context) {
      // Do not skip over excluded assets entirely, since their dependencies need
      // to be in the correct order and they themselves need to be inserted correctly
      // into the parent again.

      return {
        parent: context && context.children,
        children: new Map(),
      };
    },
    exit(asset, context) {
      if (!context) {
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

      if (shouldSkipAsset(bundleGraph, bundle, asset)) {
        // The order of imports of excluded assets has to be retained
        statements = [...context.children]
          .sort(
            ([aId], [bId]) =>
              nullthrows(statementIndices.get(aId)) -
              nullthrows(statementIndices.get(bId)),
          )
          .map(([, ast]) => ast)
          .flat();
      } else {
        // splice assets with missing statementIndices last (= put wrapped asset at the top)
        let wrapped = [];
        for (let [assetId, ast] of [...context.children].reverse()) {
          let index = statementIndices.get(assetId);
          if (index) {
            statements.splice(index, 0, ...ast);
          } else {
            wrapped.push(ast);
          }
        }

        for (let ast of wrapped) {
          statements.unshift(...ast);
        }
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
  bundleGraph: BundleGraph<NamedBundle>,
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

  // If this is a CommonJS module, add an interop default declaration if there are any ES6 default
  // import dependencies in the same bundle for that module.
  if (needsDefaultInterop(bundleGraph, bundle, asset)) {
    statements.push(
      DEFAULT_INTEROP_TEMPLATE({
        NAME: getIdentifier(asset, '$interop$default'),
        MODULE: t.identifier(assertString(asset.meta.exportsIdentifier)),
      }),
    );
  }

  // If this is an ES6 module with a default export, and it's required by a
  // CommonJS module in the same bundle, then add an __esModule flag for interop with babel.
  if (asset.meta.isES6Module && asset.symbols.hasExportSymbol('default')) {
    let deps = bundleGraph.getIncomingDependencies(asset);
    let hasCJSDep = deps.some(
      dep =>
        dep.meta.isCommonJS && !dep.isAsync && dep.symbols.hasExportSymbol('*'),
    );
    if (hasCJSDep) {
      statements.push(
        ESMODULE_TEMPLATE({
          EXPORTS: t.identifier(assertString(asset.meta.exportsIdentifier)),
        }),
      );
    }
  }

  if (wrappedAssets.has(asset.id)) {
    statements = wrapModule(asset, statements);
  }

  if (statements[0]) {
    t.addComment(
      statements[0],
      'leading',
      ` ASSET: ${relativePath(options.projectRoot, asset.filePath, false)}`,
      true,
    );
  }

  return [asset.id, statements];
}

function shouldSkipAsset(
  bundleGraph: BundleGraph<NamedBundle>,
  bundle: NamedBundle,
  asset: Asset,
) {
  return (
    asset.sideEffects === false &&
    bundleGraph.getUsedSymbols(asset).size == 0 &&
    !bundleGraph.isAssetReferencedByDependant(bundle, asset)
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
      result: Array<Asset>,
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
        result.push(resolution);
      }
    }
  },
};

function findRequires(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
  asset: Asset,
  ast: Node,
): Array<Asset> {
  let result = [];
  walkSimple(ast, FIND_REQUIRES_VISITOR, {asset, bundle, bundleGraph, result});

  return result;
}

// Toplevel var/let/const declarations, function declarations and all `var` declarations
// in a non-function scope need to be hoisted.
const WRAP_MODULE_VISITOR = {
  VariableDeclaration(node, {decls}, ancestors) {
    let parent = ancestors[ancestors.length - 2];
    let isParentForX =
      isForInStatement(parent, {left: node}) ||
      isForOfStatement(parent, {left: node});
    let isParentFor = isForStatement(parent, {init: node});

    if (node.kind === 'var' || isProgram(parent)) {
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

        return n;
      } else {
        return REMOVE;
      }
    }
    return SKIP;
  },
  FunctionDeclaration(node, {fns}) {
    fns.push(node);
    return REMOVE;
  },
  ClassDeclaration(node, {decls}) {
    let {id} = node;
    invariant(isIdentifier(id));

    // Class declarations are not hoisted (they behave like `let`). We declare a variable
    // outside the function and convert to a class expression assignment.
    decls.push(t.variableDeclarator(id));
    return t.expressionStatement(
      t.assignmentExpression('=', id, t.toExpression(node)),
    );
  },
  'Function|Class'() {
    return SKIP;
  },
  shouldSkip(node) {
    return t.isExpression(node);
  },
};

function wrapModule(asset: Asset, statements) {
  let decls = [];
  let fns = [];
  let program = t.program(statements);
  traverse2(program, WRAP_MODULE_VISITOR, {asset, decls, fns});

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
