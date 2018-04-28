const matchesPattern = require('./matches-pattern');
const t = require('babel-types');
const template = require('babel-template');

const WRAPPER_TEMPLATE = template(`
  var NAME = (function () {
    var exports = this;
    var module = {exports: this};
    BODY;
    return module.exports;
  }).call({});
`);

const IMPORT_TEMPLATE = template(
  '$parcel$import(ID, SOURCE, NAME, REPLACE_VAR)'
);
const EXPORT_ASSIGN_TEMPLATE = template('EXPORTS.NAME = LOCAL');
const EXPORT_ALL_TEMPLATE = template(
  '$parcel$exportWildcard(OLD_NAME, $parcel$require(ID, SOURCE))'
);
const REQUIRE_CALL_TEMPLATE = template('$parcel$require(ID, SOURCE)');
const REQUIRE_RESOLVE_CALL_TEMPLATE = template(
  '$parcel$require$resolve(ID, SOURCE)'
);
const TYPEOF = {
  module: 'object',
  require: 'function'
};

module.exports = {
  Program: {
    enter(path, asset) {
      asset.cacheData.exports = {};
      asset.cacheData.wildcards = [];

      let shouldWrap = false;
      path.traverse({
        CallExpression(path) {
          // If we see an `eval` call, wrap the module in a function.
          // Otherwise, local variables accessed inside the eval won't work.
          let callee = path.node.callee;
          if (
            t.isIdentifier(callee) &&
            callee.name === 'eval' &&
            !path.scope.hasBinding('eval', true)
          ) {
            asset.cacheData.isCommonJS = true;
            shouldWrap = true;
            path.stop();
          }
        },

        ReturnStatement(path) {
          // Wrap in a function if we see a top-level return statement.
          if (path.getFunctionParent().isProgram()) {
            shouldWrap = true;
            asset.cacheData.isCommonJS = true;
            path.replaceWith(
              t.returnStatement(
                t.memberExpression(
                  t.identifier('module'),
                  t.identifier('exports')
                )
              )
            );
            path.stop();
          }
        },

        ReferencedIdentifier(path) {
          // We must wrap if `module` is referenced as a free identifier rather
          // than a statically resolvable member expression.
          if (
            path.node.name === 'module' &&
            (!path.parentPath.isMemberExpression() || path.parent.computed) &&
            !(
              path.parentPath.isUnaryExpression() &&
              path.parent.operator === 'typeof'
            ) &&
            !path.scope.hasBinding('module') &&
            !path.scope.getData('shouldWrap')
          ) {
            asset.cacheData.isCommonJS = true;
            shouldWrap = true;
            path.stop();
          }
        }
      });

      path.scope.setData('shouldWrap', shouldWrap);
    },

    exit(path, asset) {
      let scope = path.scope;

      if (scope.getData('shouldWrap')) {
        path.replaceWith(
          t.program([
            WRAPPER_TEMPLATE({
              NAME: getExportsIdentifier(asset),
              BODY: path.node.body
            })
          ])
        );
      } else {
        // Re-crawl scope so we are sure to have all bindings.
        scope.crawl();

        // Rename each binding in the top-level scope to something unique.
        for (let name in scope.bindings) {
          if (!name.startsWith('$' + asset.id)) {
            let newName = '$' + asset.id + '$var$' + name;
            scope.rename(name, newName);
          }
        }

        let exportsIdentifier = getExportsIdentifier(asset);

        // Add variable that represents module.exports if it is referenced and not declared.
        if (
          scope.hasGlobal(exportsIdentifier.name) &&
          !scope.hasBinding(exportsIdentifier.name)
        ) {
          path.unshiftContainer('body', [
            t.variableDeclaration('var', [
              t.variableDeclarator(exportsIdentifier, t.objectExpression([]))
            ])
          ]);
        }
      }

      path.stop();
      asset.isAstDirty = true;
    }
  },

  MemberExpression(path, asset) {
    if (path.scope.hasBinding('module') || path.scope.getData('shouldWrap')) {
      return;
    }

    if (matchesPattern(path.node, 'module.exports')) {
      path.replaceWith(getExportsIdentifier(asset));
      asset.cacheData.isCommonJS = true;
    }

    if (matchesPattern(path.node, 'module.id')) {
      path.replaceWith(t.numericLiteral(asset.id));
    }

    if (matchesPattern(path.node, 'module.hot')) {
      path.replaceWith(t.identifier('null'));
    }

    if (matchesPattern(path.node, 'module.bundle.modules')) {
      path.replaceWith(
        t.memberExpression(t.identifier('require'), t.identifier('modules'))
      );
    }
  },

  ReferencedIdentifier(path, asset) {
    if (
      path.node.name === 'exports' &&
      !path.scope.hasBinding('exports') &&
      !path.scope.getData('shouldWrap')
    ) {
      path.replaceWith(getExportsIdentifier(asset));
      asset.cacheData.isCommonJS = true;
    }
  },

  ThisExpression(path, asset) {
    if (!path.scope.parent && !path.scope.getData('shouldWrap')) {
      path.replaceWith(getExportsIdentifier(asset));
      asset.cacheData.isCommonJS = true;
    }
  },

  AssignmentExpression(path, asset) {
    let left = path.node.left;
    if (
      t.isIdentifier(left) &&
      left.name === 'exports' &&
      !path.scope.hasBinding('exports') &&
      !path.scope.getData('shouldWrap')
    ) {
      path.get('left').replaceWith(getExportsIdentifier(asset));
      asset.cacheData.isCommonJS = true;
    }
  },

  UnaryExpression(path) {
    // Replace `typeof module` with "object"
    if (
      path.node.operator === 'typeof' &&
      t.isIdentifier(path.node.argument) &&
      TYPEOF[path.node.argument.name] &&
      !path.scope.hasBinding(path.node.argument.name) &&
      !path.scope.getData('shouldWrap')
    ) {
      path.replaceWith(t.stringLiteral(TYPEOF[path.node.argument.name]));
    }
  },

  CallExpression(path, asset) {
    let {callee, arguments: args} = path.node;
    let ignore =
      args.length !== 1 ||
      !t.isStringLiteral(args[0]) ||
      path.scope.hasBinding('require');

    if (ignore) {
      return;
    }

    if (t.isIdentifier(callee, {name: 'require'})) {
      // Ignore require calls that were ignored earlier.
      if (!asset.dependencies.has(args[0].value)) {
        return;
      }

      // Generate a variable name based on the current asset id and the module name to require.
      // This will be replaced by the final variable name of the resolved asset in the packager.
      // path.replaceWith(getIdentifier(asset, 'require', args[0].value));
      path.replaceWith(
        REQUIRE_CALL_TEMPLATE({
          ID: t.numericLiteral(asset.id),
          SOURCE: t.stringLiteral(args[0].value)
        })
      );
    }

    if (matchesPattern(callee, 'require.resolve')) {
      // path.replaceWith(getIdentifier(asset, 'require_resolve', args[0].value));
      path.replaceWith(
        REQUIRE_RESOLVE_CALL_TEMPLATE({
          ID: t.numericLiteral(asset.id),
          SOURCE: args[0]
        })
      );
    }
  },

  ImportDeclaration(path, asset) {
    // For each specifier, rename the local variables to point to the imported name.
    // This will be replaced by the final variable name of the resolved asset in the packager.
    for (let specifier of path.node.specifiers) {
      if (t.isImportDefaultSpecifier(specifier)) {
        let {expression: init} = IMPORT_TEMPLATE({
          ID: t.numericLiteral(asset.id),
          NAME: t.stringLiteral('default'),
          SOURCE: path.node.source,
          REPLACE_VAR: t.booleanLiteral(true)
        });
        let id = path.scope.generateUidIdentifier(specifier.local.name);

        path.scope.push({id, init});
        path.scope.rename(specifier.local.name, id.name);
      } else if (t.isImportSpecifier(specifier)) {
        let {expression: init} = IMPORT_TEMPLATE({
          ID: t.numericLiteral(asset.id),
          SOURCE: path.node.source,
          NAME: t.stringLiteral(specifier.imported.name),
          REPLACE_VAR: t.booleanLiteral(true)
        });
        let id = path.scope.generateUidIdentifier(specifier.local.name);

        path.scope.push({id, init});
        path.scope.rename(specifier.local.name, id.name);
      } else if (t.isImportNamespaceSpecifier(specifier)) {
        path.scope.push({
          id: specifier.local,
          init: REQUIRE_CALL_TEMPLATE({
            ID: t.numericLiteral(asset.id),
            SOURCE: path.node.source
          }).expression
        });
      }
    }

    path.remove();
  },

  ExportDefaultDeclaration(path, asset) {
    let {declaration} = path.node;
    let identifier = getIdentifier(asset, 'export', 'default');

    // Add assignment to exports object for namespace imports and commonjs.
    path.insertAfter(
      EXPORT_ASSIGN_TEMPLATE({
        EXPORTS: getExportsIdentifier(asset, path.scope),
        NAME: t.identifier('default'),
        LOCAL: identifier
      })
    );

    if (t.isIdentifier(declaration)) {
      // Rename the variable being exported.
      safeRename(path, declaration.name, identifier.name);
      path.remove();
    } else if (t.isExpression(declaration) || !declaration.id) {
      // Declare a variable to hold the exported value.
      path.replaceWith(
        t.variableDeclaration('var', [
          t.variableDeclarator(identifier, t.toExpression(declaration))
        ])
      );
    } else {
      // Rename the declaration to the exported name.
      safeRename(path, declaration.id.name, identifier.name);
      path.replaceWith(declaration);
    }

    asset.cacheData.exports[identifier.name] = 'default';

    // Mark the asset as an ES6 module, so we handle imports correctly in the packager.
    asset.cacheData.isES6Module = true;
  },

  ExportNamedDeclaration(path, asset) {
    let {declaration, source, specifiers} = path.node;

    if (source) {
      for (let specifier of specifiers) {
        let local, exported;

        if (t.isExportDefaultSpecifier(specifier)) {
          local = IMPORT_TEMPLATE({
            ID: t.numericLiteral(asset.id),
            SOURCE: source,
            NAME: t.stringLiteral('default'),
            REPLACE_VAR: t.booleanLiteral(false)
          });
          exported = specifier.exported;
        } else if (t.isExportNamespaceSpecifier(specifier)) {
          local = REQUIRE_CALL_TEMPLATE({
            ID: t.numericLiteral(asset.id),
            SOURCE: source
          });
          exported = specifier.exported;
        } else if (t.isExportSpecifier(specifier)) {
          local = IMPORT_TEMPLATE({
            ID: t.numericLiteral(asset.id),
            SOURCE: source,
            NAME: t.stringLiteral(specifier.local.name),
            REPLACE_VAR: t.booleanLiteral(false)
          });
          exported = specifier.exported;

          path.insertAfter(
            EXPORT_ASSIGN_TEMPLATE({
              EXPORTS: getExportsIdentifier(asset, path.scope),
              NAME: exported,
              LOCAL: local.expression
            })
          );
        }

        // Create a variable to re-export from the imported module.
        path.insertAfter(
          t.variableDeclaration('var', [
            t.variableDeclarator(
              getIdentifier(asset, 'export', exported.name),
              local.expression
            )
          ])
        );

        if (path.scope.hasGlobal('module') || path.scope.hasGlobal('exports')) {
          path.insertAfter(
            EXPORT_ASSIGN_TEMPLATE({
              EXPORTS: getExportsIdentifier(asset, path.scope),
              NAME: t.identifier(exported.name),
              LOCAL: local
            })
          );
        }

        asset.cacheData.exports[getName(asset, 'export', exported.name)] =
          exported.name;
      }

      path.remove();
    } else if (declaration) {
      path.replaceWith(declaration);

      let identifiers = t.isIdentifier(declaration.id)
        ? [declaration.id]
        : t.getBindingIdentifiers(declaration);

      for (let id in identifiers) {
        addExport(asset, path, identifiers[id], identifiers[id]);
      }
    } else if (specifiers.length > 0) {
      for (let specifier of specifiers) {
        addExport(asset, path, specifier.local, specifier.exported);
      }

      path.remove();
    }

    // Mark the asset as an ES6 module, so we handle imports correctly in the packager.
    asset.cacheData.isES6Module = true;
  },

  ExportAllDeclaration(path, asset) {
    asset.cacheData.wildcards.push(path.node.source.value);
    asset.cacheData.isES6Module = true;

    let exportsName = getExportsIdentifier(asset);
    let oldName = t.objectExpression([]);

    // If the export is already defined rename it so we can reassign it.
    // We need to do this because Uglify does not remove pure calls if they use a reassigned variable :
    // var b = {}; b = pureCall(b) // not removed
    // var b$0 = {}; var b = pureCall(b$0) // removed
    if (path.scope.hasBinding(exportsName.name)) {
      oldName = path.scope.generateDeclaredUidIdentifier(exportsName.name);

      path.scope.rename(exportsName.name, oldName.name);
    }

    path.scope.push({
      id: exportsName,
      init: EXPORT_ALL_TEMPLATE({
        OLD_NAME: oldName,
        SOURCE: t.stringLiteral(path.node.source.value),
        ID: t.numericLiteral(asset.id)
      }).expression
    });
    path.remove();
  }
};

