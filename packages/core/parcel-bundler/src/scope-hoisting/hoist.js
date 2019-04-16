const path = require('path');
const mm = require('micromatch');
const t = require('@babel/types');
const template = require('@babel/template').default;
const rename = require('./renamer');
const {getName, getIdentifier, getExportIdentifier} = require('./utils');

const WRAPPER_TEMPLATE = template(`
  var NAME = (function () {
    var exports = this;
    var module = {exports: this};
    BODY;
    return module.exports;
  }).call({});
`);

const ESMODULE_TEMPLATE = template(`exports.__esModule = true;`);

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

function hasSideEffects(asset, {sideEffects} = asset._package) {
  switch (typeof sideEffects) {
    case 'undefined':
      return true;
    case 'boolean':
      return sideEffects;
    case 'string':
      return mm.isMatch(
        path.relative(asset._package.pkgdir, asset.name),
        sideEffects,
        {matchBase: true}
      );
    case 'object':
      return sideEffects.some(sideEffects =>
        hasSideEffects(asset, {sideEffects})
      );
  }
}

module.exports = {
  Program: {
    enter(path, asset) {
      path.scope.crawl();

      asset.cacheData.imports = asset.cacheData.imports || Object.create(null);
      asset.cacheData.exports = asset.cacheData.exports || Object.create(null);
      asset.cacheData.wildcards = asset.cacheData.wildcards || [];
      asset.cacheData.sideEffects = asset._package && hasSideEffects(asset);

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
          if (!path.getFunctionParent()) {
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
        if (asset.cacheData.isES6Module) {
          path.unshiftContainer('body', [ESMODULE_TEMPLATE()]);
        }

        path.replaceWith(
          t.program([
            WRAPPER_TEMPLATE({
              NAME: getExportsIdentifier(asset),
              BODY: path.node.body
            })
          ])
        );

        asset.cacheData.exports = {};
        asset.cacheData.isCommonJS = true;
        asset.cacheData.isES6Module = false;
      } else {
        // Re-crawl scope so we are sure to have all bindings.
        scope.crawl();

        // Rename each binding in the top-level scope to something unique.
        for (let name in scope.bindings) {
          if (!name.startsWith('$' + t.toIdentifier(asset.id))) {
            let newName = getName(asset, 'var', name);
            rename(scope, name, newName);
          }
        }

        let exportsIdentifier = getExportsIdentifier(asset);

        // Add variable that represents module.exports if it is referenced and not declared.
        if (
          scope.hasGlobal(exportsIdentifier.name) &&
          !scope.hasBinding(exportsIdentifier.name)
        ) {
          scope.push({id: exportsIdentifier, init: t.objectExpression([])});
        }
      }

      path.stop();
      asset.isAstDirty = true;
    }
  },

  DirectiveLiteral(path) {
    // Remove 'use strict' directives, since modules are concatenated - one strict mode
    // module should not apply to all other modules in the same scope.
    if (path.node.value === 'use strict') {
      path.parentPath.remove();
    }
  },

  MemberExpression(path, asset) {
    if (path.scope.hasBinding('module') || path.scope.getData('shouldWrap')) {
      return;
    }

    if (t.matchesPattern(path.node, 'module.exports')) {
      path.replaceWith(getExportsIdentifier(asset));
      asset.cacheData.isCommonJS = true;
    }

    if (t.matchesPattern(path.node, 'module.id')) {
      path.replaceWith(t.stringLiteral(asset.id));
    }

    if (t.matchesPattern(path.node, 'module.hot')) {
      path.replaceWith(t.identifier('null'));
    }

    if (t.matchesPattern(path.node, 'module.bundle')) {
      path.replaceWith(t.identifier('require'));
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

    if (path.node.name === 'global' && !path.scope.hasBinding('global')) {
      path.replaceWith(t.identifier('$parcel$global'));
      asset.globals.delete('global');
    }

    let globalCode = asset.globals.get(path.node.name);
    if (globalCode) {
      path.scope
        .getProgramParent()
        .path.unshiftContainer('body', [template(globalCode)()]);

      asset.globals.delete(path.node.name);
    }
  },

  ThisExpression(path, asset) {
    if (!path.scope.parent && !path.scope.getData('shouldWrap')) {
      path.replaceWith(getExportsIdentifier(asset));
      asset.cacheData.isCommonJS = true;
    }
  },

  AssignmentExpression(path, asset) {
    if (path.scope.hasBinding('exports') || path.scope.getData('shouldWrap')) {
      return;
    }

    let {left, right} = path.node;
    if (t.isIdentifier(left) && left.name === 'exports') {
      path.get('left').replaceWith(getExportsIdentifier(asset));
      asset.cacheData.isCommonJS = true;
    }

    // If we can statically evaluate the name of a CommonJS export, create an ES6-style export for it.
    // This allows us to remove the CommonJS export object completely in many cases.
    if (
      t.isMemberExpression(left) &&
      t.isIdentifier(left.object, {name: 'exports'}) &&
      ((t.isIdentifier(left.property) && !left.computed) ||
        t.isStringLiteral(left.property))
    ) {
      let name = t.isIdentifier(left.property)
        ? left.property.name
        : left.property.value;
      let identifier = getExportIdentifier(asset, name);

      // Replace the CommonJS assignment with a reference to the ES6 identifier.
      path.get('left.object').replaceWith(getExportsIdentifier(asset));
      path.get('right').replaceWith(identifier);

      // If this is the first assignment, create a binding for the ES6-style export identifier.
      // Otherwise, assign to the existing export binding.
      let scope = path.scope.getProgramParent();
      if (!scope.hasBinding(identifier.name)) {
        asset.cacheData.exports[name] = identifier.name;
        let [decl] = path.insertBefore(
          t.variableDeclaration('var', [
            t.variableDeclarator(t.clone(identifier), right)
          ])
        );

        scope.registerDeclaration(decl);
      } else {
        path.insertBefore(
          t.assignmentExpression('=', t.clone(identifier), right)
        );
      }

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
      let source = args[0].value;
      // Ignore require calls that were ignored earlier.
      if (!asset.dependencies.has(source)) {
        return;
      }

      // If this require call does not occur in the top-level, e.g. in a function
      // or inside an if statement, or if it might potentially happen conditionally,
      // the module must be wrapped in a function so that the module execution order is correct.
      let parent = path.getStatementParent().parentPath;
      let bail = path.findParent(
        p =>
          p.isConditionalExpression() ||
          p.isLogicalExpression() ||
          p.isSequenceExpression()
      );
      if (!parent.isProgram() || bail) {
        asset.dependencies.get(source).shouldWrap = true;
      }

      asset.cacheData.imports['$require$' + source] = [source, '*'];

      // Generate a variable name based on the current asset id and the module name to require.
      // This will be replaced by the final variable name of the resolved asset in the packager.
      path.replaceWith(
        REQUIRE_CALL_TEMPLATE({
          ID: t.stringLiteral(asset.id),
          SOURCE: t.stringLiteral(args[0].value)
        })
      );
    }

    if (t.matchesPattern(callee, 'require.resolve')) {
      path.replaceWith(
        REQUIRE_RESOLVE_CALL_TEMPLATE({
          ID: t.stringLiteral(asset.id),
          SOURCE: args[0]
        })
      );
    }
  },

  ImportDeclaration(path, asset) {
    // For each specifier, rename the local variables to point to the imported name.
    // This will be replaced by the final variable name of the resolved asset in the packager.
    for (let specifier of path.node.specifiers) {
      let id = getIdentifier(asset, 'import', specifier.local.name);
      rename(path.scope, specifier.local.name, id.name);

      if (t.isImportDefaultSpecifier(specifier)) {
        asset.cacheData.imports[id.name] = [path.node.source.value, 'default'];
      } else if (t.isImportSpecifier(specifier)) {
        asset.cacheData.imports[id.name] = [
          path.node.source.value,
          specifier.imported.name
        ];
      } else if (t.isImportNamespaceSpecifier(specifier)) {
        asset.cacheData.imports[id.name] = [path.node.source.value, '*'];
      }
    }

    addImport(asset, path);
    path.remove();
  },

  ExportDefaultDeclaration(path, asset) {
    let {declaration} = path.node;
    let identifier = getExportIdentifier(asset, 'default');

    let name = declaration.id ? declaration.id.name : declaration.name;

    if (asset.cacheData.imports[name]) {
      asset.cacheData.exports['default'] = asset.cacheData.imports[name];
      identifier = t.identifier(name);
    }

    if (hasExport(asset, name)) {
      identifier = t.identifier(name);
    }

    // Add assignment to exports object for namespace imports and commonjs.
    path.insertAfter(
      EXPORT_ASSIGN_TEMPLATE({
        EXPORTS: getExportsIdentifier(asset, path.scope),
        NAME: t.identifier('default'),
        LOCAL: t.clone(identifier)
      })
    );

    if (t.isIdentifier(declaration)) {
      // Rename the variable being exported.
      safeRename(path, asset, declaration.name, identifier.name);
      path.remove();
    } else if (t.isExpression(declaration) || !declaration.id) {
      // Declare a variable to hold the exported value.
      path.replaceWith(
        t.variableDeclaration('var', [
          t.variableDeclarator(identifier, t.toExpression(declaration))
        ])
      );

      path.scope.registerDeclaration(path);
    } else {
      // Rename the declaration to the exported name.
      safeRename(path, asset, declaration.id.name, identifier.name);
      path.replaceWith(declaration);
    }

    if (!asset.cacheData.exports['default']) {
      asset.cacheData.exports['default'] = identifier.name;
    }

    // Mark the asset as an ES6 module, so we handle imports correctly in the packager.
    asset.cacheData.isES6Module = true;
  },

  ExportNamedDeclaration(path, asset) {
    let {declaration, source, specifiers} = path.node;

    if (source) {
      for (let specifier of specifiers) {
        let exported = specifier.exported;

        if (t.isExportDefaultSpecifier(specifier)) {
          asset.cacheData.exports[exported.name] = [source.value, 'default'];
        } else if (t.isExportNamespaceSpecifier(specifier)) {
          asset.cacheData.exports[exported.name] = [source.value, '*'];
        } else if (t.isExportSpecifier(specifier)) {
          asset.cacheData.exports[exported.name] = [
            source.value,
            specifier.local.name
          ];
        }

        let id = getIdentifier(asset, 'import', exported.name);
        asset.cacheData.imports[id.name] =
          asset.cacheData.exports[exported.name];

        path.insertAfter(
          EXPORT_ASSIGN_TEMPLATE({
            EXPORTS: getExportsIdentifier(asset, path.scope),
            NAME: exported,
            LOCAL: id
          })
        );
      }

      addImport(asset, path);
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

    path.replaceWith(
      EXPORT_ALL_TEMPLATE({
        OLD_NAME: getExportsIdentifier(asset),
        SOURCE: t.stringLiteral(path.node.source.value),
        ID: t.stringLiteral(asset.id)
      })
    );
  }
};

function addImport(asset, path) {
  // Replace with a $parcel$require call so we know where to insert side effects.
  let requireCall = REQUIRE_CALL_TEMPLATE({
    ID: t.stringLiteral(asset.id),
    SOURCE: t.stringLiteral(path.node.source.value)
  });

  // Hoist the call to the top of the file.
  let lastImport = path.scope.getData('hoistedImport');
  if (lastImport) {
    [lastImport] = lastImport.insertAfter(requireCall);
  } else {
    [lastImport] = path.parentPath.unshiftContainer('body', [requireCall]);
  }

  path.scope.setData('hoistedImport', lastImport);
}

function addExport(asset, path, local, exported) {
  let scope = path.scope.getProgramParent();
  let identifier = getExportIdentifier(asset, exported.name);

  if (asset.cacheData.imports[local.name]) {
    asset.cacheData.exports[exported.name] =
      asset.cacheData.imports[local.name];
    identifier = t.identifier(local.name);
  }

  if (hasExport(asset, local.name)) {
    identifier = t.identifier(local.name);
  }

  let assignNode = EXPORT_ASSIGN_TEMPLATE({
    EXPORTS: getExportsIdentifier(asset, scope),
    NAME: t.identifier(exported.name),
    LOCAL: identifier
  });

  let binding = scope.getBinding(local.name);
  let constantViolations = binding
    ? binding.constantViolations.concat(path)
    : [path];

  if (!asset.cacheData.exports[exported.name]) {
    asset.cacheData.exports[exported.name] = identifier.name;
  }

  try {
    rename(scope, local.name, identifier.name);
  } catch (e) {
    throw new Error('export ' + e.message);
  }

  constantViolations.forEach(path => path.insertAfter(t.cloneDeep(assignNode)));
}

function hasExport(asset, name) {
  let exports = asset.cacheData.exports;
  return Object.keys(exports).some(k => exports[k] === name);
}

function safeRename(path, asset, from, to) {
  if (from === to) {
    return;
  }

  // If the binding that we're renaming is constant, it's safe to rename it.
  // Otherwise, create a new binding that references the original.
  let binding = path.scope.getBinding(from);
  if (binding && binding.constant) {
    rename(path.scope, from, to);
  } else {
    let [decl] = path.insertAfter(
      t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier(to), t.identifier(from))
      ])
    );

    path.scope.getBinding(from).reference(decl.get('declarations.0.init'));
    path.scope.registerDeclaration(decl);
  }
}

function getExportsIdentifier(asset, scope) {
  if (scope && scope.getData('shouldWrap')) {
    return t.identifier('exports');
  } else {
    return getIdentifier(asset, 'exports');
  }
}
