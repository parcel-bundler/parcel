// @flow

import type {
  AST,
  DependencyOptions,
  JSONObject,
  Meta,
  MutableAsset,
  PluginOptions,
} from '@parcel/types';
import type {Node, ObjectExpression} from '@babel/types';
import type {SimpleVisitors} from '@parcel/babylon-walk';

import * as types from '@babel/types';
import {
  isArrowFunctionExpression,
  isCallExpression,
  isMemberExpression,
  isReturnStatement,
  isIdentifier,
  isNewExpression,
  isFunction,
} from '@babel/types';
import {isURL, md5FromString, createDependencyLocation} from '@parcel/utils';
import {isInFalsyBranch, hasBinding, morph} from './utils';

const serviceWorkerPattern = ['navigator', 'serviceWorker', 'register'];

export default ({
  ImportDeclaration(node, {asset}) {
    asset.meta.isES6Module = true;
    addDependency(asset, node.source);
  },

  ExportNamedDeclaration(node, {asset}) {
    asset.meta.isES6Module = true;
    if (node.source) {
      addDependency(asset, node.source);
    }
  },

  ExportAllDeclaration(node, {asset}) {
    asset.meta.isES6Module = true;
    addDependency(asset, node.source);
  },

  ExportDefaultDeclaration(node, {asset}) {
    asset.meta.isES6Module = true;
  },

  CallExpression: {
    enter(node, {asset, ast}, ancestors) {
      let {callee, arguments: args} = node;

      let isRequire =
        types.isIdentifier(callee) &&
        callee.name === 'require' &&
        args.length === 1 &&
        types.isStringLiteral(args[0]) &&
        !hasBinding(ancestors, 'require') &&
        !isInFalsyBranch(ancestors);

      if (isRequire) {
        let isOptional =
          ancestors.some(a => types.isTryStatement(a)) || undefined;
        let isAsync = isRequireAsync(ancestors, node, asset, ast);
        addDependency(asset, args[0], {isOptional, isAsync});
        return;
      }

      let isRequireResolve =
        types.isMemberExpression(callee) &&
        types.matchesPattern(callee, 'require.resolve') &&
        args.length === 1 &&
        types.isStringLiteral(args[0]) &&
        !hasBinding(ancestors, 'require') &&
        !isInFalsyBranch(ancestors);

      if (isRequireResolve) {
        let isOptional =
          ancestors.some(a => types.isTryStatement(a)) || undefined;
        addDependency(asset, args[0], {isOptional});
        return;
      }

      let isDynamicImport =
        callee.type === 'Import' &&
        args.length > 0 &&
        types.isStringLiteral(args[0]);

      if (isDynamicImport) {
        // Ignore dynamic imports of fully specified urls
        if (isURL(args[0].value)) {
          return;
        }

        let meta;
        let importAttributesNode = args[1];
        if (importAttributesNode != null) {
          if (importAttributesNode.type !== 'ObjectExpression') {
            throw new Error(
              'Second argument to import() must be an object expression',
            );
          }
          meta = {
            importAttributes: objectExpressionNodeToJSONObject(
              importAttributesNode,
            ),
          };

          // Remove the attributes argument from the import() call
          args.splice(1, 1);
        }

        addDependency(asset, args[0], {isAsync: true, meta});

        node.callee = types.identifier('require');
        asset.setAST(ast);
        return;
      }
    },
    exit(node, {asset, ast}, ancestors) {
      if (node.type !== 'CallExpression') {
        // It's possible this node has been morphed into another type
        return;
      }

      let {callee, arguments: args} = node;

      let isRegisterServiceWorker =
        types.isStringLiteral(args[0]) &&
        types.matchesPattern(callee, serviceWorkerPattern) &&
        !hasBinding(ancestors, 'navigator') &&
        !isInFalsyBranch(ancestors);

      if (isRegisterServiceWorker) {
        // Treat service workers as an entry point so filenames remain consistent across builds.
        // https://developers.google.com/web/fundamentals/primers/service-workers/lifecycle#avoid_changing_the_url_of_your_service_worker_script
        addURLDependency(asset, ast, args[0], {
          isEntry: true,
          env: {context: 'service-worker'},
        });
        return;
      }

      let isImportScripts =
        asset.env.isWorker() && callee.name === 'importScripts';

      if (isImportScripts) {
        for (let arg of args) {
          if (types.isStringLiteral(arg)) {
            addURLDependency(asset, ast, arg);
          }
        }
        return;
      }
    },
  },

  NewExpression: {
    exit(node, {asset, ast}, ancestors) {
      let {callee, arguments: args} = node;

      let isWebWorker =
        callee.type === 'Identifier' &&
        (callee.name === 'Worker' || callee.name === 'SharedWorker') &&
        !hasBinding(ancestors, callee.name) &&
        !isInFalsyBranch(ancestors) &&
        types.isStringLiteral(args[0]) &&
        (args.length === 1 || args.length === 2);

      if (isWebWorker) {
        let isModule = false;
        if (types.isObjectExpression(args[1])) {
          let prop = args[1].properties.find(v =>
            types.isIdentifier(v.key, {name: 'type'}),
          );
          if (prop && types.isStringLiteral(prop.value))
            isModule = prop.value.value === 'module';
        }

        addURLDependency(asset, ast, args[0], {
          env: {
            context: 'web-worker',
            outputFormat:
              isModule && asset.env.shouldScopeHoist ? 'esmodule' : undefined,
          },
          meta: {
            webworker: true,
          },
        });
        return;
      }
    },
  },
}: SimpleVisitors<
  (
    any,
    {|asset: MutableAsset, ast: AST, options: PluginOptions|},
    Array<Node>,
  ) => void,
>);

