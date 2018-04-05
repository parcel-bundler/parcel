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

const BREAK_COMMON_JS = true;

const EXPORTS_TEMPLATE = template('var NAME = {}');
const EXPORT_ALL_TEMPLATE = template('Object.assign(EXPORTS, SOURCE)');
const NAMED_EXPORT_TEMPLATE = BREAK_COMMON_JS
  ? template('var NAME = INIT')
  : template('var NAME = (EXPORTS.BINDING = INIT)');

module.exports = {
  Program: {
    enter(path) {
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
        let namedExport = getNamedExportIdentifierName(asset);

        // Re-crawl scope so we are sure to have all bindings.
        scope.crawl();

        // Rename each binding in the top-level scope to something unique.
        for (let name in scope.bindings) {
          if (name.indexOf(namedExport) === -1) {
            let newName = '$' + asset.id + '$var$' + name;
            scope.rename(name, newName);
          }
        }

        // Add variable that represents module.exports
        path.unshiftContainer('body', [
          EXPORTS_TEMPLATE({
            NAME: getExportsIdentifier(asset)
          })
        ]);
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
      let name = '$' + asset.id + '$require$' + t.toIdentifier(args[0].value);
      path.replaceWith(t.identifier(name));
    }

    let isRequireResolve =
      matchesPattern(callee, 'require.resolve') &&
      args.length === 1 &&
      t.isStringLiteral(args[0]) &&
      !path.scope.hasBinding('require');

    if (isRequireResolve) {
      let name =
        '$' + asset.id + '$require_resolve$' + t.toIdentifier(args[0].value);
      path.replaceWith(t.identifier(name));
    }
  },
  ExportAllDeclaration(path, asset) {
    if (BREAK_COMMON_JS) {
      path.replaceWith(
        t.identifier(
          '$' +
            asset.id +
            '$expand_exports$' +
            t.toIdentifier(path.node.source.value)
        )
      );
    } else {
      path.replaceWith(
        EXPORT_ALL_TEMPLATE({
          EXPORTS: t.identifier('$' + asset.id + '$exports'),
          SOURCE: t.identifier(
            '$' +
              asset.id +
              '$require$' +
              t.toIdentifier(path.node.source.value)
          )
        })
      );
    }
  },
  ImportDeclaration(path, asset) {
    let {source, specifiers} = path.node;

    if (source && specifiers.length > 0) {
      if (BREAK_COMMON_JS) {
        specifiers.forEach(specifier =>
          path.scope.rename(
            specifier.local.name,
            '$' +
              asset.id +
              '$named_import$' +
              t.toIdentifier(source.value) +
              '$' +
              specifier.imported.name
          )
        );
        path.remove();
      } else {
        path.replaceWith(
          t.variableDeclaration(
            'var',
            specifiers.map(specifier =>
              t.variableDeclarator(
                specifier.local,
                t.memberExpression(
                  t.identifier(
                    '$' + asset.id + '$require$' + t.toIdentifier(source.value)
                  ),
                  specifier.imported
                )
              )
            )
          )
        );
      }
    }
  },
  ExportNamedDeclaration(path, asset) {
    let {declaration, source, specifiers} = path.node;

    if (!source) {
      let declarations;

      if (declaration) {
        declarations = declaration.declarations.map(decl => {
          asset.exports.push(decl.id.name);

          return getNamedExportVarDecl(asset, decl.id, decl.init);
        });
      } else if (specifiers.length > 0) {
        declarations = t.variableDeclaration(
          'var',
          specifiers.map(specifier => {
            asset.exports.push(specifier.exported.name);

            return getNamedExportVarDecl(
              asset,
              specifier.exported,
              specifier.local
            );
          })
        );
      }

      if (declarations.length) {
        path.replaceWith(t.variableDeclaration('var', declarations));
      }
    }
  }
};

function getNamedExportVarDecl(asset, name, init) {
  let varName = getNamedExportIdentifierName(asset, name);

  return NAMED_EXPORT_TEMPLATE({
    NAME: t.identifier(varName),
    EXPORTS: getExportsIdentifier(asset),
    BINDING: name,
    INIT: init
  }).declarations[0];
}

function getNamedExportIdentifierName(asset, name = '') {
  name = t.isIdentifier(name) ? name.name : name;

  return '$' + asset.id + '$named_export$' + name;
}
function getExportsIdentifier(asset) {
  return t.identifier('$' + asset.id + '$exports');
}
