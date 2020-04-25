// @flow
import type {Expression, Node} from '@babel/types';
import {
  isArrowFunctionExpression,
  isBlock,
  isBlockStatement,
  isConditionalExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isIfStatement,
  isProgram,
  isVariableDeclaration,
  isUnaryExpression,
  isBinaryExpression,
} from '@babel/types';

import * as types from '@babel/types';
import traverse from '@babel/traverse';

export function hasBinding(node: Node | Array<Node>, name: string) {
  if (Array.isArray(node)) {
    return node.some(ancestor => hasBinding(ancestor, name));
  } else if (isProgram(node) || isBlockStatement(node) || isBlock(node)) {
    // $FlowFixMe isBlock doesn't refine the type...
    return node.body.some(statement => hasBinding(statement, name));
  } else if (
    isFunctionDeclaration(node) ||
    isFunctionExpression(node) ||
    isArrowFunctionExpression(node)
  ) {
    return (
      (node.id && node.id.name === name) ||
      node.params.some(param => isIdentifier(param) && param.name === name)
    );
  } else if (isVariableDeclaration(node)) {
    return node.declarations.some(
      declaration =>
        isIdentifier(declaration.id) && declaration.id.name === name,
    );
  }

  return false;
}

// replace object properties
export function morph(
  object: $Shape<{|[string]: mixed|}>,
  newProperties: $Shape<{|[string]: mixed|}>,
) {
  for (let key in object) {
    delete object[key];
  }

  for (let key in newProperties) {
    object[key] = newProperties[key];
  }
}

export function isInFalsyBranch(ancestors: Array<Node>) {
  // Check if any ancestors are if statements
  return ancestors.some((node, index) => {
    if (isIfStatement(node) || isConditionalExpression(node)) {
      let res = evaluateExpression(node.test);
      if (res && res.confident) {
        // If the test is truthy, exclude the dep if it is in the alternate branch.
        // If the test if falsy, exclude the dep if it is in the consequent branch.
        let child = ancestors[index + 1];
        return res.value ? child === node.alternate : child === node.consequent;
      }
    }
  });
}

export function deleteClosestFalsyBranch(ancestors: Array<Node>) {
  const testNode = ancestors[ancestors.length - 1];
  let conditionNode = [...ancestors]
    .reverse()
    .find(node => isIfStatement(node) || isConditionalExpression(node));
  if (conditionNode) {
    const isClosestTestNode = conditionNode.test === testNode;
    const isClosestUnaryExpression =
      isUnaryExpression(conditionNode.test) &&
      conditionNode.test.argument === testNode;
    const isClosestBinaryExpression =
      isBinaryExpression(conditionNode.test) &&
      (conditionNode.test.left === testNode ||
        conditionNode.test.right === testNode);

    if (
      isClosestTestNode ||
      isClosestUnaryExpression ||
      isClosestBinaryExpression
    ) {
      const res = evaluateExpression(conditionNode.test);
      if (res && res.confident) {
        const index = ancestors.indexOf(conditionNode);
        ancestors[index] = conditionNode.alternate;
        if (res.value) {
          Object.assign(conditionNode, conditionNode.consequent);
        } else {
          Object.assign(conditionNode, conditionNode.alternate);
        }
      }
    }
  }
}

function evaluateExpression(node: Expression) {
  // Wrap the node in a standalone program so we can traverse it
  let file = types.file(types.program([types.expressionStatement(node)]));

  // Find the first expression and evaluate it.
  let res = null;
  traverse(file, {
    Expression(path) {
      res = path.evaluate();
      path.stop();
    },
  });

  return res;
}