// TypeScript, Rollup, and Parcel itself generate these patterns for async imports in CommonJS
//   1. TypeScript - Promise.resolve().then(function () { return require(...) })
//   2. Rollup - new Promise(function (resolve) { resolve(require(...)) })
//   3. Parcel - Promise.resolve(require(...))
function isRequireAsync(ancestors, requireNode, asset, ast) {
  let parent = ancestors[ancestors.length - 2];

  // Promise.resolve().then(() => require('foo'))
  // Promise.resolve().then(() => { return require('foo') })
  // Promise.resolve().then(function () { return require('foo') })
  let functionParent = getFunctionParent(ancestors);
  if (
    functionParent &&
    isCallExpression(functionParent) &&
    isMemberExpression(functionParent.callee) &&
    functionParent.callee.property.name === 'then' &&
    isPromiseResolve(functionParent.callee.object)
  ) {
    // If the `require` call is not immediately returned (e.g. wrapped in another function),
    // then transform the AST to create a promise chain so that the require is by itself.
    // This is because the require will return a promise rather than the module synchronously.
    // For example, TypeScript generates the following with the esModuleInterop flag:
    //   Promise.resolve().then(() => __importStar(require('./foo')));
    // This is transformed into:
    //   Promise.resolve().then(() => require('./foo')).then(res => __importStar(res));
    if (!isArrowFunctionExpression(parent) && !isReturnStatement(parent)) {
      // Replace the original `require` call with a reference to a variable
      let requireClone = types.clone(requireNode);
      let v = types.identifier(
        '$parcel$' + md5FromString(requireNode.arguments[0].value).slice(-4),
      );
      morph(requireNode, v);

      // Add the variable as a param to the parent function
      let fn = functionParent.arguments[0];
      // $FlowFixMe
      fn.params[0] = v;

      // Replace original function with only the require call
      functionParent.arguments[0] = isArrowFunctionExpression(fn)
        ? types.arrowFunctionExpression([], requireClone)
        : types.functionExpression(
            null,
            [],
            types.blockStatement([types.returnStatement(requireClone)]),
          );

      // Add the original function as an additional promise chain
      let replacement = types.callExpression(
        types.memberExpression(
          types.clone(functionParent),
          types.identifier('then'),
        ),
        [fn],
      );

      morph(functionParent, replacement);
      asset.setAST(ast);
    }

    return true;
  }

  // Promise.resolve(require('foo'))
  // $FlowFixMe
  if (isPromiseResolve(parent) && parent.arguments[0] === requireNode) {
    return true;
  }

  // new Promise(resolve => resolve(require('foo')))
  // new Promise(resolve => { resolve(require('foo')) })
  // new Promise(function (resolve) { resolve(require('foo')) })
  if (
    functionParent &&
    isCallExpression(parent) &&
    isIdentifier(parent.callee) &&
    isNewExpression(functionParent) &&
    isIdentifier(functionParent.callee) &&
    functionParent.callee.name === 'Promise' &&
    isFunction(functionParent.arguments[0]) &&
    // $FlowFixMe
    isIdentifier(functionParent.arguments[0].params[0]) &&
    // $FlowFixMe
    parent.callee.name === functionParent.arguments[0].params[0].name
  ) {
    return true;
  }
}

function isPromiseResolve(node) {
  return (
    isCallExpression(node) &&
    isMemberExpression(node.callee) &&
    isIdentifier(node.callee.object) &&
    isIdentifier(node.callee.property) &&
    node.callee.object.name === 'Promise' &&
    node.callee.property.name === 'resolve'
  );
}

function getFunctionParent(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (types.isFunction(ancestors[i])) {
      return ancestors[i - 1];
    }
  }
}

function addDependency(
  asset,
  node,
  opts: ?{|isAsync?: boolean, isOptional?: boolean, meta?: ?Meta|},
) {
  let dependencyOptions: DependencyOptions = {
    moduleSpecifier: node.value,
    loc: node.loc && createDependencyLocation(node.loc.start, node.value, 0, 1),
    isAsync: opts ? opts.isAsync : false,
    isOptional: opts ? opts.isOptional : false,
  };

  if (opts?.meta != null) {
    dependencyOptions = {...dependencyOptions, meta: opts.meta};
  }

  asset.addDependency(dependencyOptions);
}

function addURLDependency(
  asset: MutableAsset,
  ast: AST,
  node,
  opts: $Shape<DependencyOptions> = {},
) {
  let url = node.value;
  asset.addURLDependency(url, {
    loc: node.loc && createDependencyLocation(node.loc.start, node.value, 0, 1),
    ...opts,
  });

  morph(
    node,
    types.callExpression(types.identifier('require'), [
      types.stringLiteral(url),
    ]),
  );
  asset.setAST(ast);
}

// TODO: Implement support for non-boolean values.
function objectExpressionNodeToJSONObject(
  objectExpressionNode: ObjectExpression,
): JSONObject {
  let object = {};
  for (let property of objectExpressionNode.properties) {
    if (property.type !== 'ObjectProperty') {
      continue;
    }
    let {key, value} = property;

    if (key.type !== 'Identifier') {
      continue;
    }

    if (value.type === 'BooleanLiteral') {
      object[key.name] = value.value;
    }
  }

  return object;
}
