// @flow

import type {AST, MutableAsset} from '@parcel/types';
import type {Visitor, NodePath} from '@babel/traverse';
import type {
  ExportNamedDeclaration,
  ImportDeclaration,
  VariableDeclaration,
  Identifier,
  Expression,
  LVal,
  StringLiteral,
  Statement,
  CallExpression,
} from '@babel/types';

import * as t from '@babel/types';
import {
  isAssignmentExpression,
  isClassDeclaration,
  isExportDefaultSpecifier,
  isExportNamespaceSpecifier,
  isExportSpecifier,
  isExpression,
  isFunctionDeclaration,
  isIdentifier,
  isImportDefaultSpecifier,
  isImportNamespaceSpecifier,
  isImportSpecifier,
  isMemberExpression,
  isStringLiteral,
  isUnaryExpression,
} from '@babel/types';
import traverse from '@babel/traverse';
import template from '@babel/template';
import nullthrows from 'nullthrows';
import invariant from 'assert';
import rename from './renamer';
import {
  convertBabelLoc,
  getName,
  getIdentifier,
  getExportIdentifier,
} from './utils';

const WRAPPER_TEMPLATE = template.statement<
  {|NAME: LVal, BODY: Array<Statement>|},
  VariableDeclaration,
>(`
  var NAME = (function () {
    var exports = this;
    var module = {exports: this};
    BODY;
    return module.exports;
  }).call({});
`);

const ESMODULE_TEMPLATE = template.statement<null, Statement>(
  `exports.__esModule = true;`,
);

const EXPORT_ASSIGN_TEMPLATE = template.statement<
  {|EXPORTS: Identifier, NAME: Identifier, LOCAL: Expression|},
  Statement,
>('EXPORTS.NAME = LOCAL;');
const EXPORT_ALL_TEMPLATE = template.statement<
  {|OLD_NAME: Identifier, ID: StringLiteral, SOURCE: StringLiteral|},
  Statement,
>('$parcel$exportWildcard(OLD_NAME, $parcel$require(ID, SOURCE));');
const REQUIRE_CALL_TEMPLATE = template.expression<
  {|ID: StringLiteral, SOURCE: StringLiteral|},
  CallExpression,
>('$parcel$require(ID, SOURCE)');
const REQUIRE_RESOLVE_CALL_TEMPLATE = template.expression<
  {|ID: StringLiteral, SOURCE: StringLiteral|},
  CallExpression,
>('$parcel$require$resolve(ID, SOURCE)');
const TYPEOF = {
  module: 'object',
  require: 'function',
};

export function hoist(asset: MutableAsset, ast: AST) {
  if (ast.type !== 'babel' || ast.version !== '7.0.0') {
    throw new Error('Asset does not have a babel AST');
  }

  traverse(ast.program, VISITOR, null, asset);
  asset.setAST(ast);
}

