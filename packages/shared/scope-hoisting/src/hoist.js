// @flow

import type {AST, MutableAsset} from '@parcel/types';
import type {
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
  isObjectPattern,
  isObjectProperty,
  isStringLiteral,
  isUnaryExpression,
  isVariableDeclaration,
  isVariableDeclarator,
} from '@babel/types';
import {traverse, REMOVE} from '@parcel/babylon-walk';
import template from '@babel/template';
import nullthrows from 'nullthrows';
import invariant from 'assert';
import {
  convertBabelLoc,
  getName,
  getIdentifier,
  getExportIdentifier,
} from './utils';
import {Scope} from './scope';

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
  {|OLD_NAME: Identifier, DEP_ID: StringLiteral|},
  Statement,
>('$parcel$exportWildcard(OLD_NAME, $parcel$require(DEP_ID));');
const REQUIRE_CALL_TEMPLATE = template.expression<
  {|DEP_ID: StringLiteral|},
  CallExpression,
>('$parcel$require(DEP_ID)');
const REQUIRE_RESOLVE_CALL_TEMPLATE = template.expression<
  {|ASSET_ID: StringLiteral, DEP_ID: StringLiteral|},
  CallExpression,
>('$parcel$require$resolve(ASSET_ID, DEP_ID)');
const TYPEOF = {
  module: 'object',
  require: 'function',
};

export function hoist(asset: MutableAsset, ast: AST) {
  if (ast.type !== 'babel' || ast.version !== '7.0.0') {
    throw new Error('Asset does not have a babel AST');
  }

  let state = {
    asset,
    scope: new Scope(),
    prepend: [],
    append: [],
    cjsExportsReassigned: false,
    dependencies: new Map(
      asset.getDependencies().map(d => [d.moduleSpecifier, d]),
    ),
    maybeShouldWrap: [],
    shouldWrap: false,
  };

  traverse(ast.program, VISITOR, state);

  let body = ast.program.program.body;
  body.unshift(...state.prepend);
  body.push(...state.append);

  asset.meta.pureExports =
    !state.shouldWrap &&
    !state.cjsExportsReassigned &&
    !asset.meta.resolveExportsBailedOut;

  if (state.shouldWrap) {
    if (asset.meta.isES6Module) {
      body.unshift(ESMODULE_TEMPLATE());
    }

    // Since the asset is wrapped, no variable renaming can occur. In order for imports to
    // work correctly, we need to declare variables for the original imported symbols to
    // point to the imported module.
    for (let dep of asset.getDependencies()) {
      for (let [, {local}] of dep.symbols) {
        let orig = state.scope.inverseRenames.get(local);
        if (orig) {
          body.unshift(
            t.variableDeclaration('var', [
              t.variableDeclarator(t.identifier(orig), t.identifier(local)),
            ]),
          );
        }
      }
    }

    ast.program.program = t.program([
      WRAPPER_TEMPLATE({
        NAME: getIdentifier(asset, 'exports'),
        BODY: body,
      }),
    ]);

    asset.symbols.clear();
    asset.meta.isCommonJS = true;
    asset.meta.isES6Module = false;
  } else {
    body.unshift(
      t.variableDeclaration('var', [
        t.variableDeclarator(
          getIdentifier(asset, 'exports'),
          t.objectExpression([]),
        ),
      ]),
    );

    // Rename CommonJS `exports` object to namespace name.
    state.scope.rename('exports', getName(asset, 'exports'));

    // Perform renames for top-level scope.
    state.scope.exit();
  }

  asset.setAST(ast);
}

