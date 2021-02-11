// @flow

import type {AST, MutableAsset, SourceLocation} from '@parcel/types';
import type {NodePath, Visitor} from '@babel/traverse';
import type {
  CallExpression,
  ExportNamedDeclaration,
  Expression,
  Identifier,
  ImportDeclaration,
  LVal,
  Node,
  ObjectProperty,
  RestElement,
  Statement,
  StringLiteral,
  VariableDeclaration,
} from '@babel/types';

import * as t from '@babel/types';
import {
  isAssignmentExpression,
  isAwaitExpression,
  isCallExpression,
  isClassDeclaration,
  isExportDefaultSpecifier,
  isExportNamespaceSpecifier,
  isExportSpecifier,
  isExpression,
  isFunction,
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
  isExpressionStatement,
  isSequenceExpression,
} from '@babel/types';
import traverse from '@babel/traverse';
import template from '@babel/template';
import nullthrows from 'nullthrows';
import {basename} from 'path';
import invariant from 'assert';
import {convertBabelLoc} from '@parcel/babel-ast-utils';
import rename from './renamer';
import {
  getName,
  getIdentifier,
  getExportIdentifier,
  dereferenceIdentifier,
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

const EXPORT_TEMPLATE = template.statement<
  {|EXPORTS: Identifier, NAME: StringLiteral, LOCAL: Expression|},
  Statement,
>('$parcel$export(EXPORTS, NAME, function(){return LOCAL;});');
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
    enter(path, asset) {
      asset.symbols.ensure();
      asset.meta.id = asset.id;
      asset.meta.exportsIdentifier = getName(asset, 'exports');
      asset.meta.staticExports = true;

      traverse.cache.clearScope();
      path.scope.crawl();

      let shouldWrap = false;
      path.traverse({
        ImportDeclaration() {
          asset.meta.isES6Module = true;
        },
        ExportDeclaration() {
          asset.meta.isES6Module = true;
        },
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
            !isStaticMemberExpression(parent) &&
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
          if (node.name === 'exports' && !path.scope.hasBinding('exports')) {
            asset.meta.isCommonJS = true;
            if (
              !(
                isAssignmentExpression(parent, {left: node}) ||
                isStaticMemberExpression(parent) ||
                path.scope.getData('shouldWrap')
              )
            ) {
              asset.meta.staticExports = false;
              // The namespace object is used in the asset itself
              asset.addDependency({
                moduleSpecifier: `./${basename(asset.filePath)}`,
                symbols: new Map([
                  [
                    '*',
                    {
                      local: '@exports',
                      isWeak: false,
                      loc: convertBabelLoc(path.node.loc),
                    },
                  ],
                ]),
              });
            }
          }
        },

        MemberExpression(path) {
          let {node, parent} = path;

          // We must disable resolving $..$exports.foo if `exports`
          // is referenced as a free identifier rather
          // than a statically resolvable member expression.
          if (
            t.matchesPattern(node, 'module.exports') &&
            !path.scope.hasBinding('module')
          ) {
            asset.meta.isCommonJS = true;
            if (
              !(
                isAssignmentExpression(parent, {left: node}) ||
                isStaticMemberExpression(parent) ||
                path.scope.getData('shouldWrap')
              )
            ) {
              asset.meta.staticExports = false;
              // The namespace object is used in the asset itself
              asset.addDependency({
                moduleSpecifier: `./${basename(asset.filePath)}`,
                symbols: new Map([
                  [
                    '*',
                    {
                      local: '@exports',
                      isWeak: false,
                      loc: convertBabelLoc(path.node.loc),
                    },
                  ],
                ]),
              });
            }
          }
        },
      });

      if (!asset.meta.isCommonJS && !asset.meta.isES6Module) {
        // Assume CommonJS (still needs exports object)
        asset.meta.isCommonJS = true;
        asset.symbols.set('*', getName(asset, 'exports'));
      }

      path.scope.setData('shouldWrap', shouldWrap);
      path.scope.setData('cjsExportsReassigned', false);

      if (shouldWrap) {
        asset.meta.staticExports = false;
      }
    },

    exit(path, asset) {
      let scope = path.scope;

      let exportsIdentifier = getIdentifier(asset, 'exports');
      if (scope.getData('shouldWrap')) {
        if (asset.meta.isES6Module) {
          path.unshiftContainer('body', [ESMODULE_TEMPLATE()]);
        }

        path.replaceWith(
          t.program([
            WRAPPER_TEMPLATE({
              NAME: exportsIdentifier,
              BODY: path.node.body,
            }),
          ]),
        );

        asset.symbols.set('*', exportsIdentifier.name);
        asset.meta.isCommonJS = true;
        asset.meta.isES6Module = false;
      } else {
        // Re-crawl scope so we are sure to have all bindings.
        traverse.cache.clearScope();
        scope.crawl();

        // Rename each binding in the top-level scope to something unique.
        for (let name in scope.bindings) {
          if (!name.startsWith(t.toIdentifier('$' + asset.id))) {
            let newName = getName(asset, 'var', name);
            rename(scope, name, newName);
          }
        }

        // Add variable that represents module.exports if it is referenced and not declared.
        if (!scope.hasBinding(exportsIdentifier.name)) {
          scope.push({id: exportsIdentifier, init: t.objectExpression([])});
        }

        if (asset.meta.isCommonJS) {
          asset.symbols.set('*', exportsIdentifier.name);
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

  MemberExpression(path, asset) {
    if (path.scope.hasBinding('module') || path.scope.getData('shouldWrap')) {
      return;
    }

    if (t.matchesPattern(path.node, 'module.exports')) {
      // Replace module.exports.foo with exported identifier if possible,
      // and add a self-referencing dependency so we know the symbol is used.
      let selfReference = addSelfReference(path, asset);
      if (selfReference) {
        path.parentPath.replaceWith(selfReference);
      } else {
        let exportsId = getExportsIdentifier(asset, path.scope);
        asset.symbols.set('*', exportsId.name, convertBabelLoc(path.node.loc));
        path.replaceWith(exportsId);

        if (!path.scope.hasBinding(exportsId.name)) {
          path.scope
            .getProgramParent()
            .push({id: t.clone(exportsId), init: t.objectExpression([])});
        }
      }
    } else if (t.matchesPattern(path.node, 'module.id')) {
      path.replaceWith(t.stringLiteral(asset.id));
    } else if (t.matchesPattern(path.node, 'module.hot')) {
      path.replaceWith(t.identifier('null'));
    } else if (
      t.matchesPattern(path.node, 'module.require') &&
      !asset.env.isNode()
    ) {
      path.replaceWith(t.identifier('null'));
    } else if (
      t.matchesPattern(path.node, 'module.bundle.root') ||
      t.matchesPattern(path.node, 'module.bundle')
    ) {
      path.replaceWith(t.identifier('parcelRequire'));
    }
  },

  ReferencedIdentifier(path, asset) {
    if (
      path.node.name === 'exports' &&
      !path.scope.hasBinding('exports') &&
      !path.scope.getData('shouldWrap')
    ) {
      asset.meta.isCommonJS = true;

      // Mark if exports is accessed non-statically.
      if (!isStaticMemberExpression(path.parent)) {
        asset.meta.staticExports = false;
      }

      // Replace exports.foo with exported identifier if possible,
      // and add a self-referencing dependency so we know the symbol is used.
      let selfReference = addSelfReference(path, asset);
      if (selfReference) {
        path.parentPath.replaceWith(selfReference);
      } else {
        path.replaceWith(getCJSExportsIdentifier(asset, path.scope));
      }
    }

    if (path.node.name === 'global' && !path.scope.hasBinding('global')) {
      path.replaceWith(t.identifier('$parcel$global'));
    }
  },

  ThisExpression(path, asset) {
    if (!path.scope.getData('shouldWrap')) {
      let scope = path.scope;
      while (scope?.parent) {
        if (
          (scope.path.isFunction() &&
            !scope.path.isArrowFunctionExpression()) ||
          scope.path.isClassDeclaration()
        ) {
          return;
        }
        scope = scope.parent;
      }

      asset.meta.isCommonJS = true;

      // Mark if exports is accessed non-statically.
      if (!isStaticMemberExpression(path.parent)) {
        asset.meta.staticExports = false;
      }

      if (asset.meta.isES6Module) {
        path.replaceWith(t.identifier('undefined'));
      } else {
        // Replace this.foo with exported identifier if possible,
        // and add a self-referencing dependency so we know the symbol is used.
        let selfReference = addSelfReference(path, asset);
        if (selfReference) {
          path.parentPath.replaceWith(selfReference);
        } else {
          path.replaceWith(getExportsIdentifier(asset, path.scope));
        }
      }
    }
  },

  AssignmentExpression(path, asset) {
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
      asset.meta.staticExports = false;
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

        // These have a special meaning, we'll have to fallback from the '*' symbol.
        // '*' will always be registered into the symbols at the end.
        if (
          (name !== 'default' || asset.symbols.hasExportSymbol('__esModule')) &&
          name !== '*'
        ) {
          asset.symbols.set(
            name,
            identifier.name,
            convertBabelLoc(path.node.loc),
            {isPure: isPure(scope.getBinding(identifier.name))},
          );
        }
      } else {
        path.insertBefore(
          t.expressionStatement(
            t.assignmentExpression('=', t.clone(identifier), right),
          ),
        );

        let meta = asset.symbols.get(name)?.meta;
        if (meta != null) {
          meta.isPure = false;
        }
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

  CallExpression(path, asset) {
    let {callee, arguments: args} = path.node;
    let [arg] = args;
    if (
      args.length !== 1 ||
      !isStringLiteral(arg) ||
      path.scope.hasBinding('require')
    ) {
      return;
    }

    if (isIdentifier(callee, {name: 'require'})) {
      let source = arg.value;
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
      if (
        !path.getStatementParent().parentPath.isProgram() ||
        path.findParent(
          p =>
            p.isConditionalExpression() ||
            p.isLogicalExpression() ||
            p.isFunction(),
        )
      ) {
        dep.meta.shouldWrap = true;
      }

      // Generate a variable name based on the current asset id and the module name to require.
      // This will be replaced by the final variable name of the resolved asset in the packager.
      let replacement = REQUIRE_CALL_TEMPLATE({
        ID: t.stringLiteral(asset.id),
        SOURCE: t.stringLiteral(arg.value),
      });
      replacement.loc = path.node.loc;

      let memberAccesses: ?Array<{|name: string, loc: ?SourceLocation|}>;
      let properties: ?Array<RestElement | ObjectProperty>;
      let propertyScope;
      let replacePath;
      let binding;
      let {parent} = path;

      // Try to statically analyze a dynamic import() call
      if (dep.isAsync) {
        let {parent: grandparent} = path.parentPath;
        if (
          isMemberExpression(parent, {object: path.node}) &&
          isIdentifier(parent.property, {name: 'then'}) &&
          isCallExpression(grandparent, {
            callee: parent,
          }) &&
          grandparent.arguments.length === 1 &&
          isFunction(grandparent.arguments[0]) &&
          // $FlowFixMe
          grandparent.arguments[0].params.length === 1
        ) {
          let param: Node = grandparent.arguments[0].params[0];
          if (isObjectPattern(param)) {
            // import(xxx).then(({ default: b }) => ...);
            properties = param.properties;
          } else if (isIdentifier(param)) {
            // import(xxx).then((ns) => ...);
            binding = path.parentPath.parentPath
              .get<NodePath<Node>>('arguments.0.body')
              .scope.getBinding(param.name);
          }
        } else if (isAwaitExpression(parent, {argument: path.node})) {
          if (isVariableDeclarator(grandparent, {init: parent})) {
            if (isObjectPattern(grandparent.id)) {
              // let { x: y } = await import("./b.js");
              properties = grandparent.id.properties;
            } else if (isIdentifier(grandparent.id)) {
              // let ns = await import("./b.js");
              binding = path.parentPath.parentPath.scope.getBinding(
                grandparent.id.name,
              );
            }
          } else if (
            // ({ x: y } = await import("./b.js"));
            isAssignmentExpression(grandparent, {right: parent}) &&
            isObjectPattern(grandparent.left)
          ) {
            properties = grandparent.left.properties;
          }
        }
      } else if (isStaticMemberExpression(parent, {object: path.node})) {
        // e.g. require('foo').bar
        // $FlowFixMe
        let name = parent.property.name ?? parent.property.value;
        memberAccesses = [
          {
            name,
            loc: convertBabelLoc(parent.loc),
          },
        ];

        // If in an assignment expression, replace with a sequence expression
        // so that the $parcel$require is still in the correct position.
        // Otherwise, add a third argument to the $parcel$require call set to
        // the identifier to replace it with. This will be replaced in the linker.
        if (isAssignmentExpression(path.parentPath.parent, {left: parent})) {
          let assignment = t.cloneNode(path.parentPath.parent);
          assignment.left = t.identifier(
            getName(asset, 'importAsync', dep.id, name),
          );

          path.parentPath.parentPath.replaceWith(
            t.sequenceExpression([replacement, assignment]),
          );

          replacement = null;
        } else {
          replacement.arguments.push(
            t.identifier(getName(asset, 'importAsync', dep.id, name)),
          );

          replacePath = path.parentPath;
        }
      } else if (isVariableDeclarator(parent, {init: path.node})) {
        if (isObjectPattern(parent.id)) {
          // let { x: y } = require("./b.js");
          properties = parent.id.properties;
          propertyScope = path.parentPath.parentPath.scope;
        } else if (isIdentifier(parent.id)) {
          // let ns = require("./b.js");
          binding = path.parentPath.parentPath.scope.getBinding(parent.id.name);
        }

        replacePath = path.parentPath;
      } else if (
        // ({ x: y } = require("./b.js"));
        isAssignmentExpression(parent, {right: path.node}) &&
        isObjectPattern(parent.left) &&
        isUnusedValue(path.parentPath)
      ) {
        properties = parent.left.properties;
        propertyScope = path.parentPath.scope;
        replacePath = path.parentPath;
      }

      if (
        properties != null &&
        properties.length > 0 &&
        properties.every(p => isObjectProperty(p) && isIdentifier(p.key))
      ) {
        // take symbols listed when destructuring
        memberAccesses = properties.map(p => {
          invariant(isObjectProperty(p));
          invariant(isIdentifier(p.key));
          if (!dep.isAsync) {
            let name = p.key.name;
            let binding = propertyScope.getBinding(name);
            if (binding) {
              for (let ref of binding.referencePaths) {
                ref.replaceWith(
                  t.identifier(getName(asset, 'importAsync', dep.id, name)),
                );
              }
            }
          }

          return {name: p.key.name, loc: convertBabelLoc(p.loc)};
        });
      } else if (
        !path.scope.getData('shouldWrap') && // eval is evil
        binding != null &&
        binding.constant &&
        binding.referencePaths.length > 0 &&
        binding.referencePaths.every(({parent, node}) =>
          isStaticMemberExpression(parent, {object: node}),
        )
      ) {
        // properties of member expressions if all of them are static
        memberAccesses = binding.referencePaths.map(({parentPath, parent}) => {
          invariant(isMemberExpression(parent));
          // $FlowFixMe
          let name = parent.property.name ?? parent.property.value;
          if (!dep.isAsync) {
            parentPath.replaceWith(
              t.identifier(getName(asset, 'importAsync', dep.id, name)),
            );
          }
          return {
            // $FlowFixMe[prop-missing]
            name,
            loc: convertBabelLoc(parent.loc),
          };
        });
      }

      dep.symbols.ensure();
      if (memberAccesses != null) {
        // The import() return value was statically analyzable
        for (let {name, loc} of memberAccesses) {
          dep.symbols.set(
            name,
            getName(asset, 'importAsync', dep.id, name),
            loc,
          );
        }
      } else if (!isUnusedValue(path)) {
        // non-async and async fallback: everything
        dep.symbols.set(
          '*',
          getName(asset, 'require', source),
          convertBabelLoc(path.node.loc),
        );

        // Mark the dependency as CJS so that we keep the $id$exports var in the linker.
        dep.meta.isCommonJS = true;
      }

      if (memberAccesses != null && replacePath && replacement) {
        // Can't replace a variable declarator with a function call.
        // Need to replace the whole declaration.
        if (isVariableDeclarator(replacePath.node)) {
          let declaration = replacePath.parent;
          invariant(isVariableDeclaration(declaration));

          // If there is only one declarator, it's safe to replace the whole declaration.
          // Otherwise, split into multiple declarations so we can replace just one
          // with an expression statement containing the $parcel$require call.
          if (declaration.declarations.length === 1) {
            replacePath.parentPath.replaceWith(replacement);
          } else {
            let declIndex = declaration.declarations.indexOf(replacePath.node);
            replacePath.parentPath.insertBefore(
              t.variableDeclaration(
                declaration.kind,
                declaration.declarations.slice(0, declIndex),
              ),
            );

            replacePath.parentPath.insertBefore(
              t.expressionStatement(replacement),
            );
            for (let i = declIndex; i >= 0; i--) {
              replacePath.parentPath.get(`declarations.${i}`).remove();
            }
          }
        } else {
          replacePath.replaceWith(replacement);
        }
      } else if (replacement) {
        path.replaceWith(replacement);
      }
    } else if (t.matchesPattern(callee, 'require.resolve')) {
      let replacement = REQUIRE_RESOLVE_CALL_TEMPLATE({
        ID: t.stringLiteral(asset.id),
        SOURCE: arg,
      });
      replacement.loc = path.node.loc;
      path.replaceWith(replacement);
    }
  },

  ImportDeclaration(path, asset) {
    let dep = asset
      .getDependencies()
      .find(dep => dep.moduleSpecifier === path.node.source.value);

    if (dep) {
      dep.meta.isES6Module = true;
      dep.symbols.ensure();
    }

    // For each specifier, rename the local variables to point to the imported name.
    // This will be replaced by the final variable name of the resolved asset in the packager.
    for (let specifier of path.node.specifiers) {
      let binding = nullthrows(path.scope.getBinding(specifier.local.name));

      // Ignore unused specifiers in node-modules, especially for when TS was poorly transpiled.
      if (!binding.referenced && !asset.isSource) {
        continue;
      }

      let id = getIdentifier(asset, 'import', specifier.local.name);
      if (dep) {
        // Try to resolve static member accesses to the namespace object
        // and transform them as though they were named imports.
        if (isImportNamespaceSpecifier(specifier)) {
          let bailedOut = false;
          // Clone array because we are modifying it in the loop
          for (let p of [
            ...nullthrows(path.scope.getBinding(specifier.local.name))
              .referencePaths,
          ]) {
            let {parent, node} = p;

            if (
              isIdentifier(node) &&
              isStaticMemberExpression(parent, {object: node})
            ) {
              let imported: string =
                // $FlowFixMe
                parent.property.name ?? parent.property.value;
              let id = getIdentifier(
                asset,
                'import',
                specifier.local.name,
                imported,
              );
              let existing = dep.symbols.get(imported)?.local;
              if (existing) {
                id.name = existing;
              }
              dep.symbols.set(
                imported,
                id.name,
                convertBabelLoc(specifier.loc),
              );
              dereferenceIdentifier(node, p.scope);
              p.parentPath.replaceWith(id);
            } else {
              // We can't replace this occurence and do need the namespace binding...
              bailedOut = true;
            }
          }

          if (bailedOut) {
            let existing = dep.symbols.get('*')?.local;
            if (existing) {
              id.name = existing;
            }
            dep.symbols.set('*', id.name, convertBabelLoc(specifier.loc));
          }
        } else {
          // mark this as a weak import:
          // import {x} from './c'; export {x};
          let isWeak =
            binding.referencePaths.length === 1 &&
            isExportSpecifier(binding.referencePaths[0].parent, {
              local: binding.referencePaths[0].node,
            });

          let imported: string;
          if (isImportDefaultSpecifier(specifier)) {
            imported = 'default';
            // used in the CSS packager for CSS modules
            dep.meta.hasDefaultImport = true;
          } else if (isImportSpecifier(specifier)) {
            imported = specifier.imported.name;
          } else {
            throw new Error('Unknown import construct');
          }

          let existing = dep.symbols.get(imported)?.local;
          if (existing) {
            id.name = existing;
          }
          dep.symbols.set(
            imported,
            id.name,
            convertBabelLoc(specifier.loc),
            isWeak,
          );
        }
      }
      rename(path.scope, specifier.local.name, id.name);
    }

    addImport(asset, path);
    path.remove();
  },

  ExportDefaultDeclaration(path, asset) {
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

    if (name && hasExport(asset, name)) {
      identifier = t.identifier(name);
    }

    // Add assignment to exports object for namespace imports and commonjs.
    path.insertAfter(
      EXPORT_TEMPLATE({
        EXPORTS: getExportsIdentifier(asset, path.scope),
        NAME: t.stringLiteral('default'),
        LOCAL: t.clone(identifier),
      }),
    );

    if (
      isIdentifier(declaration) &&
      path.scope.hasBinding(declaration.name, /* noGlobals */ true)
    ) {
      // Rename the variable being exported.
      safeRename(path, asset, declaration.name, identifier.name);
      path.remove();
    } else if (isExpression(declaration) || !declaration.id) {
      // $FlowFixMe[incompatible-call]
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
      let binding = path.scope.getBinding(identifier.name);
      asset.symbols.set('default', identifier.name, convertBabelLoc(loc), {
        isPure: isPure(binding),
      });
    }
  },

  ExportNamedDeclaration(path, asset) {
    let {declaration, source, specifiers} = path.node;

    if (source) {
      let dep = asset
        .getDependencies()
        .find(dep => dep.moduleSpecifier === source.value);

      if (dep) {
        dep.meta.isES6Module = true;
        dep.symbols.ensure();
      }

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
        if (dep && imported) {
          let existing = dep.symbols.get(imported)?.local;
          if (existing) {
            id.name = existing;
          }
          dep.symbols.set(
            imported,
            id.name,
            convertBabelLoc(specifier.loc),
            true,
          );
        }

        asset.symbols.set(
          exported.name,
          id.name,
          convertBabelLoc(specifier.loc),
        );

        id.loc = specifier.loc;
        path.insertAfter(
          EXPORT_TEMPLATE({
            EXPORTS: getExportsIdentifier(asset, path.scope),
            NAME: t.stringLiteral(exported.name),
            LOCAL: id,
          }),
        );
      }

      addImport(asset, path);
      path.remove();
    } else if (declaration) {
      if (isIdentifier(declaration.id)) {
        addExport(asset, path, declaration.id, declaration.id);
      } else {
        let identifiers = t.getBindingIdentifiers(declaration);
        for (let id of Object.keys(identifiers)) {
          addExport(asset, path, identifiers[id], identifiers[id]);
        }
      }

      path.replaceWith(declaration);
    } else {
      for (let specifier of specifiers) {
        invariant(isExportSpecifier(specifier)); // because source is empty
        addExport(asset, path, specifier.local, specifier.exported);
      }
      path.remove();
    }
  },

  ExportAllDeclaration(path, asset) {
    let dep = asset
      .getDependencies()
      .find(dep => dep.moduleSpecifier === path.node.source.value);
    if (dep) {
      dep.meta.isES6Module = true;
      dep.symbols.ensure();
      dep.symbols.set('*', '*', convertBabelLoc(path.node.loc), true);
    }

    let replacement = EXPORT_ALL_TEMPLATE({
      OLD_NAME: getExportsIdentifier(asset, path.scope),
      SOURCE: t.stringLiteral(path.node.source.value),
      ID: t.stringLiteral(asset.id),
    });

    let {parentPath, scope} = path;
    path.remove();

    // Make sure that the relative order of imports and reexports is retained.
    let lastImport = scope.getData('hoistedImport');
    if (lastImport) {
      [lastImport] = lastImport.insertAfter(replacement);
    } else {
      [lastImport] = parentPath.unshiftContainer('body', [replacement]);
    }
    path.scope.setData('hoistedImport', lastImport);
  },
};

function isPure(binding) {
  if (!binding || !binding.constant) {
    return false;
  }

  let references = binding.referencePaths.filter(
    reference => !reference.isExportDeclaration(),
  );
  if (references.length > 0) {
    return false;
  }

  let path = binding.path;
  if (isVariableDeclarator(path.node) && isIdentifier(path.node.id)) {
    let init = path.get<NodePath<Expression>>('init');
    return init.isPure() || init.isIdentifier() || init.isThisExpression();
  }

  return path.isPure();
}

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

  let assignNode = EXPORT_TEMPLATE({
    EXPORTS: getExportsIdentifier(asset, scope),
    NAME: t.stringLiteral(exported.name),
    LOCAL: identifier,
  });

  if (!asset.symbols.hasExportSymbol(exported.name)) {
    let binding = scope.getBinding(local.name);
    asset.symbols.set(
      exported.name,
      identifier.name,
      convertBabelLoc(exported.loc),
      {isPure: isPure(binding)},
    );
  }

  rename(scope, local.name, identifier.name);

  path.insertAfter(t.cloneDeep(assignNode));
}

function hasImport(asset: MutableAsset, id: string) {
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

function safeRename(path, asset, from, to) {
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

function isUnusedValue(path: NodePath<Node>): boolean {
  let {parent} = path;
  return (
    isExpressionStatement(parent) ||
    (isSequenceExpression(parent) &&
      ((Array.isArray(path.container) &&
        path.key !== path.container.length - 1) ||
        isUnusedValue(path.parentPath)))
  );
}

function addSelfReference(
  path: NodePath<Node>,
  asset: MutableAsset,
): ?Identifier {
  // If referencing a property on this/exports/module.exports, create a self-referencing dependency
  // to track that the symbol is used, and replace the member expression with.
  if (
    isStaticMemberExpression(path.parent, {object: path.node}) &&
    !isAssignmentExpression(path.parentPath.parent, {left: path.parent})
  ) {
    // $FlowFixMe
    let name = path.parent.property.name ?? path.parent.property.value;

    // Do not create a self-reference for the `default` symbol unless we have seen an __esModule flag.
    if (name === 'default' && !asset.symbols.hasExportSymbol('__esModule')) {
      return;
    }

    let local = getExportIdentifier(asset, name);
    asset.addDependency({
      moduleSpecifier: `./${basename(asset.filePath)}`,
      symbols: new Map([
        [
          name,
          {
            local: local.name,
            isWeak: false,
            loc: convertBabelLoc(path.node.loc),
          },
        ],
      ]),
    });

    return local;
  }
}

function isStaticMemberExpression(node: Node, opts: any): boolean {
  return (
    isMemberExpression(node, opts) &&
    ((isIdentifier(node.property) && !node.computed) ||
      isStringLiteral(node.property))
  );
}
