// @flow
import type {Asset, Symbol} from '@parcel/types';
import type {NodePath, Scope} from '@babel/traverse';
import type {Expression, Identifier, Node} from '@babel/types';

import {
  isAssignmentExpression,
  isCallExpression,
  isExpressionStatement,
  isIdentifier,
  isMemberExpression,
  isObjectExpression,
  isSequenceExpression,
  isStringLiteral,
  isVariableDeclarator,
} from '@babel/types';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import {pathDereference, pathRemove} from './utils';

/**
 * This is a small small implementation of dead code removal specialized to handle
 * removing unused exports.
 */
export default function treeShake(
  scope: Scope,
  exportedIdentifiers: Set<Symbol>,
  exportsMap: Map<Symbol, Asset>,
) {
  // Keep passing over all bindings in the scope until we don't remove any.
  // This handles cases where we remove one binding which had a reference to
  // another one. That one will get removed in the next pass if it is now unreferenced.
  let removed;
  do {
    removed = false;

    Object.keys(scope.bindings).forEach((name: string) => {
      let binding = getUnusedBinding(scope.path, name, exportsMap);

      // If it is not safe to remove the binding don't touch it.
      if (!binding || exportedIdentifiers.has(name)) {
        return;
      }

      // Remove the binding and all references to it.
      pathRemove(binding.path);
      [...binding.referencePaths, ...binding.constantViolations].forEach(p =>
        remove(p, scope, exportsMap),
      );

      scope.removeBinding(name);
      removed = true;
    });
  } while (removed);
}

// Check if a binding is safe to remove and returns it if it is.
function getUnusedBinding(path, name, exportsMap) {
  let binding = path.scope.getBinding(name);
  if (!binding) {
    return null;
  }

  if (!isPure(binding)) {
    // declaration (~= init) isn't pure
    return null;
  }

  if (hasSideEffects(binding)) {
    // e.g.
    //    let foo = {};
    //    foo = window;
    //    foo.xyz = 2;
    //    console.log(window.xyz);
    return null;
  }

  if (!binding.referenced) {
    return binding;
  }

  // Is there any references which aren't simple assignments?
  let bailout = binding.referencePaths.some(
    path => !isExportAssignment(path, exportsMap) && !isWildcardDest(path),
  );

  if (!bailout) {
    return binding;
  }

  return null;
}

function isPure(binding) {
  let {path} = binding;
  let {node} = path;
  if (isVariableDeclarator(node) && isIdentifier(node.id)) {
    let init = path.get<NodePath<Expression>>('init');
    return (
      init.isPure() ||
      init.isIdentifier() ||
      init.isThisExpression() ||
      (isVariableDeclarator(node) &&
        isIdentifier(node.id, {name: '$parcel$global'}))
    );
  }

  return path.isPure();
}

function hasSideEffects(binding) {
  let {node} = binding.path;
  if (isVariableDeclarator(node)) {
    return !(
      (!binding.referenced || isObjectExpression(node.init)) &&
      (binding.constant ||
        binding.constantViolations.every(
          ({node}) =>
            !isAssignmentExpression(node) || isObjectExpression(node.right),
        ))
    );
  }

  return false;
}

function isExportAssignment(path, exportsMap: Map<Symbol, Asset>) {
  let {parent} = path;
  // match "path.foo = bar;", where path is a known exports identifier.
  if (
    isMemberExpression(parent) &&
    parent.object === path.node &&
    isIdentifier(path.node) &&
    exportsMap.has(path.node.name) &&
    ((isIdentifier(parent.property) && !parent.computed) ||
      isStringLiteral(parent.property))
  ) {
    let parentParent = path.parentPath.parent;
    return isAssignmentExpression(parentParent) && parentParent.left === parent;
  }
  return false;
}

// check if the argument appears as $parcel$exportWildcard(path, ...)
function isWildcardDest(path) {
  let parent: Node = path.parent;

  return (
    isCallExpression(parent) &&
    isIdentifier(parent.callee, {name: '$parcel$exportWildcard'}) &&
    parent.arguments[0] === path.node
  );
}

function remove(
  path: NodePath<Node>,
  scope: Scope,
  exportsMap: Map<Symbol, Asset>,
) {
  let {node, parent} = path;
  if (isAssignmentExpression(node)) {
    let right;
    if (isSequenceExpression(parent) && parent.expressions.length === 1) {
      // TODO missing test coverage
      // replace sequence expression with it's sole child
      path.parentPath.replaceWith(node);
      remove(path.parentPath, scope, exportsMap);
    } else if (
      //e.g. `exports.foo = bar;`, `bar` needs to be pure (an Identifier isn't ?!)
      isExpressionStatement(parent) &&
      ((right = path.get('right')).isPure() || right.isIdentifier())
    ) {
      pathRemove(path);
    } else {
      // right side isn't pure
      path.replaceWith(node.right);
    }
  } else if (isExportAssignment(path, exportsMap)) {
    remove(path.parentPath.parentPath, scope, exportsMap);
  } else if (isWildcardDest(path)) {
    let wildcard = path.parent;
    invariant(isCallExpression(wildcard));
    let src = wildcard.arguments[1];

    if (isCallExpression(src)) {
      let {callee} = src;
      invariant(isIdentifier(callee) && callee.name);
      // keep `$...$init()` call
      pathDereference(path.parentPath);
      let [expr] = path.parentPath.replaceWith<Expression>(src);
      nullthrows(scope.getBinding(callee.name)).reference(
        expr.get<NodePath<Identifier>>('callee'),
      );
    } else {
      invariant(
        isIdentifier(src) ||
          (isObjectExpression(src) && src.properties.length === 0),
      );
      remove(path.parentPath, scope, exportsMap);
    }
  } else if (!path.removed) {
    if (isSequenceExpression(parent) && parent.expressions.length === 1) {
      // TODO missing test coverage
      // replace sequence expression with it's sole child
      path.parentPath.replaceWith(node);
      remove(path.parentPath, scope, exportsMap);
    } else {
      pathRemove(path);
    }
  }
}
