// @flow
import * as t from '@babel/types';

export default function rename(scope: any, oldName: string, newName: string) {
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
    if (t.isExportSpecifier(path.parent) && path.parentPath.parent.source) {
      continue;
    }
    if (path.node.name === oldName) {
      path.node.name = newName;
    }
  }

  // Rename binding identifier, and update scope.
  scope.removeOwnBinding(oldName);
  scope.bindings[newName] = binding;
  binding.identifier.name = newName;
}
