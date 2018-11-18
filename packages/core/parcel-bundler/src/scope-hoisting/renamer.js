function rename(scope, oldName, newName) {
  if (oldName === newName) {
    return;
  }

  let binding = scope.getBinding(oldName);

  // Rename all constant violations
  for (let violation of binding.constantViolations) {
    let bindingIds = violation.getBindingIdentifierPaths(true, false);
    for (let name in bindingIds) {
      if (name === oldName) {
        for (let idPath of bindingIds[name]) {
          idPath.node.name = newName;
        }
      }
    }
  }

  // Rename all references
  for (let path of binding.referencePaths) {
    if (path.node.name === oldName) {
      path.node.name = newName;
    }
  }

  // Rename binding identifier, and update scope.
  scope.removeOwnBinding(oldName);
  scope.bindings[newName] = binding;
  binding.identifier.name = newName;
}

module.exports = rename;