const VISITOR: Visitor<MutableAsset> = {
  Program: {
    enter(path, asset: MutableAsset) {
      asset.meta.id = asset.id;
      asset.meta.exportsIdentifier = getName(asset, 'exports');

      traverse.cache.clearScope();
      path.scope.crawl();

      let shouldWrap = false;
      path.traverse({
        CallExpression(path) {
          // If we see an `eval` call, wrap the module in a function.
          // Otherwise, local variables accessed inside the eval won't work.
          let callee = path.node.callee;
          if (
            isIdentifier(callee) &&
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
                  t.identifier('exports'),
                ),
              ),
            );
            path.stop();
          }
        },

        ReferencedIdentifier(path) {
          let {parent, node} = path;
          // We must wrap if `module` is referenced as a free identifier rather
          // than a statically resolvable member expression.
          if (
            node.name === 'module' &&
            (!isMemberExpression(parent) || parent.computed) &&
            !(isUnaryExpression(parent) && parent.operator === 'typeof') &&
            !path.scope.hasBinding('module') &&
            !path.scope.getData('shouldWrap')
          ) {
            asset.meta.isCommonJS = true;
            shouldWrap = true;
            path.stop();
          }

          // We must disable resolving $..$exports.foo if `exports`
          // is referenced as a free identifier rather
          // than a statically resolvable member expression.
          if (
            node.name === 'exports' &&
            !isAssignmentExpression(parent, {left: node}) &&
            (!isMemberExpression(parent) ||
              !(isIdentifier(parent.property) && !parent.computed) ||
              isStringLiteral(parent.property)) &&
            !path.scope.hasBinding('exports') &&
            !path.scope.getData('shouldWrap')
          ) {
            asset.meta.isCommonJS = true;
            asset.meta.resolveExportsBailedOut = true;
          }
        },

        MemberExpression(path) {
          let {node, parent} = path;

          // We must disable resolving $..$exports.foo if `exports`
          // is referenced as a free identifier rather
          // than a statically resolvable member expression.
          if (
            t.matchesPattern(node, 'module.exports') &&
            !isAssignmentExpression(parent, {left: node}) &&
            (!isMemberExpression(parent) ||
              !(isIdentifier(parent.property) && !parent.computed) ||
              isStringLiteral(parent.property)) &&
            !path.scope.hasBinding('module') &&
            !path.scope.getData('shouldWrap')
          ) {
            asset.meta.resolveExportsBailedOut = true;
          }
        },
      });

      path.scope.setData('shouldWrap', shouldWrap);
      path.scope.setData('cjsExportsReassigned', false);
    },

    exit(path, asset: MutableAsset) {
      let scope = path.scope;

      if (scope.getData('shouldWrap')) {
        if (asset.meta.isES6Module) {
          path.unshiftContainer('body', [ESMODULE_TEMPLATE()]);
        }

        path.replaceWith(
          t.program([
            WRAPPER_TEMPLATE({
              NAME: getIdentifier(asset, 'exports'),
              BODY: path.node.body,
            }),
          ]),
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
    },
  },

  DirectiveLiteral(path) {
    // Remove 'use strict' directives, since modules are concatenated - one strict mode
    // module should not apply to all other modules in the same scope.
    if (path.node.value === 'use strict') {
      path.parentPath.remove();
    }
  },

  MemberExpression(path, asset: MutableAsset) {
    if (path.scope.hasBinding('module') || path.scope.getData('shouldWrap')) {
      return;
    }

    if (t.matchesPattern(path.node, 'module.exports')) {
      let exportsId = getExportsIdentifier(asset, path.scope);
      path.replaceWith(exportsId);
      asset.meta.isCommonJS = true;
      asset.symbols.set('*', exportsId.name, convertBabelLoc(path.node.loc));

      if (!path.scope.hasBinding(exportsId.name)) {
        path.scope
          .getProgramParent()
          .push({id: exportsId, init: t.objectExpression([])});
      }
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

  ReferencedIdentifier(path, asset: MutableAsset) {
    if (
      path.node.name === 'exports' &&
      !path.scope.hasBinding('exports') &&
      !path.scope.getData('shouldWrap')
    ) {
      path.replaceWith(getCJSExportsIdentifier(asset, path.scope));
      asset.meta.isCommonJS = true;
    }

    if (path.node.name === 'global' && !path.scope.hasBinding('global')) {
      path.replaceWith(t.identifier('$parcel$global'));
    }
  },

  ThisExpression(path, asset: MutableAsset) {
    if (!path.scope.parent && !path.scope.getData('shouldWrap')) {
      if (asset.meta.isES6Module) {
        path.replaceWith(t.identifier('undefined'));
      } else {
        path.replaceWith(getExportsIdentifier(asset, path.scope));
        asset.meta.isCommonJS = true;
      }
    }
  },

  AssignmentExpression(path, asset: MutableAsset) {
    if (path.scope.getData('shouldWrap')) {
      return;
    }

    let {left, right} = path.node;

    // Match module.exports = expression; assignments and replace with a variable declaration
    // if this is the first assignemnt. This avoids the extra empty object assignment in many cases.
    //
    // TODO: Re-introduce this when it can handle both exports and module.exports concurrently
    //
    // if (
    //   t.matchesPattern(left, 'module.exports') &&
    //   !path.scope.hasBinding('module')
    // ) {
    //   let exportsId = getExportsIdentifier(asset, path.scope);
    //   asset.meta.isCommonJS = true;
    //   asset.symbols.set('*', exportsId.name);

    //   if (
    //     path.scope === path.scope.getProgramParent() &&
    //     !path.scope.getBinding(exportsId.name) &&
    //     path.parentPath.isStatement()
    //   ) {
    //     let [decl] = path.parentPath.replaceWith(
    //       t.variableDeclaration('var', [
    //         t.variableDeclarator(exportsId, right),
    //       ]),
    //     );

    //     path.scope.registerDeclaration(decl);
    //   }
    // }

    if (
      isIdentifier(left) &&
      left.name === 'exports' &&
      !path.scope.hasBinding('exports')
    ) {
      path.scope.getProgramParent().setData('cjsExportsReassigned', true);
      path
        .get<NodePath<LVal>>('left')
        .replaceWith(getCJSExportsIdentifier(asset, path.scope));
      asset.meta.isCommonJS = true;
    }

    // If we can statically evaluate the name of a CommonJS export, create an ES6-style export for it.
    // This allows us to remove the CommonJS export object completely in many cases.
    if (
      isMemberExpression(left) &&
      ((isIdentifier(left.object, {name: 'exports'}) &&
        !path.scope.hasBinding('exports')) ||
        (t.matchesPattern(left.object, 'module.exports') &&
          !path.scope.hasBinding('module'))) &&
      ((isIdentifier(left.property) && !left.computed) ||
        isStringLiteral(left.property))
    ) {
      let name = isIdentifier(left.property)
        ? left.property.name
        : left.property.value;
      let identifier = getExportIdentifier(asset, name);

      // Replace the CommonJS assignment with a reference to the ES6 identifier.
      path
        .get<NodePath<Identifier>>('left.object')
        .replaceWith(getExportsIdentifier(asset, path.scope));
      path.get('right').replaceWith(identifier);

      // If this is the first assignment, create a binding for the ES6-style export identifier.
      // Otherwise, assign to the existing export binding.
      let scope = path.scope.getProgramParent();
      if (!scope.hasBinding(identifier.name)) {
        asset.symbols.set(
          name,
          identifier.name,
          convertBabelLoc(path.node.loc),
        );

        // If in the program scope, create a variable declaration and initialize with the exported value.
        // Otherwise, declare the variable in the program scope, and assign to it here.
        if (path.scope === scope) {
          let [decl] = path.insertBefore(
            t.variableDeclaration('var', [
              t.variableDeclarator(t.clone(identifier), right),
            ]),
          );

          scope.registerDeclaration(decl);
        } else {
          scope.push({id: t.clone(identifier)});
          path.insertBefore(
            t.expressionStatement(
              t.assignmentExpression('=', t.clone(identifier), right),
            ),
          );
        }
      } else {
        path.insertBefore(
          t.expressionStatement(
            t.assignmentExpression('=', t.clone(identifier), right),
          ),
        );
      }

      asset.meta.isCommonJS = true;
    }
  },

  UnaryExpression(path) {
    // Replace `typeof module` with "object"
    if (
      path.node.operator === 'typeof' &&
      isIdentifier(path.node.argument) &&
      TYPEOF[path.node.argument.name] &&
      !path.scope.hasBinding(path.node.argument.name) &&
      !path.scope.getData('shouldWrap')
    ) {
      path.replaceWith(t.stringLiteral(TYPEOF[path.node.argument.name]));
    }
  },

  CallExpression(path, asset: MutableAsset) {
    let {callee, arguments: args} = path.node;
    let isRequire = isIdentifier(callee, {name: 'require'});
    let [arg] = args;
    if (
      args.length !== 1 ||
      !isStringLiteral(arg) ||
      path.scope.hasBinding('require')
    ) {
      return;
    }

    if (isRequire) {
      let source = arg.value;
      // Ignore require calls that were ignored earlier.
      let dep = asset
        .getDependencies()
        .find(dep => dep.moduleSpecifier === source);
      if (!dep) {
        return;
      }

      asset.meta.isCommonJS = true;

      // If this require call does not occur in the top-level, e.g. in a function
      // or inside an if statement, or if it might potentially happen conditionally,
      // the module must be wrapped in a function so that the module execution order is correct.
      let parent = path.getStatementParent().parentPath;
      let bail = path.findParent(
        p => p.isConditionalExpression() || p.isLogicalExpression(),
      );
      if (!parent.isProgram() || bail) {
        dep.meta.shouldWrap = true;
      }

      dep.meta.isCommonJS = true;
      dep.symbols.set(
        '*',
        getName(asset, 'require', source),
        convertBabelLoc(path.node.loc),
      );

      // Generate a variable name based on the current asset id and the module name to require.
      // This will be replaced by the final variable name of the resolved asset in the packager.
      let replacement = REQUIRE_CALL_TEMPLATE({
        ID: t.stringLiteral(asset.id),
        SOURCE: t.stringLiteral(arg.value),
      });
      replacement.loc = path.node.loc;
      path.replaceWith(replacement);
    }

    if (t.matchesPattern(callee, 'require.resolve')) {
      let replacement = REQUIRE_RESOLVE_CALL_TEMPLATE({
        ID: t.stringLiteral(asset.id),
        SOURCE: arg,
      });
      replacement.loc = path.node.loc;
      path.replaceWith(replacement);
    }
  },

  ImportDeclaration(path, asset: MutableAsset) {
    let dep = asset
      .getDependencies()
      .find(dep => dep.moduleSpecifier === path.node.source.value);

    // For each specifier, rename the local variables to point to the imported name.
    // This will be replaced by the final variable name of the resolved asset in the packager.
    for (let specifier of path.node.specifiers) {
      let id = getIdentifier(asset, 'import', specifier.local.name);

      if (dep) {
        let imported: string;
        if (isImportDefaultSpecifier(specifier)) {
          imported = 'default';
        } else if (isImportSpecifier(specifier)) {
          imported = specifier.imported.name;
        } else if (isImportNamespaceSpecifier(specifier)) {
          imported = '*';
        } else {
          throw new Error('Unknown import construct');
        }

        let existing = dep.symbols.get(imported)?.local;
        if (existing) {
          id.name = existing;
        } else {
          dep.symbols.set(imported, id.name, convertBabelLoc(specifier.loc));
        }
      }
      rename(path.scope, specifier.local.name, id.name);
    }

    addImport(asset, path);
    path.remove();
  },

  ExportDefaultDeclaration(path, asset: MutableAsset) {
    let {declaration, loc} = path.node;
    let identifier = getExportIdentifier(asset, 'default');
    let name: ?string;
    if (
      (isClassDeclaration(declaration) || isFunctionDeclaration(declaration)) &&
      declaration.id
    ) {
      name = declaration.id.name;
    } else if (isIdentifier(declaration)) {
      name = declaration.name;
    }

    if (name && (hasImport(asset, name) || hasExport(asset, name))) {
      identifier = t.identifier(name);
    }

    // Add assignment to exports object for namespace imports and commonjs.
    path.insertAfter(
      EXPORT_ASSIGN_TEMPLATE({
        EXPORTS: getExportsIdentifier(asset, path.scope),
        NAME: t.identifier('default'),
        LOCAL: t.clone(identifier),
      }),
    );

    if (isIdentifier(declaration)) {
      // Rename the variable being exported.
      safeRename(path, asset, declaration.name, identifier.name);
      path.remove();
    } else if (isExpression(declaration) || !declaration.id) {
      // $FlowFixMe
      let declarationExpr = t.toExpression(declaration);
      // Declare a variable to hold the exported value.
      path.replaceWith(
        t.variableDeclaration('var', [
          t.variableDeclarator(identifier, declarationExpr),
        ]),
      );

      path.scope.registerDeclaration(path);
    } else {
      invariant(isIdentifier(declaration.id));
      // Rename the declaration to the exported name.
      safeRename(path, asset, declaration.id.name, identifier.name);
      path.replaceWith(declaration);
    }

    if (!asset.symbols.hasExportSymbol('default')) {
      asset.symbols.set('default', identifier.name, convertBabelLoc(loc));
    }
  },

  ExportNamedDeclaration(path, asset: MutableAsset) {
    let {declaration, source, specifiers} = path.node;

    if (source) {
      for (let specifier of nullthrows(specifiers)) {
        let exported = specifier.exported;
        let imported;

        if (isExportDefaultSpecifier(specifier)) {
          imported = 'default';
        } else if (isExportNamespaceSpecifier(specifier)) {
          imported = '*';
        } else if (isExportSpecifier(specifier)) {
          imported = specifier.local.name;
        } else {
          throw new Error('Unknown export construct');
        }

        let id = getIdentifier(asset, 'import', exported.name);

        let dep = asset
          .getDependencies()
          .find(dep => dep.moduleSpecifier === source.value);
        if (dep && imported) {
          let existing = dep.symbols.get(imported)?.local;
          if (existing) {
            id.name = existing;
          } else {
            // this will merge with the existing dependency
            let loc = convertBabelLoc(specifier.loc);
            asset.addDependency({
              moduleSpecifier: dep.moduleSpecifier,
              symbols: new Map([[imported, {local: id.name, loc}]]),
              isWeak: true,
            });
          }
        }

        asset.symbols.set(
          exported.name,
          id.name,
          convertBabelLoc(specifier.loc),
        );

        id.loc = specifier.loc;
        path.insertAfter(
          EXPORT_ASSIGN_TEMPLATE({
            EXPORTS: getExportsIdentifier(asset, path.scope),
            NAME: exported,
            LOCAL: id,
          }),
        );
      }

      addImport(asset, path);
      path.remove();
    } else if (declaration) {
      path.replaceWith(declaration);

      if (isIdentifier(declaration.id)) {
        addExport(asset, path, declaration.id, declaration.id);
      } else {
        let identifiers = t.getBindingIdentifiers(declaration);
        for (let id of Object.keys(identifiers)) {
          addExport(asset, path, identifiers[id], identifiers[id]);
        }
      }
    } else if (specifiers.length > 0) {
      for (let specifier of specifiers) {
        invariant(isExportSpecifier(specifier)); // because source is empty
        addExport(asset, path, specifier.local, specifier.exported);
      }

      path.remove();
    }
  },

  ExportAllDeclaration(path, asset: MutableAsset) {
    let dep = asset
      .getDependencies()
      .find(dep => dep.moduleSpecifier === path.node.source.value);
    if (dep) {
      dep.symbols.set('*', '*', convertBabelLoc(path.node.loc));
    }

    path.replaceWith(
      EXPORT_ALL_TEMPLATE({
        OLD_NAME: getExportsIdentifier(asset, path.scope),
        SOURCE: t.stringLiteral(path.node.source.value),
        ID: t.stringLiteral(asset.id),
      }),
    );
  },
};

function addImport(
  asset: MutableAsset,
  path: NodePath<ImportDeclaration | ExportNamedDeclaration>,
) {
  // Replace with a $parcel$require call so we know where to insert side effects.
  let replacement = REQUIRE_CALL_TEMPLATE({
    ID: t.stringLiteral(asset.id),
    SOURCE: t.stringLiteral(nullthrows(path.node.source).value),
  });
  replacement.loc = path.node.loc;
  let requireStmt = t.expressionStatement(replacement);

  // Hoist the call to the top of the file.
  let lastImport = path.scope.getData('hoistedImport');
  if (lastImport) {
    [lastImport] = lastImport.insertAfter(requireStmt);
  } else {
    [lastImport] = path.parentPath.unshiftContainer('body', [requireStmt]);
  }

  path.scope.setData('hoistedImport', lastImport);
}

function addExport(asset: MutableAsset, path, local, exported) {
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
    LOCAL: identifier,
  });

  let binding = scope.getBinding(local.name);
  let constantViolations = binding
    ? binding.constantViolations.concat(binding.path.getStatementParent())
    : [path];

  if (!asset.symbols.hasExportSymbol(exported.name)) {
    asset.symbols.set(
      exported.name,
      identifier.name,
      convertBabelLoc(exported.loc),
    );
  }

  rename(scope, local.name, identifier.name);

  for (let p of constantViolations) {
    p.insertAfter(t.cloneDeep(assignNode));
  }
}

