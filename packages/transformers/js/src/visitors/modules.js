// @flow strict-local
import type {ScopeState, Visitors} from '@parcel/babylon-walk';
import type {
  ImportDeclaration,
  ExportAllDeclaration,
  ExportNamedDeclaration,
  Identifier,
  Expression,
} from '@babel/types';
import {MutableAsset} from '@parcel/types';
import * as t from '@babel/types';
import {
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isImportDefaultSpecifier,
  isImportNamespaceSpecifier,
  isExportAllDeclaration,
  isExportNamespaceSpecifier,
  isExportDefaultSpecifier,
  isExportSpecifier,
  isFunctionDeclaration,
} from '@babel/types';
import {
  traverse2,
  REMOVE,
  mergeVisitors,
  Scope,
  scopeVisitor,
} from '@parcel/babylon-walk';
import invariant from 'assert';
import path from 'path';
import {normalizeSeparators} from '@parcel/utils';

type State = {|
  ...ScopeState,
  imports: Array<
    ImportDeclaration | ExportAllDeclaration | ExportNamedDeclaration,
  >,
  importNames: Map<
    string,
    {|name: string, default: string, namespace: string|},
  >,
  exports: Array<{|local: Expression, exported: Identifier|}>,
  needsInteropFlag: boolean,
|};

let modulesVisitor: Visitors<State> = {
  Identifier(node, state, ancestors) {
    let parent = ancestors[ancestors.length - 2];
    if (!t.isReferenced(node, parent, ancestors[ancestors.length - 3])) {
      return;
    }
    let {scope} = state;

    return () => {
      let binding = scope.getBinding(node.name);
      if (!binding || !isImportDeclaration(binding)) {
        return;
      }

      let specifier = binding.specifiers.find(
        specifier => specifier.local.name === node.name,
      );
      if (isImportSpecifier(specifier)) {
        return getSpecifier(state, binding.source, specifier.imported.name);
      } else if (isImportNamespaceSpecifier(specifier)) {
        return getNamespace(state, binding.source);
      } else if (isImportDefaultSpecifier(specifier)) {
        return getDefault(state, binding.source);
      }
    };
  },
  ImportDeclaration: {
    exit(node, {imports}) {
      imports.push(node);
      return REMOVE;
    },
  },
  ExportNamedDeclaration: {
    exit(node, state) {
      let {exports, imports} = state;
      let {declaration, source, specifiers} = node;

      state.needsInteropFlag = true;

      if (source) {
        imports.push(node);
        return () => {
          for (let specifier of specifiers) {
            let local;
            if (isExportNamespaceSpecifier(specifier)) {
              local = getNamespace(state, source);
            } else if (isExportDefaultSpecifier(specifier)) {
              local = getDefault(state, source);
            } else if (isExportSpecifier(specifier)) {
              local =
                specifier.local.name === 'default'
                  ? getDefault(state, source)
                  : getSpecifier(state, source, specifier.local.name);
            } else {
              throw new Error('Unknown specifier type: ' + specifier.type);
            }

            exports.push({exported: specifier.exported, local});
          }

          return REMOVE;
        };
      } else if (declaration) {
        if (
          isFunctionDeclaration(declaration) &&
          isIdentifier(declaration.id)
        ) {
          let name = declaration.id.name;
          exports.push({
            local: t.identifier(name),
            exported: t.identifier(name),
          });
        } else {
          // Find all binding identifiers, and insert assignments to `exports`
          let identifiers = t.getBindingIdentifiers(declaration);
          for (let id of Object.keys(identifiers)) {
            exports.push({local: t.identifier(id), exported: t.identifier(id)});
          }
        }

        return declaration;
      } else if (specifiers.length > 0) {
        // This must happen AFTER the Identifier visitor above replaces the specifiers
        // in the case of import foo from 'foo'; export {foo};
        return () => {
          // Add assignments to `exports` for each specifier
          for (let specifier of specifiers) {
            invariant(specifier.type === 'ExportSpecifier');
            exports.push({
              local: specifier.local,
              exported: specifier.exported,
            });
          }

          return REMOVE;
        };
      }

      return REMOVE;
    },
  },
  ExportAllDeclaration(node, state) {
    state.imports.push(node);
    state.needsInteropFlag = true;
    return REMOVE;
  },
  ExportDefaultDeclaration: {
    exit(node, state) {
      // This has to happen AFTER any referenced identifiers are replaced.
      return () => {
        let {declaration} = node;
        state.needsInteropFlag = true;

        // If the declaration has a name, insert an assignment to `exports` afterward.
        if (declaration.id != null && isIdentifier(declaration.id)) {
          let id = t.identifier(declaration.id.name);
          state.scope.addReference(id);

          return [
            declaration,
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(
                  t.identifier('exports'),
                  t.identifier('default'),
                ),
                id,
              ),
            ),
          ];
        } else if (declaration.type !== 'TSDeclareFunction') {
          // Replace with an assignment to `exports`.
          return t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(
                t.identifier('exports'),
                t.identifier('default'),
              ),
              t.toExpression(declaration),
            ),
          );
        } else {
          return REMOVE;
        }
      };
    },
  },
  ThisExpression(node, {scope}, ancestors) {
    let s = scope;
    while (s) {
      if (s.type === 'function') {
        return;
      }

      s = s.parent;
    }

    if (ancestors.some(a => t.isClassBody(a))) {
      return;
    }

    return t.identifier('undefined');
  },
};