const VISITOR = {
  Program: {
    enter(node, {asset}) {
      asset.meta.id = asset.id;
      asset.meta.exportsIdentifier = getName(asset, 'exports');
    },

    exit(node, state) {
      let {asset, scope} = state;

      // Rename each binding in the top-level scope to something unique.
      for (let name of scope.names) {
        if (!scope.renames.has(name)) {
          let newName = getName(asset, 'var', name);
          scope.rename(name, newName);
        }
      }

      // Mark exports as pure now that we have full scope information.
      for (let [exported, symbol] of asset.symbols) {
        if (isPure(scope, exported)) {
          symbol.meta = symbol.meta ?? {};
          symbol.meta.isPure = true;
        }
      }

      // Compute whether we need to wrap this module using deferred functions.
      state.shouldWrap =
        state.shouldWrap || state.maybeShouldWrap.some(Boolean);
    },
  },

  Scopable: {
    enter(node, state, ancestors) {
      if (
        !t.isScope(node, ancestors[ancestors.length - 2]) ||
        t.isProgram(node) ||
        t.isFunction(node)
      ) {
        return;
      }

      state.scope = new Scope(state.scope);
    },
    exit(node, state, ancestors) {
      if (
        !t.isScope(node, ancestors[ancestors.length - 2]) ||
        t.isProgram(node)
      ) {
        return;
      }

      state.scope.exit();
      if (state.scope.parent) {
        state.scope = state.scope.parent;
      }
    },
  },

  Declaration: {
    exit(node, {scope}) {
      if (t.isFunction(node) || t.isExportDeclaration(node)) {
        return;
      }

      // Register declarations with the scope.
      if (isVariableDeclaration(node)) {
        for (let decl of node.declarations) {
          let ids = t.getBindingIdentifiers(node);
          for (let id in ids) {
            scope.addBinding(id, decl);
            scope.addReference(ids[id]);
          }
        }
      } else {
        // $FlowFixMe
        let id = node.id;
        if (isIdentifier(id)) {
          scope.addBinding(id.name, node);
          scope.addReference(id);
        }
      }
    },
  },

  Function(node, state) {
    // Add function name to outer scope
    let name;
    if (isFunctionDeclaration(node) && isIdentifier(node.id)) {
      let id = node.id;
      name = id.name;
      state.scope.addBinding(name, node);
      state.scope.addReference(id);
    }

    // Create new scope
    state.scope = new Scope(state.scope);

    // Add inner bindings to inner scope
    let inner = t.getBindingIdentifiers(node);
    for (let id in inner) {
      if (id !== name) {
        state.scope.addBinding(id, inner[id]);
        state.scope.addReference(inner[id]);
      }
    }
  },

  Identifier(node, state, ancestors) {
    let parent = ancestors[ancestors.length - 2];
    if (!t.isReferenced(node, parent, ancestors[ancestors.length - 3])) {
      return;
    }

    let {asset, scope, cjsExportsReassigned} = state;
    if (!t.isExportSpecifier(parent) && !t.isExportDeclaration(parent)) {
      scope.addReference(node);
    }

    // We must wrap if `module` is referenced as a free identifier rather
    // than a statically resolvable member expression.
    if (
      node.name === 'module' &&
      (!isMemberExpression(parent) || parent.computed) &&
      !(isUnaryExpression(parent) && parent.operator === 'typeof')
    ) {
      state.maybeShouldWrap.push(() => !scope.has('exports'));
    }

    if (node.name === 'exports') {
      let parent = ancestors[ancestors.length - 2];
      return () => {
        if (!scope.has('exports') && !state.shouldWrap) {
          asset.meta.isCommonJS = true;

          // We must disable resolving $..$exports.foo if `exports`
          // is referenced as a free identifier rather
          // than a statically resolvable member expression.
          if (
            !isAssignmentExpression(parent, {left: node}) &&
            (!isMemberExpression(parent) ||
              !(isIdentifier(parent.property) && !parent.computed) ||
              isStringLiteral(parent.property))
          ) {
            asset.meta.resolveExportsBailedOut = true;
          }

          return getCJSExportsIdentifier(
            state,
            cjsExportsReassigned && state.cjsExportsReassigned,
          );
        }
      };
    }

    if (node.name === 'global') {
      return () => {
        if (!scope.has('global')) {
          return t.identifier('$parcel$global');
        }
      };
    }
  },

  DirectiveLiteral(node) {
    // Remove 'use strict' directives, since modules are concatenated - one strict mode
    // module should not apply to all other modules in the same scope.
    if (node.value === 'use strict') {
      return REMOVE;
    }
  },

  MemberExpression(node, state, ancestors) {
    if (
      !isIdentifier(node.object, {name: 'module'}) ||
      !isIdentifier(node.property)
    ) {
      return;
    }

    let parent = ancestors[ancestors.length - 2];
    let {asset, scope} = state;
    let exportsId = getExportsIdentifier(state);
    return () => {
      if (scope.has('module') || state.shouldWrap) {
        return;
      }

      if (t.matchesPattern(node, 'module.exports')) {
        asset.meta.isCommonJS = true;
        asset.symbols.set(
          '*',
          getName(asset, 'exports'),
          convertBabelLoc(node.loc),
        );

        // We must disable resolving $..$exports.foo if `exports`
        // is referenced as a free identifier rather
        // than a statically resolvable member expression.
        if (
          !isAssignmentExpression(parent, {left: node}) &&
          (!isMemberExpression(parent) ||
            !(isIdentifier(parent.property) && !parent.computed) ||
            isStringLiteral(parent.property))
        ) {
          asset.meta.resolveExportsBailedOut = true;
        }

        return exportsId;
      }

      if (t.matchesPattern(node, 'module.id')) {
        return t.stringLiteral(asset.id);
      }

      if (t.matchesPattern(node, 'module.hot')) {
        return t.identifier('null');
      }

      if (t.matchesPattern(node, 'module.require') && !asset.env.isNode()) {
        return t.identifier('null');
      }

      if (t.matchesPattern(node, 'module.bundle')) {
        return t.identifier('parcelRequire');
      }
    };
  },

  ThisExpression(node, state) {
    let {asset, scope} = state;
    if (scope.parent) {
      return;
    }

    if (asset.meta.isES6Module) {
      return t.identifier('undefined');
    } else {
      asset.meta.isCommonJS = true;
      return getExportsIdentifier(state);
    }
  },

  AssignmentExpression: {
    exit(node, state) {
      let {asset, scope, prepend} = state;
      let {left, right} = node;

      if (isIdentifier(left)) {
        scope.addReference(left);
      }

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

      if (isIdentifier(left) && left.name === 'exports') {
        state.cjsExportsReassigned = true;
        return () => {
          if (scope.has('exports')) {
            state.cjsExportsReassigned = false;
            return;
          }

          let id = getCJSExportsIdentifier(state, true);
          if (!scope.has(id.name)) {
            prepend.push(
              t.variableDeclaration('var', [
                t.variableDeclarator(t.clone(id), t.objectExpression([])),
              ]),
            );

            scope.getRoot().add(id.name);
          }

          node.left = id;
          asset.meta.isCommonJS = true;
        };
      }

      // If we can statically evaluate the name of a CommonJS export, create an ES6-style export for it.
      // This allows us to remove the CommonJS export object completely in many cases.
      if (
        isMemberExpression(left) &&
        (isIdentifier(left.object, {name: 'exports'}) ||
          t.matchesPattern(left.object, 'module.exports')) &&
        ((isIdentifier(left.property) && !left.computed) ||
          isStringLiteral(left.property))
      ) {
        let name = isIdentifier(left.property)
          ? left.property.name
          : left.property.value;

        return () => {
          if (scope.has('exports') || scope.has('module') || state.shouldWrap) {
            return;
          }

          let identifier = getExportIdentifier(asset, name);
          asset.meta.isCommonJS = true;

          // If this is the first assignment, create a binding for the ES6-style export identifier.
          // Otherwise, assign to the existing export binding.
          // let scope = path.scope.getProgramParent();
          if (!scope.has(identifier.name)) {
            let decl = t.variableDeclarator(t.clone(identifier));
            prepend.push(t.variableDeclaration('var', [decl]));

            let root = scope.getRoot();
            root.addBinding(identifier.name, decl);
            root.addReference(identifier);

            asset.symbols.set(
              name,
              identifier.name,
              convertBabelLoc(node.loc),
              {isPure: isPureValue(right)},
            );
          } else {
            let meta = asset.symbols.get(name)?.meta;
            if (meta != null) {
              meta.isPure = false;
            }
          }

          // Transform to `$id$export$foo = exports.foo = value`
          return t.assignmentExpression('=', identifier, node);
        };
      }
    },
  },

  UnaryExpression: {
    exit(node, state) {
      // Replace `typeof module` with "object"
      if (
        node.operator === 'typeof' &&
        isIdentifier(node.argument) &&
        TYPEOF[node.argument.name]
      ) {
        let {scope} = state;
        let name = node.argument.name;
        return () => {
          if (scope.has(name) || state.shouldWrap) {
            return;
          }

          return t.stringLiteral(TYPEOF[name]);
        };
      }
    },
  },

  ReturnStatement: {
    exit(path, state, ancestors) {
      if (state.shouldWrap) {
        return;
      }

      let functionParent = findParent(ancestors, node => t.isFunction(node));

      // Wrap in a function if we see a top-level return statement.
      if (!functionParent) {
        state.shouldWrap = true;
        state.asset.meta.isCommonJS = true;
        return t.returnStatement(
          t.memberExpression(t.identifier('module'), t.identifier('exports')),
        );
      }
    },
  },

  CallExpression: {
    exit(node, state, ancestors) {
      let {asset, scope, dependencies} = state;
      let {callee, arguments: args} = node;
      let parent = ancestors[ancestors.length - 2];

      // If we see an `eval` call, wrap the module in a function.
      // Otherwise, local variables accessed inside the eval won't work.
      if (isIdentifier(callee) && callee.name === 'eval') {
        state.maybeShouldWrap.push(() => !scope.has('eval'));
      }

      let isRequire = isIdentifier(callee, {name: 'require'});
      let [arg] = args;
      if (args.length !== 1 || !isStringLiteral(arg)) {
        return;
      }

      if (isRequire) {
        let source = arg.value;
        // Ignore require calls that were ignored earlier.
        let dep = dependencies.get(source);
        if (!dep) {
          return;
        }

        asset.meta.isCommonJS = true;

        // If this require call does not occur in the top-level, e.g. in a function
        // or inside an if statement, or if it might potentially happen conditionally,
        // the module must be wrapped in a function so that the module execution order is correct.
        if (!dep.isAsync) {
          let parentIndex = findParentIndex(ancestors, node =>
            t.isStatement(node),
          );
          let parent = ancestors[parentIndex - 1];
          let bail = findParent(
            ancestors,
            node =>
              t.isConditionalExpression(node) || t.isLogicalExpression(node),
          );
          if (!t.isProgram(parent) || bail) {
            dep.meta.shouldWrap = true;
          }

          dep.meta.isCommonJS = true;
        }

        // Attempt to pattern match basic member expressions and object pattern assignments to statically
        // determine what symbols are used. If not possible, we bail out and require the whole namespace.
        let needsNamespace = false;
        if (dep.isAsync) {
          needsNamespace = true;
        } else if (
          isMemberExpression(parent, {object: node}) &&
          !parent.computed &&
          isIdentifier(parent.property)
        ) {
          // Matched a member expression directly on a require call, e.g. var foo = require('./foo').foo;
          dep.symbols.set(
            parent.property.name,
            getName(asset, 'require', source),
            convertBabelLoc(node.loc),
          );
        } else {
          // Match assignments and variable declarations with object patterns,
          // e.g. var {foo, bar} = require('./foo').
          let objectPattern = null;
          if (isAssignmentExpression(parent) && isObjectPattern(parent.left)) {
            objectPattern = parent.left;
          } else if (
            isVariableDeclarator(parent) &&
            isObjectPattern(parent.id)
          ) {
            objectPattern = parent.id;
          }

          if (objectPattern) {
            for (let p of objectPattern.properties) {
              if (isObjectProperty(p) && !p.computed && isIdentifier(p.key)) {
                dep.symbols.set(
                  p.key.name,
                  getName(asset, 'require', source, p.key.name),
                  convertBabelLoc(p.loc),
                );
              } else {
                needsNamespace = true;
              }
            }
          } else {
            needsNamespace = true;
          }
        }

        if (needsNamespace) {
          dep.symbols.set(
            '*',
            getName(asset, 'require', source),
            convertBabelLoc(node.loc),
          );
        }

        // Generate a variable name based on the dependency id and the module name to require.
        // This will be replaced by the final variable name of the resolved asset in the packager.
        let replacement = REQUIRE_CALL_TEMPLATE({
          DEP_ID: t.stringLiteral(dep.id),
        });
        replacement.loc = node.loc;
        return replacement;
      }

      if (t.matchesPattern(callee, 'require.resolve')) {
        let dep = dependencies.get(arg.value);
        if (dep) {
          let replacement = REQUIRE_RESOLVE_CALL_TEMPLATE({
            ASSET_ID: t.stringLiteral(asset.id),
            DEP_ID: t.stringLiteral(dep.id),
          });
          replacement.loc = node.loc;
          return replacement;
        }
      }
    },
  },

  ImportDeclaration: {
    exit(node, {asset, dependencies, scope, prepend}) {
      let dep = dependencies.get(node.source.value);

      // For each specifier, rename the local variables to point to the imported name.
      // This will be replaced by the final variable name of the resolved asset in the packager.
      for (let specifier of node.specifiers) {
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

        scope.rename(specifier.local.name, id.name);
      }

      if (dep) {
        addImport(dep, node, prepend);
      }

      return REMOVE;
    },
  },

  ExportDefaultDeclaration: {
    exit(node, state) {
      let {asset, dependencies, scope, append} = state;
      let {declaration, loc} = node;
      let identifier = getExportIdentifier(asset, 'default');
      let name: ?string;
      if (
        (isClassDeclaration(declaration) ||
          isFunctionDeclaration(declaration)) &&
        declaration.id
      ) {
        name = declaration.id.name;
      } else if (isIdentifier(declaration)) {
        name = declaration.name;
      }

      if (name && (hasImport(dependencies, name) || hasExport(asset, name))) {
        identifier = t.identifier(name);
      }

      // Add assignment to exports object for namespace imports and commonjs.
      append.push(
        EXPORT_ASSIGN_TEMPLATE({
          EXPORTS: getExportsIdentifier(state),
          NAME: t.identifier('default'),
          LOCAL: t.clone(identifier),
        }),
      );

      if (!asset.symbols.hasExportSymbol('default')) {
        asset.symbols.set('default', identifier.name, convertBabelLoc(loc));
      }

      return () => {
        let res = [node];

        if (isIdentifier(declaration)) {
          // Rename the variable being exported.
          invariant(name != null);
          res.push(...safeRename(scope, asset, name, identifier.name));
          res.shift();
        } else if (isExpression(declaration) || !declaration.id) {
          // $FlowFixMe
          let declarationExpr = t.toExpression(declaration);
          // Declare a variable to hold the exported value.
          res[0] = t.variableDeclaration('var', [
            t.variableDeclarator(identifier, declarationExpr),
          ]);
        } else {
          invariant(name != null);
          // Rename the declaration to the exported name.
          res.push(...safeRename(scope, asset, name, identifier.name));
          res[0] = declaration;
        }

        return res;
      };
    },
  },

  ExportNamedDeclaration: {
    exit(node, state) {
      let {asset, dependencies, prepend} = state;
      let {declaration, source, specifiers} = node;
      let res = [node];

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

          let dep = dependencies.get(source.value);
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

            addImport(dep, node, prepend);
          }

          asset.symbols.set(
            exported.name,
            id.name,
            convertBabelLoc(specifier.loc),
          );

          id.loc = specifier.loc;
          res.push(
            EXPORT_ASSIGN_TEMPLATE({
              EXPORTS: getExportsIdentifier(state),
              NAME: exported,
              LOCAL: id,
            }),
          );
        }

        res.shift();
      } else if (declaration) {
        if (isIdentifier(declaration.id)) {
          addExport(state, node, declaration.id, declaration.id);
        } else {
          let identifiers = t.getBindingIdentifiers(declaration);
          for (let id of Object.keys(identifiers)) {
            addExport(state, node, identifiers[id], identifiers[id]);
          }
        }

        res[0] = declaration;
      } else if (specifiers.length > 0) {
        for (let specifier of specifiers) {
          invariant(isExportSpecifier(specifier)); // because source is empty
          addExport(state, node, specifier.local, specifier.exported);
        }

        res.shift();
      }

      return res;
    },
  },

  ExportAllDeclaration(node, state) {
    let {dependencies} = state;
    let dep = dependencies.get(node.source.value);
    if (dep) {
      dep.symbols.set('*', '*', convertBabelLoc(node.loc));

      return EXPORT_ALL_TEMPLATE({
        OLD_NAME: getExportsIdentifier(state),
        DEP_ID: t.stringLiteral(dep.id),
      });
    }
  },
};

