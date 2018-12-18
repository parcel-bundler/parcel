const t = require('@babel/types');

const EXPORTS_RE = /^\$([^$]+)\$exports$/;

/**
 * This is a small small implementation of dead code removal specialized to handle
 * removing unused exports. All other dead code removal happens in workers on each
 * individual file by babel-minify.
 */
function treeShake(scope) {
  // Keep passing over all bindings in the scope until we don't remove any.
  // This handles cases where we remove one binding which had a reference to
  // another one. That one will get removed in the next pass if it is now unreferenced.
  let removed;
  do {
    removed = false;

    // Recrawl to get all bindings.
    scope.crawl();
    Object.keys(scope.bindings).forEach(name => {
      let binding = getUnusedBinding(scope.path, name);

      // If it is not safe to remove the binding don't touch it.
      if (!binding) {
        return;
      }

      // Remove the binding and all references to it.
      binding.path.remove();
      binding.referencePaths.concat(binding.constantViolations).forEach(remove);

      scope.removeBinding(name);
      removed = true;
    });
  } while (removed);
}

module.exports = treeShake;

// Check if a binding is safe to remove and returns it if it is.
function getUnusedBinding(path, name) {
  let binding = path.scope.getBinding(name);
  if (!binding) {
    return null;
  }

  if (isPure(binding)) {
    return binding;
  }

  if (!EXPORTS_RE.test(name)) {
    return null;
  }

  // Is there any references which aren't simple assignments?
  let bailout = binding.referencePaths.some(
    path => !isExportAssignment(path) && !isUnusedWildcard(path)
  );

  if (bailout) {
    return null;
  } else {
    return binding;
  }
}

function isPure(binding) {
  if (binding.referenced) {
    return false;
  }

  if (
    binding.path.isVariableDeclarator() &&
    binding.path.get('id').isIdentifier()
  ) {
    let init = binding.path.get('init');
    return init.isPure() || init.isIdentifier() || init.isThisExpression();
  }

  return binding.path.isPure();
}

function isExportAssignment(path) {
  return (
    // match "path.any = any;"
    path.parentPath.isMemberExpression() &&
    path.parentPath.parentPath.isAssignmentExpression() &&
    path.parentPath.parentPath.node.left === path.parentPath.node
  );
}

function isUnusedWildcard(path) {
  let {parent} = path;

  return (
    // match `$parcel$exportWildcard` calls
    t.isCallExpression(parent) &&
    t.isIdentifier(parent.callee, {name: '$parcel$exportWildcard'}) &&
    parent.arguments[0] === path.node &&
    // check if the $id$exports variable is used
    !getUnusedBinding(path, parent.arguments[1].name)
  );
}

function remove(path) {
  if (path.isAssignmentExpression()) {
    if (path.parentPath.isSequenceExpression()) {
      if (path.parent.expressions.length == 1) {
        path.parentPath.remove();
      } else {
        path.remove();
      }
    } else if (!path.parentPath.isExpressionStatement()) {
      path.replaceWith(path.node.right);
    } else {
      path.remove();
    }
  } else if (isExportAssignment(path)) {
    remove(path.parentPath.parentPath);
  } else if (isUnusedWildcard(path)) {
    remove(path.parentPath);
  } else if (!path.removed) {
    path.remove();
  }
}
