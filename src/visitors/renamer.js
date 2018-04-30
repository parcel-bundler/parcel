// A fork of babel-traverse Renamer class, optimized for renaming multiple bindings
// https://github.com/babel/babel/blob/v6.26.3/packages/babel-traverse/src/scope/lib/renamer.js

const t = require('babel-types');

const renameVisitor = {
  ReferencedIdentifier(path, states) {
    states.find(state => {
      if (
        path.node.name === state.oldName &&
        path.scope.bindingIdentifierEquals(
          state.oldName,
          state.binding.identifier
        )
      ) {
        path.node.name = state.newName;

        return true;
      }
    });
  },
  'AssignmentExpression|Declaration'(path, states) {
    let ids = path.getOuterBindingIdentifiers();

    states.find(state => {
      if (
        !path.scope.bindingIdentifierEquals(
          state.oldName,
          state.binding.identifier
        )
      ) {
        return;
      }

      let id = ids[state.oldName];

      if (id) {
        id.name = state.newName;

        return true;
      }
    });
  }
};

class Renamer {
  constructor(binding, oldName, newName) {
    this.newName = newName;
    this.oldName = oldName;
    this.binding = binding;
  }

  maybeConvertFromExportDeclaration(parentDeclar) {
    let exportDeclar =
      parentDeclar.parentPath.isExportDeclaration() && parentDeclar.parentPath;

    if (!exportDeclar) {
      return;
    }

    // build specifiers that point back to this export declaration
    let isDefault = exportDeclar.isExportDefaultDeclaration();

    if (
      isDefault &&
      (parentDeclar.isFunctionDeclaration() ||
        parentDeclar.isClassDeclaration()) &&
      !parentDeclar.node.id
    ) {
      // Ensure that default class and function exports have a name so they have a identifier to
      // reference from the export specifier list.
      parentDeclar.node.id = parentDeclar.scope.generateUidIdentifier(
        'default'
      );
    }

    let bindingIdentifiers = parentDeclar.getOuterBindingIdentifiers();
    let specifiers = [];

    for (let name in bindingIdentifiers) {
      let localName = name === this.oldName ? this.newName : name;
      let exportedName = isDefault ? 'default' : name;

      specifiers.push(
        t.exportSpecifier(t.identifier(localName), t.identifier(exportedName))
      );
    }

    if (specifiers.length) {
      let aliasDeclar = t.exportNamedDeclaration(null, specifiers);

      // hoist to the top if it's a function
      if (parentDeclar.isFunctionDeclaration()) {
        aliasDeclar._blockHoist = 3;
      }

      exportDeclar.insertAfter(aliasDeclar);
      exportDeclar.replaceWith(parentDeclar.node);
    }
  }

  prepare() {
    let {path} = this.binding;
    let parentDeclar = path.find(
      path => path.isDeclaration() || path.isFunctionExpression()
    );

    if (parentDeclar) {
      this.maybeConvertFromExportDeclaration(parentDeclar);
    }

    return this;
  }

  rename() {
    let {binding, oldName, newName} = this;
    let {scope} = binding;

    scope.removeOwnBinding(oldName);
    scope.bindings[newName] = binding;
    this.binding.identifier.name = newName;

    if (binding.type === 'hoisted') {
      // https://github.com/babel/babel/issues/2435
      // todo: hoist and convert function to a let
    }
  }
}

module.exports = (scope, names) => {
  let renamers = Object.keys(names).map(oldName => {
    let binding = scope.getBinding(oldName);

    if (!binding) {
      throw new Error(`Cannot find variable ${oldName}`);
    }
    let newName = names[oldName];

    return new Renamer(binding, oldName, newName).prepare();
  });

  if (!renamers.length) {
    return;
  }

  scope.traverse(scope.block, renameVisitor, renamers);

  renamers.forEach(renamer => renamer.rename(scope));
};