function addExport(asset, path, local, exported) {
  let identifier = getIdentifier(asset, 'export', exported.name);
  let assignNode = EXPORT_ASSIGN_TEMPLATE({
    EXPORTS: getExportsIdentifier(asset, path.scope),
    NAME: t.identifier(exported.name),
    LOCAL: identifier
  });

  path.scope
    .getBinding(local.name)
    .constantViolations.concat(path)
    .forEach(path => path.insertAfter(assignNode));

  // Check if this identifier has already been exported.
  // If so, create an export alias for it, otherwise, rename the local variable to an export.
  if (asset.cacheData.exports[local.name]) {
    asset.cacheData.exports[identifier.name] =
      asset.cacheData.exports[local.name];
  } else {
    asset.cacheData.exports[identifier.name] = exported.name;
    // Get all the node paths mutating the export and insert a CommonJS assignement.
    path.scope.rename(local.name, identifier.name);
  }
}

function safeRename(path, from, to) {
  // If the binding that we're renaming is constant, it's safe to rename it.
  // Otherwise, create a new binding that references the original.
  let binding = path.scope.getBinding(from);
  if (binding && binding.constant) {
    path.scope.rename(from, to);
  } else {
    path.insertAfter(
      t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier(to), t.identifier(from))
      ])
    );
  }
}

function getName(asset, type, ...rest) {
  return (
    '$' +
    asset.id +
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

function getIdentifier(asset, type, ...rest) {
  return t.identifier(getName(asset, type, ...rest));
}

function getExportsIdentifier(asset, scope) {
  if (scope && scope.getData('shouldWrap')) {
    return t.identifier('exports');
  } else {
    return getIdentifier(asset, 'exports');
  }
}
