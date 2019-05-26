// @flow

import type {Asset, MutableAsset} from '@parcel/types';

import * as t from '@babel/types';
import traverse from '@babel/traverse';
import template from '@babel/template';
import rename from './renamer';
import {getName, getIdentifier, getExportIdentifier} from './utils';

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

export function hoist(asset: MutableAsset) {
  if (
    !asset.ast ||
    asset.ast.type !== 'babel' ||
    asset.ast.version !== '7.0.0'
  ) {
    throw new Error('Asset does not have a babel AST');
  }

  asset.ast.isDirty = true;
  traverse(asset.ast.program, VISITOR, null, asset);
}

const VISITOR = {
  Program: {
    enter(path, asset: Asset) {
      traverse.cache.clearScope();
      path.scope.crawl();

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
            asset.meta.isCommonJS = true;
            shouldWrap = true;
            path.stop();
          }
        },

        ReturnStatement(path) {
          // Wrap in a function if we see a top-level return statement.
          if (!path.getFunctionParent()) {
            shouldWrap = true;
            asset.meta.isCommonJS = true;
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
            asset.meta.isCommonJS = true;
            shouldWrap = true;
            path.stop();
          }
        }
      });

      path.scope.setData('shouldWrap', shouldWrap);
    },

    exit(path, asset: Asset) {
      let scope = path.scope;

      if (scope.getData('shouldWrap')) {
        if (asset.meta.isES6Module) {
          path.unshiftContainer('body', [ESMODULE_TEMPLATE()]);
        }

        path.replaceWith(
          t.program([
            WRAPPER_TEMPLATE({
              NAME: getIdentifier(asset, 'exports'),
              BODY: path.node.body
            })
          ])
        );

        asset.symbols.clear();
        asset.meta.isCommonJS = true;
        asset.meta.isES6Module = false;
      } else {
        // Re-crawl scope so we are sure to have all bindings.
        traverse.cache.clearScope();
        scope.crawl();

        // Rename each binding in the top-level scope to something unique.
        for (let name in scope.bindings) {
          if (!name.startsWith('$' + t.toIdentifier(asset.id))) {
            let newName = getName(asset, 'var', name);
            rename(scope, name, newName);
          }
        }

        let exportsIdentifier = getIdentifier(asset, 'exports');

        // Add variable that represents module.exports if it is referenced and not declared.
        if (
          scope.hasGlobal(exportsIdentifier.name) &&
          !scope.hasBinding(exportsIdentifier.name)
        ) {
          scope.push({id: exportsIdentifier, init: t.objectExpression([])});
        }
      }

      path.stop();
    }
  },

  DirectiveLiteral(path) {
    // Remove 'use strict' directives, since modules are concatenated - one strict mode
    // module should not apply to all other modules in the same scope.
    if (path.node.value === 'use strict') {
      path.parentPath.remove();
    }
  },

  MemberExpression(path, asset: Asset) {
    if (path.scope.hasBinding('module') || path.scope.getData('shouldWrap')) {
      return;
    }

    if (t.matchesPattern(path.node, 'module.exports')) {
      path.replaceWith(getExportsIdentifier(asset, path.scope));
      asset.meta.isCommonJS = true;
    }

    if (t.matchesPattern(path.node, 'module.id')) {
      path.replaceWith(t.stringLiteral(asset.id));
    }

    if (t.matchesPattern(path.node, 'module.hot')) {
      path.replaceWith(t.identifier('null'));
    }

    if (t.matchesPattern(path.node, 'module.require') && !asset.env.isNode()) {
      path.replaceWith(t.identifier('null'));
    }

    if (t.matchesPattern(path.node, 'module.bundle')) {
      path.replaceWith(t.identifier('parcelRequire'));
    }
  },

  ReferencedIdentifier(path, asset: Asset) {
    if (
      path.node.name === 'exports' &&
      !path.scope.hasBinding('exports') &&
      !path.scope.getData('shouldWrap')
    ) {
      path.replaceWith(getExportsIdentifier(asset, path.scope));
      asset.meta.isCommonJS = true;
    }

    if (path.node.name === 'global' && !path.scope.hasBinding('global')) {
      path.replaceWith(t.identifier('$parcel$global'));
      if (asset.meta.globals) {
        asset.meta.globals.delete('global');
      }
    }

    let globals = asset.meta.globals;
    if (!globals) {
      return;
    }

    let globalCode = globals.get(path.node.name);
    if (globalCode) {
      let decl = path.scope
        .getProgramParent()
        .path.unshiftContainer('body', [template(globalCode.code)()])[0];

      path.requeue(decl);

      globals.delete(path.node.name);
    }
  },

  ThisExpression(path, asset: Asset) {
    if (!path.scope.parent && !path.scope.getData('shouldWrap')) {
      path.replaceWith(getExportsIdentifier(asset, path.scope));
      asset.meta.isCommonJS = true;
    }
  },

  AssignmentExpression(path, asset: Asset) {
    if (path.scope.hasBinding('exports') || path.scope.getData('shouldWrap')) {
      return;
    }

    let {left, right} = path.node;
    if (t.isIdentifier(left) && left.name === 'exports') {
      path.get('left').replaceWith(getExportsIdentifier(asset, path.scope));
      asset.meta.isCommonJS = true;
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
      path
        .get('left.object')
        .replaceWith(getExportsIdentifier(asset, path.scope));
      path.get('right').replaceWith(identifier);

      // If this is the first assignment, create a binding for the ES6-style export identifier.
      // Otherwise, assign to the existing export binding.
      let scope = path.scope.getProgramParent();
      if (!scope.hasBinding(identifier.name)) {
        asset.symbols.set(name, identifier.name);

        // If in the program scope, create a variable declaration and initialize with the exported value.
        // Otherwise, declare the variable in the program scope, and assign to it here.
        if (path.scope === scope) {
          let [decl] = path.insertBefore(
            t.variableDeclaration('var', [
              t.variableDeclarator(t.clone(identifier), right)
            ])
          );

          scope.registerDeclaration(decl);
        } else {
          scope.push({id: t.clone(identifier)});
          path.insertBefore(
            t.assignmentExpression('=', t.clone(identifier), right)
          );
        }
      } else {
        path.insertBefore(
          t.assignmentExpression('=', t.clone(identifier), right)
        );
      }

      asset.meta.isCommonJS = true;
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

  CallExpression(path, asset: Asset) {
    let {callee, arguments: args} = path.node;
    let isRequire = t.isIdentifier(callee, {name: 'require'});
    let ignore =
      args.length !== 1 ||
      !t.isStringLiteral(args[0]) ||
      path.scope.hasBinding('require');

    if (ignore) {
      if (isRequire) {
        callee.name = 'parcelRequire';
      }
      return;
    }

    if (isRequire) {
      let source = args[0].value;
      // Ignore require calls that were ignored earlier.
      let dep = asset
        .getDependencies()
        .find(dep => dep.moduleSpecifier === source);
      if (!dep) {
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
        dep.meta.shouldWrap = true;
      }

      dep.symbols.set('*', getName(asset, 'require', source));

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

  ImportDeclaration(path, asset: Asset) {
    let dep = asset
      .getDependencies()
      .find(dep => dep.moduleSpecifier === path.node.source.value);
    if (!dep) {
      path.remove();
      return;
    }

    // For each specifier, rename the local variables to point to the imported name.
    // This will be replaced by the final variable name of the resolved asset in the packager.
    for (let specifier of path.node.specifiers) {
      let id = getIdentifier(asset, 'import', specifier.local.name);
      rename(path.scope, specifier.local.name, id.name);

      if (t.isImportDefaultSpecifier(specifier)) {
        dep.symbols.set('default', id.name);
      } else if (t.isImportSpecifier(specifier)) {
        dep.symbols.set(specifier.imported.name, id.name);
      } else if (t.isImportNamespaceSpecifier(specifier)) {
        dep.symbols.set('*', id.name);
      }
    }

    addImport(asset, path);
    path.remove();
  },

  ExportDefaultDeclaration(path, asset: Asset) {
    let {declaration} = path.node;
    let identifier = getExportIdentifier(asset, 'default');
    let name = declaration.id ? declaration.id.name : declaration.name;

    if (hasImport(asset, name) || hasExport(asset, name)) {
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

    if (!asset.symbols.has('default')) {
      asset.symbols.set('default', identifier.name);
    }

    // Mark the asset as an ES6 module, so we handle imports correctly in the packager.
    asset.meta.isES6Module = true;
  },

  ExportNamedDeclaration(path, asset: Asset) {
    let {declaration, source, specifiers} = path.node;

    if (source) {
      for (let specifier of specifiers) {
        let exported = specifier.exported;
        let imported;

        if (t.isExportDefaultSpecifier(specifier)) {
          imported = 'default';
        } else if (t.isExportNamespaceSpecifier(specifier)) {
          imported = '*';
        } else if (t.isExportSpecifier(specifier)) {
          imported = specifier.local.name;
        }

        let id = getIdentifier(asset, 'import', exported.name);
        asset.symbols.set(exported.name, id.name);

        let dep = asset
          .getDependencies()
          .find(dep => dep.moduleSpecifier === source.value);
        if (dep && imported) {
          dep.symbols.set(imported, id.name);
          dep.isWeak = true;
        }

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

      if (t.isIdentifier(declaration.id)) {
        addExport(asset, path, declaration.id, declaration.id);
      } else {
        let identifiers = t.getBindingIdentifiers(declaration);
        for (let id of Object.keys(identifiers)) {
          addExport(asset, path, identifiers[id], identifiers[id]);
        }
      }
    } else if (specifiers.length > 0) {
      for (let specifier of specifiers) {
        addExport(asset, path, specifier.local, specifier.exported);
      }

      path.remove();
    }

    // Mark the asset as an ES6 module, so we handle imports correctly in the packager.
    asset.meta.isES6Module = true;
  },

  ExportAllDeclaration(path, asset: Asset) {
    let dep = asset
      .getDependencies()
      .find(dep => dep.moduleSpecifier === path.node.source.value);
    if (dep) {
      dep.symbols.set('*', '*');
    }

    asset.meta.isES6Module = true;

    path.replaceWith(
      EXPORT_ALL_TEMPLATE({
        OLD_NAME: getExportsIdentifier(asset, path.scope),
        SOURCE: t.stringLiteral(path.node.source.value),
        ID: t.stringLiteral(asset.id)
      })
    );
  }
};

function addImport(asset: Asset, path) {
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

function addExport(asset: Asset, path, local, exported) {
  let scope = path.scope.getProgramParent();
  let identifier = getExportIdentifier(asset, exported.name);

  if (hasImport(asset, local.name)) {
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

  if (!asset.symbols.has(exported.name)) {
    asset.symbols.set(exported.name, identifier.name);
  }

  rename(scope, local.name, identifier.name);

  constantViolations.forEach(path => path.insertAfter(t.cloneDeep(assignNode)));
}

function hasImport(asset: Asset, id) {
  for (let dep of asset.getDependencies()) {
    if (new Set(dep.symbols.values()).has(id)) {
      return true;
    }
  }

  return false;
}

function hasExport(asset: Asset, id) {
  return new Set(asset.symbols.values()).has(id);
}

function safeRename(path, asset: Asset, from, to) {
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

function getExportsIdentifier(asset: Asset, scope) {
  if (scope.getProgramParent().getData('shouldWrap')) {
    return t.identifier('exports');
  } else {
    let id = getIdentifier(asset, 'exports');
    if (!scope.hasBinding(id.name)) {
      scope.getProgramParent().addGlobal(id);
    }

    return id;
  }
}
