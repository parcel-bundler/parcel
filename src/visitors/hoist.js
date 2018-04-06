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

const EXPORT_ASSIGN_TEMPLATE = template('EXPORTS.NAME = LOCAL');
// const EXPORT_ALL_TEMPLATE = template('Object.assign(EXPORTS, SOURCE)');

module.exports = {
  Program: {
    enter(path, asset) {
      asset.cacheData.exports = {};

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
            shouldWrap = true;
            path.stop();
          }
        },

        ReturnStatement(path) {
          // Wrap in a function if we see a top-level return statement.
          if (path.getFunctionParent().isProgram()) {
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

        // Add variable that represents module.exports if it is referenced.
        if (scope.hasGlobal(getExportsIdentifier(asset).name)) {
          path.unshiftContainer('body', [
            t.variableDeclaration('var', [
              t.variableDeclarator(
                getExportsIdentifier(asset),
                t.objectExpression([])
              )
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
    }
  },

  ThisExpression(path, asset) {
    if (!path.scope.parent && !path.scope.getData('shouldWrap')) {
      path.replaceWith(getExportsIdentifier(asset));
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
    }
  },

  UnaryExpression(path) {
    // Replace `typeof module` with "object"
    if (
      path.node.operator === 'typeof' &&
      t.isIdentifier(path.node.argument) &&
      path.node.argument.name === 'module' &&
      !path.scope.hasBinding('module') &&
      !path.scope.getData('shouldWrap')
    ) {
      path.replaceWith(t.stringLiteral('object'));
    }
  },

  CallExpression(path, asset) {
    let {callee, arguments: args} = path.node;

    let isRequire =
      t.isIdentifier(callee) &&
      callee.name === 'require' &&
      args.length === 1 &&
      t.isStringLiteral(args[0]) &&
      !path.scope.hasBinding('require');

    if (isRequire) {
      // Ignore require calls that were ignored earlier.
      if (!asset.dependencies.has(args[0].value)) {
        return;
      }

      // Generate a variable name based on the current asset id and the module name to require.
      // This will be replaced by the final variable name of the resolved asset in the packager.
      path.replaceWith(getIdentifier(asset, 'require', args[0].value));
    }

    let isRequireResolve =
      matchesPattern(callee, 'require.resolve') &&
      args.length === 1 &&
      t.isStringLiteral(args[0]) &&
      !path.scope.hasBinding('require');

    if (isRequireResolve) {
      path.replaceWith(getIdentifier(asset, 'require_resolve', args[0].value));
    }
  },

  ImportDeclaration(path, asset) {
    // For each specifier, rename the local variables to point to the imported name.
    // This will be replaced by the final variable name of the resolved asset in the packager.
    for (let specifier of path.node.specifiers) {
      if (t.isImportDefaultSpecifier(specifier)) {
        path.scope.rename(
          specifier.local.name,
          getName(asset, 'import', path.node.source.value, 'default')
        );
      } else if (t.isImportSpecifier(specifier)) {
        path.scope.rename(
          specifier.local.name,
          getName(
            asset,
            'import',
            path.node.source.value,
            specifier.imported.name
          )
        );
      } else if (t.isImportNamespaceSpecifier(specifier)) {
        path.scope.rename(
          specifier.local.name,
          getName(asset, 'require', path.node.source.value)
        );
      }
    }

    path.remove();
  },

  ExportDefaultDeclaration(path, asset) {
    let {declaration} = path.node;
    let identifier = getIdentifier(asset, 'export', 'default');

    if (t.isExpression(declaration)) {
      // Declare a variable to hold the exported value.
      path.replaceWith(
        t.variableDeclaration('var', [
          t.variableDeclarator(identifier, declaration)
        ])
      );
    } else {
      // Rename the declaration to the exported name.
      path.replaceWith(declaration);
      path.scope.rename(declaration.id.name, identifier.name);
    }

    // Add assignment to exports object for namespace imports and commonjs.
    path.insertAfter(
      EXPORT_ASSIGN_TEMPLATE({
        EXPORTS: getExportsIdentifier(asset),
        NAME: t.identifier('default'),
        LOCAL: identifier
      })
    );

    asset.cacheData.exports[identifier.name] = 'default';

    // Mark the asset as an ES6 module, so we handle imports correctly in the packager.
    asset.cacheData.isES6Module = true;
  },

  ExportNamedDeclaration(path, asset) {
    let {declaration, source, specifiers} = path.node;

    if (source) {
      for (let specifier of specifiers) {
        // Create a variable to re-export from the imported module.
        path.insertAfter(
          t.variableDeclaration('var', [
            t.variableDeclarator(
              getIdentifier(asset, 'export', specifier.exported.name),
              getIdentifier(asset, 'import', source.value, specifier.local.name)
            )
          ])
        );

        path.insertAfter(
          EXPORT_ASSIGN_TEMPLATE({
            EXPORTS: getExportsIdentifier(asset),
            NAME: t.identifier(specifier.exported.name),
            LOCAL: getIdentifier(
              asset,
              'import',
              source.value,
              specifier.local.name
            )
          })
        );
      }

      path.remove();
    } else if (declaration) {
      path.replaceWith(declaration);

      if (
        t.isFunctionDeclaration(declaration) ||
        t.isClassDeclaration(declaration)
      ) {
        addExport(asset, path, declaration.id, declaration.id);
      } else if (t.isVariableDeclaration(declaration)) {
        for (let d of declaration.declarations) {
          if (t.isIdentifier(d.id)) {
            addExport(asset, path, d.id, d.id);
          } else if (t.isObjectPattern(d.id)) {
            for (let prop of d.id.properties) {
              if (t.isAssignmentPattern(prop.value)) {
                // TODO
              } else if (t.isRestProperty(prop)) {
                // TODO
              }
            }
          } else if (t.isArrayPattern(d.id) && d.id.elements) {
            // TODO
          }
        }
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
    path.remove();

    asset.cacheData.isES6Module = true;
  }
};

function addExport(asset, path, local, exported) {
  asset.cacheData.exports[getName(asset, 'export', exported.name)] =
    exported.name;

  /*path.insertAfter(
    EXPORT_ASSIGN_TEMPLATE({
      EXPORTS: getExportsIdentifier(asset),
      NAME: t.identifier(local.name),
      LOCAL: getIdentifier(asset, 'export', exported.name)
    })
  );*/

  path.scope.rename(local.name, getName(asset, 'export', exported.name));
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

function getExportsIdentifier(asset) {
  return getIdentifier(asset, 'exports');
}
