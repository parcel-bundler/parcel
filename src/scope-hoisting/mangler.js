const Charset = require('babel-plugin-minify-mangle-names/lib/charset');
const rename = require('./renamer');
const t = require('babel-types');

/**
 * This is a very specialized mangler designer to mangle only names in the top-level scope.
 * Mangling of names in other scopes happens at a file level inside workers, but we can't 
 * mangle the top-level scope until scope hoisting is complete in the packager.
 */
function mangleScope(scope) {
  let charset = new Charset(false);
  charset.sort();

  let bindings = {};
  let newNames = new Set;

  // Sort bindings so that more frequently referenced bindings get shorter names.
  let sortedBindings = Object.keys(scope.bindings)
    .sort((a, b) => scope.bindings[b].referencePaths.length - scope.bindings[a].referencePaths.length);

  for (let oldName of sortedBindings) {
    let i = 0;
    let newName = '';

    do {
      newName = charset.getIdentifier(i++);
    } while (newNames.has(newName)   || !canRename(scope, scope.bindings[oldName], newName));

    bindings[oldName] = newName;
    newNames.add(newName);
  }

  rename(scope, bindings);
}

function canRename(scope, binding, newName) {
  if (!t.isValidIdentifier(newName)) {
    return false;
  }

  // If there are any references where the parent scope has a binding 
  // for the new name, we cannot rename to this name.
  for (let i = 0; i < binding.referencePaths.length; i++) {
    const ref = binding.referencePaths[i];
    if (ref.scope.hasBinding(newName) || ref.scope.hasReference(newName)) {
      return false;
    }
  }

  return true;
}

module.exports = mangleScope;
