// @flow
import type {Symbol} from '@parcel/types';
import type {NodePath, Scope} from '@babel/traverse';
import type {Node} from '@babel/types';

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

/**
 * This is a small small implementation of dead code removal specialized to handle
 * removing unused exports. All other dead code removal happens in workers on each
 * individual file by babel-minify.
 */
export default function treeShake(
  scope: Scope,
  exportedIdentifiers: Set<Symbol>,
) {
  // Keep passing over all bindings in the scope until we don't remove any.
  // This handles cases where we remove one binding which had a reference to
  // another one. That one will get removed in the next pass if it is now unreferenced.
  let removed;
  do {
    removed = false;

    // Recrawl to get all bindings.
    scope.crawl();
    Object.keys(scope.bindings).forEach((name: string) => {
      let binding = getUnusedBinding(scope.path, name);

      // If it is not safe to remove the binding don't touch it.
      if (!binding || exportedIdentifiers.has(name)) {
        return;
      }

      // Remove the binding and all references to it.
      binding.path.remove();
      [...binding.referencePaths, ...binding.constantViolations].forEach(
        remove,
      );

      scope.removeBinding(name);
      removed = true;
    });
  } while (removed);
}

// Check if a binding is safe to remove and returns it if it is.
function getUnusedBinding(path, name) {
  let binding = path.scope.getBinding(name);
  if (!binding) {
    return null;
  }

  let pure = isPure(binding);
  if (!binding.referenced && pure) {
    return binding;
  }

  // Is there any references which aren't simple assignments?
  let bailout = binding.referencePaths.some(
    path => !isExportAssignment(path) && !isWildcardDest(path),
  );

  if (!bailout && pure) {
    return binding;
  }

  return null;
}

function isPure(binding) {
  if (
    binding.path.isVariableDeclarator() &&
    binding.path.get('id').isIdentifier()
  ) {
    let init = binding.path.get('init');
    return (
      init.isPure() ||
      init.isIdentifier() ||
      init.isThisExpression() ||
      (isVariableDeclarator(binding.path.node) &&
        isIdentifier(binding.path.node.id, {name: '$parcel$global'}))
    );
  }

  return binding.path.isPure();
}

function isExportAssignment(path) {
  let {parent} = path;
  // match "path.foo = bar;"
  if (
    isMemberExpression(parent) &&
    parent.object === path.node &&
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

function remove(path: NodePath<Node>) {
  let {node, parent} = path;
  if (isAssignmentExpression(node)) {
    let right;
    if (isSequenceExpression(parent) && parent.expressions.length === 1) {
      // replace sequence expression with it's sole child
      path.parentPath.replaceWith(node);
      remove(path.parentPath);
    } else if (
      //e.g. `exports.foo = bar;`, `bar` needs to be pure (an Identifier isn't ?!)
      isExpressionStatement(parent) &&
      ((right = path.get('right')).isPure() || right.isIdentifier())
    ) {
      path.remove();
    } else {
      // right side isn't pure
      path.replaceWith(node.right);
    }
  } else if (isExportAssignment(path)) {
    remove(path.parentPath.parentPath);
  } else if (isWildcardDest(path)) {
    let wildcard = path.parent;
    invariant(isCallExpression(wildcard));
    let src = wildcard.arguments[1];

    if (isCallExpression(src)) {
      // keep `$...$init()` call
      path.parentPath.replaceWith(src);
    } else {
      invariant(
        isIdentifier(src) ||
          (isObjectExpression(src) && src.properties.length === 0),
      );
      remove(path.parentPath);
    }
  } else if (!path.removed) {
    if (isSequenceExpression(parent) && parent.expressions.length === 1) {
      // replace sequence expression with it's sole child
      path.parentPath.replaceWith(node);
      remove(path.parentPath);
    } else {
      path.remove();
    }
  }
}