function hasImport(asset: MutableAsset, id) {
  for (let dep of asset.getDependencies()) {
    if (dep.symbols.hasLocalSymbol(id)) {
      return true;
    }
  }

  return false;
}

function hasExport(asset: MutableAsset, id) {
  return asset.symbols.hasLocalSymbol(id);
}

function safeRename(path, asset: MutableAsset, from, to) {
  if (from === to) {
    return;
  }

  // If the binding that we're renaming is constant, it's safe to rename it.
  // Otherwise, create a new binding that references the original.
  let binding = nullthrows(path.scope.getBinding(from));
  if (binding && binding.constant) {
    rename(path.scope, from, to);
  } else {
    let [decl] = path.insertAfter(
      t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier(to), t.identifier(from)),
      ]),
    );

    binding.reference(decl.get<NodePath<Identifier>>('declarations.0.init'));
    path.scope.registerDeclaration(decl);
  }
}

function getExportsIdentifier(asset: MutableAsset, scope) {
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

function getCJSExportsIdentifier(asset: MutableAsset, scope) {
  if (scope.getProgramParent().getData('shouldWrap')) {
    return t.identifier('exports');
  } else if (scope.getProgramParent().getData('cjsExportsReassigned')) {
    let id = getIdentifier(asset, 'cjs_exports');
    if (!scope.hasBinding(id.name)) {
      scope.getProgramParent().push({id});
    }

    return id;
  } else {
    return getExportsIdentifier(asset, scope);
  }
}
