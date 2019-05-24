import * as t from '@babel/types';
import {simple as walkSimple} from 'babylon-walk';

export function getName(asset, type, ...rest) {
  return (
    '$' +
    t.toIdentifier(asset.id) +
    '$' +
    type +
    (rest.length
      ? '$' +
        rest
          .map(name => (name === 'default' ? name : t.toIdentifier(name)))
          .join('$')
      : '')
  );
}

export function getIdentifier(asset, type, ...rest) {
  return t.identifier(getName(asset, type, ...rest));
}

export function getExportIdentifier(asset, name) {
  return getIdentifier(asset, 'export', name);
}

export function removeReference(node, scope) {
  let binding = scope.getBinding(node.name);
  if (binding) {
    let i = binding.referencePaths.findIndex(v => v.node === node);
    if (i >= 0) {
      binding.dereference();
      binding.referencePaths.splice(i, 1);
    }
  }
}

const VisitorRemovePathBindingRecursive = {
  Identifier(node, scope) {
    removeReference(node, scope);
  }
};

// update bindings in program scope of all identifiers
// inside 'path' to remove need for crawl()ing
export function removePathBindingRecursive(path, scope) {
  walkSimple(path.node, VisitorRemovePathBindingRecursive, scope);
  path.remove();
}