function getNames(state, source) {
  let names = state.importNames.get(source.value);
  if (!names) {
    let name = state.scope.generateUid(source.value);
    names = {name, namespace: '', default: ''};
    state.importNames.set(source.value, names);
  }

  return names;
}

function getSpecifier(state, source, name) {
  let names = getNames(state, source);
  return t.memberExpression(t.identifier(names.name), t.identifier(name));
}

function getDefault(state, source) {
  let names = getNames(state, source);
  if (!names.default) {
    names.default = state.scope.generateUid(names.name + 'Default');
  }
  return t.memberExpression(
    t.identifier(names.default),
    t.identifier('default'),
  );
}

function getNamespace(state, source) {
  // Interop between import namespace declarations and CJS is very inconsistent.
  // Node always returns {default: module.exports}.
  // Babel does the same for functions and primative values, but for objects returns
  // {...module.exports, default: module.exports}.
  // Parcel currently just returns the original module.exports in scope hoisting.
  // Doing the same here to match for now, but we should revisit this.
  let names = getNames(state, source);
  // if (!names.namespace) {
  //   names.namespace = state.scope.generateUid(names.name + 'Namespace');
  // }
  return t.identifier(names.name);
}

const visitor = mergeVisitors(scopeVisitor, modulesVisitor);

export function esm2cjs(ast: BabelNodeFile, asset?: MutableAsset) {
  let imports = [];
  let importNames = new Map();
  let scope = new Scope('program');
  let exports = [];
  let state: State = {
    imports,
    importNames,
    exports,
    needsInteropFlag: false,
    scope,
  };

  traverse2(ast, visitor, state);

  let body = ast.program.body;
  let prepend = [];
  let helpersId;
  let addHelpers = () => {
    if (helpersId) {
      return helpersId;
    }

    // Add a dependency so Parcel includes the helpers
    let moduleRoot = path.resolve(__dirname, '..', '..');
    let helpersPath = path.resolve(__dirname, '..', 'esmodule-helpers.js');
    let helperSpecifier = `@parcel/transformer-js/${normalizeSeparators(
      path.relative(moduleRoot, helpersPath),
    )}`;
    asset?.addDependency({
      moduleSpecifier: helperSpecifier,
      resolveFrom: __filename,
      env: {
        includeNodeModules: {
          '@parcel/transformer-js': true,
        },
      },
    });

    helpersId = scope.generateUid('parcelHelpers');
    prepend.push(
      t.variableDeclaration('var', [
        t.variableDeclarator(
          t.identifier(helpersId),
          t.callExpression(t.identifier('require'), [
            t.stringLiteral(helperSpecifier),
          ]),
        ),
      ]),
    );

    return helpersId;
  };

  if (state.needsInteropFlag) {
    prepend.push(
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(
            t.identifier(addHelpers()),
            t.identifier('defineInteropFlag'),
          ),
          [t.identifier('exports')],
        ),
      ),
    );
  }

  for (let {local, exported} of exports) {
    prepend.push(
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(
            t.identifier(addHelpers()),
            t.identifier('export'),
          ),
          [
            t.identifier('exports'),
            t.stringLiteral(exported.name),
            t.functionExpression(
              null,
              [],
              t.blockStatement([t.returnStatement(local)]),
            ),
          ],
        ),
      ),
    );
  }

  for (let imp of imports) {
    invariant(imp.source != null);
    let source = imp.source;

    // If the result of the import is unused, simply insert a require call.
    if (!state.importNames.has(source.value) && !isExportAllDeclaration(imp)) {
      prepend.push(
        t.expressionStatement(
          t.callExpression(t.identifier('require'), [source]),
        ),
      );
      continue;
    }

    let names = getNames(state, source);

    if (!scope.bindings.has(names.name)) {
      let decl = t.variableDeclaration('var', [
        t.variableDeclarator(
          t.identifier(names.name),
          t.callExpression(t.identifier('require'), [source]),
        ),
      ]);

      prepend.push(decl);
      scope.addBinding(names.name, decl, 'var');
    }

    if (isExportAllDeclaration(imp)) {
      prepend.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.identifier(addHelpers()),
              t.identifier('exportAll'),
            ),
            [t.identifier(names.name), t.identifier('exports')],
          ),
        ),
      );
    }

    if (names.default) {
      prepend.push(
        t.variableDeclaration('var', [
          t.variableDeclarator(
            t.identifier(names.default),
            t.callExpression(
              t.memberExpression(
                t.identifier(addHelpers()),
                t.identifier('interopDefault'),
              ),
              [t.identifier(names.name)],
            ),
          ),
        ]),
      );
    }

    // if (names.namespace) {
    //   prepend.push(
    //     t.variableDeclaration('var', [
    //       t.variableDeclarator(
    //         t.identifier(names.namespace),
    //         t.callExpression(
    //           t.memberExpression(
    //             t.identifier(addHelpers()),
    //             t.identifier('namespace'),
    //           ),
    //           [t.identifier(names.name)],
    //         ),
    //       ),
    //     ]),
    //   );
    // }
  }

  body.unshift(...prepend);
}
