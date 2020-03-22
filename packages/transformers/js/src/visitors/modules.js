// @flow
import type {Visitor, NodePath} from '@babel/traverse';
import type {MutableAsset} from '@parcel/types';
import * as t from '@babel/types';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import Path from 'path';

type Opts = {|
  asset: MutableAsset,
  helpersId?: ?string,
  addedInteropFlag?: boolean,
|};

export default ({
  Program(path, opts) {
    // If the AST is dirty from prior Babel transforms, crawl to ensure the scope is up to date
    if (nullthrows(opts.asset.ast).isDirty) {
      path.scope.crawl();
    }
  },

  ImportDeclaration(path, opts) {
    // Hoist require call to the top of the file
    let name = path.scope.generateUid(path.node.source.value);
    path.scope.push({
      id: t.identifier(name),
      init: t.callExpression(t.identifier('require'), [path.node.source]),
    });

    let namespaceName;
    let defaultName;

    for (let specifier of path.node.specifiers) {
      if (t.isImportDefaultSpecifier(specifier)) {
        invariant(specifier.type === 'ImportDefaultSpecifier');
        let binding = path.scope.getBinding(specifier.local.name);
        if (binding) {
          // Generate name for interop default variable if needed
          if (!defaultName) {
            defaultName = path.scope.generateUid(name + 'Default');
          }

          for (let reference of binding.referencePaths) {
            reference.replaceWith(t.identifier(defaultName));
          }
        }
      } else if (t.isImportNamespaceSpecifier(specifier)) {
        invariant(specifier.type === 'ImportNamespaceSpecifier');
        let binding = path.scope.getBinding(specifier.local.name);
        if (binding) {
          // Generate name for interop namespace variable if needed
          if (!namespaceName) {
            namespaceName = path.scope.generateUid(name + 'Namespace');
          }

          for (let reference of binding.referencePaths) {
            reference.replaceWith(t.identifier(namespaceName));
          }
        }
      } else if (t.isImportSpecifier(specifier)) {
        invariant(specifier.type === 'ImportSpecifier');
        let binding = path.scope.getBinding(specifier.local.name);
        if (binding) {
          for (let reference of binding.referencePaths) {
            // If the reference is inside an export specifier, treat it like a re-export
            if (t.isExportSpecifier(reference.parent)) {
              let exportSpecifier = ((reference.parent: any): BabelNodeExportSpecifier);

              addHelpers(path, opts);
              reference.parentPath.parentPath.insertAfter(
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(
                      t.identifier(nullthrows(opts.helpersId)),
                      t.identifier('reexport'),
                    ),
                    [
                      t.identifier('exports'),
                      t.stringLiteral(exportSpecifier.exported.name),
                      t.identifier(name),
                      t.stringLiteral(specifier.imported.name),
                    ],
                  ),
                ),
              );

              reference.parentPath.remove();
            } else {
              // Otherwise, replace the reference with a member expression of the required exports object
              reference.replaceWith(
                t.memberExpression(
                  t.identifier(name),
                  t.identifier(specifier.imported.name),
                ),
              );
            }
          }
        }
      }

      // Add helpers if needed
      if (namespaceName || defaultName) {
        addHelpers(path, opts);
      }

      // Create interop namespace variable if needed
      if (namespaceName) {
        path.scope.push({
          id: t.identifier(namespaceName),
          init: t.callExpression(
            t.memberExpression(
              t.identifier(nullthrows(opts.helpersId)),
              t.identifier('namespace'),
            ),
            [t.identifier(name)],
          ),
        });
      }

      // Create interop default variable if needed
      if (defaultName) {
        path.scope.push({
          id: t.identifier(defaultName),
          init: t.callExpression(
            t.memberExpression(
              t.identifier(nullthrows(opts.helpersId)),
              t.identifier('interopDefault'),
            ),
            [t.identifier(name)],
          ),
        });
      }
    }

    path.remove();
  },

  ExportNamedDeclaration(path, opts) {
    let {declaration, source, specifiers} = path.node;
    let bindings = new Map();

    if (source) {
      // Hoist require call to the top of the file
      let name = path.scope.generateUid(source.value);
      path.scope.push({
        id: t.identifier(name),
        init: t.callExpression(t.identifier('require'), [source]),
      });

      addHelpers(path, opts);

      let statements = [];
      for (let specifier of specifiers) {
        if (t.isExportDefaultSpecifier(specifier)) {
          invariant(specifier.type === 'ExportDefaultSpecifier');
          throw new Error('TODO: export extensions are not implemented');
        } else if (t.isExportNamespaceSpecifier(specifier)) {
          invariant(specifier.type === 'ExportNamespaceSpecifier');
          throw new Error('TODO: export extensions are not implemented');
        } else if (t.isExportSpecifier(specifier)) {
          // Add call to reexport helper to generate a getter
          invariant(specifier.type === 'ExportSpecifier');
          statements.push(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.identifier(nullthrows(opts.helpersId)),
                  t.identifier('reexport'),
                ),
                [
                  t.identifier('exports'),
                  t.stringLiteral(specifier.exported.name),
                  t.identifier(name),
                  t.stringLiteral(specifier.local.name),
                ],
              ),
            ),
          );
        }
      }

      path.replaceWithMultiple(statements);
    } else if (declaration) {
      if (t.isIdentifier(declaration.id)) {
        // Insert an assignment to `export` after the declaration
        path.insertAfter(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(
                t.identifier('exports'),
                t.identifier(declaration.id.name),
              ),
              t.identifier(declaration.id.name),
            ),
          ),
        );

        path.replaceWith(declaration);

        let binding = path.scope.getBinding(declaration.id);
        if (binding) {
          bindings.set(declaration.id, binding);
        }
      } else {
        // Find all binding identifiers, and insert assignments to `exports`
        let identifiers = t.getBindingIdentifiers(declaration);
        let statements = [];
        for (let id of Object.keys(identifiers)) {
          statements.push(
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(t.identifier('exports'), t.identifier(id)),
                t.identifier(id),
              ),
            ),
          );

          let binding = path.scope.getBinding(id);
          if (binding) {
            bindings.set(id, binding);
          }
        }

        path.insertAfter(statements);
        path.replaceWith(declaration);
      }
    } else if (specifiers.length > 0) {
      // Add assignments to `exports` for each specifier
      let statements = [];
      for (let specifier of specifiers) {
        invariant(specifier.type === 'ExportSpecifier');
        statements.push(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(
                t.identifier('exports'),
                t.identifier(specifier.exported.name),
              ),
              t.identifier(specifier.local.name),
            ),
          ),
        );

        let binding = path.scope.getBinding(specifier.local.name);
        if (binding) {
          bindings.set(specifier.local.name, binding);
        }
      }

      path.replaceWithMultiple(statements);

      // ES modules export live bindings. For each constant violation, add an assignment to `exports`.
      for (let [name, binding] of bindings) {
        for (let violation of binding.constantViolations) {
          violation.insertAfter(
            t.assignmentExpression(
              '=',
              t.memberExpression(t.identifier('exports'), t.identifier(name)),
              t.identifier(name),
            ),
          );
        }
      }
    } else {
      path.remove();
    }

    // Add __esModule interop flag at the top of the file if needed
    addInteropFlag(path, opts);
  },

  ExportAllDeclaration(path, opts) {
    // Hoist require call to the top of the file
    let name = path.scope.generateUid(path.node.source.value);
    path.scope.push({
      id: t.identifier(name),
      init: t.callExpression(t.identifier('require'), [path.node.source]),
    });

    // Call namespace helper to copy all exports from the source module to exports
    addHelpers(path, opts);
    path.replaceWith(
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(
            t.identifier(nullthrows(opts.helpersId)),
            t.identifier('namespace'),
          ),
          [t.identifier(name), t.identifier('exports')],
        ),
      ),
    );

    // Add __esModule interop flag at the top of the file if needed
    addInteropFlag(path, opts);
  },

  ExportDefaultDeclaration(path, opts) {
    let {declaration} = path.node;

    // If the declaration has a name, insert an assignment to `exports` afterward.
    if (declaration.id != null && t.isIdentifier(declaration.id)) {
      // Appease flow
      let id = ((declaration.id: any): BabelNodeIdentifier);

      path.insertAfter(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(
              t.identifier('exports'),
              t.identifier('default'),
            ),
            t.identifier(id.name),
          ),
        ),
      );

      path.replaceWith(declaration);
    } else if (declaration.type !== 'TSDeclareFunction') {
      // Replace with an assignment to `exports`.
      path.replaceWith(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(
              t.identifier('exports'),
              t.identifier('default'),
            ),
            t.toExpression(declaration),
          ),
        ),
      );
    } else {
      path.remove();
    }

    // Add __esModule interop flag at the top of the file if needed
    addInteropFlag(path, opts);
  },

  // We don't need to traverse any deeper than the top-level statement list, so skip everything else for performance.
  Statement(path) {
    path.skip();
  },

  Expression(path) {
    path.skip();
  },

  Declaration(path) {
    path.skip();
  },
}: Visitor<Opts>);

