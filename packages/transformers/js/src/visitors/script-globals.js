// @flow

import type {AST, MutableAsset, PluginOptions} from '@parcel/types';

import * as types from '@babel/types';
import {
  isFunctionDeclaration,
  isVariableDeclaration,
  isClassDeclaration,
  isProgram,
  isDirective,
} from '@babel/types';
import {traverse} from '@parcel/babylon-walk';
import invariant from 'assert';
import nullthrows from 'nullthrows';

let scriptGlobalsVisitor = {
  Function(path) {
    path.skip();
  },
  Block: {
    enter(path, context) {
      if (!isProgram(path.node)) {
        context.isInBlock = true;
      }

      context.blockStack.push([]);
    },
    exit(path, context) {
      context.isInBlock = false;

      let functionAssignments = context.blockStack.pop();
      if (functionAssignments.length > 0) {
        // $FlowFixMe
        path.node.body.unshift(...functionAssignments);
        context.asset.setAST(context.ast);
      }
    },
  },
  Directive(path, context) {
    if (isDirective(path.node) && path.node.value.value === 'use strict') {
      context.isStrictMode = true;
    }
  },
  VariableDeclaration(path, {asset, ast, isInBlock}) {
    let node = path.node;
    invariant(isVariableDeclaration(node));

    if (isInBlock && node.kind !== 'var') {
      return;
    }

    let ids = types.getBindingIdentifiers(node);
    for (let id in ids) {
      // $FlowFixMe
      asset.meta.topLevelVars[id] = node.kind;
    }

    path.replaceWith(
      types.expressionStatement(
        types.sequenceExpression(
          node.declarations
            .filter(decl => decl.init)
            .map(decl =>
              types.assignmentExpression('=', decl.id, nullthrows(decl.init)),
            ),
        ),
      ),
    );

    asset.setAST(ast);
  },
  FunctionDeclaration(path, {asset, isInBlock, isStrictMode, blockStack}) {
    let node = path.node;
    invariant(isFunctionDeclaration(node));

    // In strict mode, function declarations inside blocks are not hoisted to the global scope.
    if (isInBlock && isStrictMode) {
      return;
    }

    let id = node.id;
    if (!id) {
      return;
    }

    let name = id.name;
    id.name = types.toIdentifier('$' + asset.id) + '$var$' + name;
    // $FlowFixMe
    asset.meta.topLevelVars[name] = 'var';

    let assignment = types.expressionStatement(
      types.assignmentExpression(
        '=',
        types.identifier(name),
        types.identifier(id.name),
      ),
    );

    // Follow Annex B.3.3 rules. Function declarations should be hoisted to the top
    // of the nearest block, or the program if not inside a block. Safari does not
    // currently implement this rule for globals, but it would be hard to replicate this.
    // https://tc39.es/ecma262/#sec-block-level-function-declarations-web-legacy-compatibility-semantics
    blockStack[blockStack.length - 1].push(assignment);
  },
  ClassDeclaration(path, {asset, ast, isInBlock}) {
    let node = path.node;
    invariant(isClassDeclaration(node));
    if (isInBlock || !node.id) {
      return;
    }

    let name = node.id.name;

    // $FlowFixMe
    asset.meta.topLevelVars[name] = 'let';

    path.replaceWith(
      types.expressionStatement(
        types.assignmentExpression(
          '=',
          types.identifier(name),
          types.toExpression(node),
        ),
      ),
    );

    asset.setAST(ast);
  },
};

export function assignScriptGlobals(
  asset: MutableAsset,
  ast: AST,
  options: PluginOptions,
) {
  asset.meta.topLevelVars = {};
  traverse(ast.program, scriptGlobalsVisitor, {
    asset,
    ast,
    options,
    isStrictMode: false,
    isInBlock: false,
    blockStack: [],
  });
}