function isPure(scope, name) {
  let binding = scope.getBinding(name);
  let references = scope.references.get(name);

  // There are always at least 2 references to an exported symbol:
  // the declaration itself, and the CommonJS export assignment.
  if (!binding || (references && references.size > 2)) {
    return false;
  }

  if (isVariableDeclarator(binding) && isIdentifier(binding.id)) {
    return isPureValue(binding.init);
  }

  return t.isPureish(binding);
}

function isPureValue(node) {
  return t.isPureish(node) || t.isIdentifier(node) || t.isThisExpression(node);
}

function addImport(dep, node, prepend) {
  // Replace with a $parcel$require call so we know where to insert side effects.
  let replacement = REQUIRE_CALL_TEMPLATE({
    DEP_ID: t.stringLiteral(dep.id),
  });
  replacement.loc = node.loc;
  prepend.push(t.expressionStatement(replacement));
}

function addExport(state, node, local, exported) {
  let {asset, scope, dependencies, append} = state;
  let identifier = getExportIdentifier(asset, exported.name);
  let localName = scope.renames.get(local.name) || local.name;

  if (hasImport(dependencies, localName)) {
    identifier = t.identifier(localName);
  }

  if (hasExport(asset, localName)) {
    identifier = t.identifier(localName);
  }

  local = t.clone(local);
  state.scope.addReference(local);

  let assignNode = EXPORT_ASSIGN_TEMPLATE({
    EXPORTS: getExportsIdentifier(state),
    NAME: t.clone(exported),
    LOCAL: local,
  });

  append.push(assignNode);

  if (!asset.symbols.hasExportSymbol(exported.name)) {
    asset.symbols.set(
      exported.name,
      identifier.name,
      convertBabelLoc(exported.loc),
    );
  }

  scope.rename(local.name, identifier.name);
}