function addHelpers(path: NodePath<any>, opts: Opts) {
  if (opts.helpersId) {
    return;
  }

  // Don't add the helpers to the helpers file itself
  let helperPath = Path.join(__dirname, '..', 'helpers.js');
  if (opts.asset.filePath === helperPath) {
    return null;
  }

  // Add a dependency so Parcel includes the helpers
  let helperSpecifier = Path.relative(
    Path.dirname(opts.asset.filePath),
    helperPath,
  );
  opts.asset.addDependency({
    moduleSpecifier: helperSpecifier,
  });

  // Add a require for the helpers in the top-level scope
  opts.helpersId = path.scope.generateUid('parcelHelpers');
  path.scope.getProgramParent().push({
    id: t.identifier(nullthrows(opts.helpersId)),
    init: t.callExpression(t.identifier('require'), [
      t.stringLiteral(helperSpecifier),
    ]),
  });
}

function addInteropFlag(path: NodePath<any>, opts: Opts) {
  if (opts.addedInteropFlag) {
    return;
  }

  addHelpers(path, opts);
  if (!opts.helpersId) {
    return;
  }

  let binding = path.scope.getBinding(opts.helpersId);
  if (!binding) {
    return;
  }

  // Call the helper to define the __esModule interop flag
  binding.path
    .getStatementParent()
    .insertAfter(
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(
            t.identifier(nullthrows(opts.helpersId)),
            t.identifier('defineInteropFlag'),
          ),
          [t.identifier('exports')],
        ),
      ),
    );

  opts.addedInteropFlag = true;
}