function hasImport(dependencies, id) {
  for (let dep of dependencies.values()) {
    if (dep.symbols.hasLocalSymbol(id)) {
      return true;
    }
  }

  return false;
}

function hasExport(asset: MutableAsset, id) {
  return asset.symbols.hasLocalSymbol(id);
}

function safeRename(scope, asset: MutableAsset, from, to) {
  if (from === to) {
    return [];
  }

  // If the binding that we're renaming is constant, it's safe to rename it.
  // Otherwise, create a new binding that references the original.
  if (isPure(scope, from)) {
    scope.rename(from, to);
    return [];
  } else {
    let fromId = t.identifier(from);
    scope.addReference(fromId);
    return [
      t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier(to), fromId),
      ]),
    ];
  }
}

function getExportsIdentifier(state) {
  let id = t.identifier('exports');
  state.scope.addReference(id);
  return id;
}

function getCJSExportsIdentifier(state, cjsExportsReassigned) {
  if (cjsExportsReassigned) {
    let id = getIdentifier(state.asset, 'cjs_exports');
    return id;
  } else {
    return getIdentifier(state.asset, 'exports');
  }
}

function findParentIndex(
  ancestors: Array<BabelNode>,
  predicate: (node: BabelNode) => boolean,
) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (predicate(ancestors[i])) {
      return i;
    }
  }

  return -1;
}

function findParent(
  ancestors: Array<BabelNode>,
  predicate: (node: BabelNode) => boolean,
) {
  let idx = findParentIndex(ancestors, predicate);
  if (idx !== -1) {
    return ancestors[idx];
  }

  return null;
}
