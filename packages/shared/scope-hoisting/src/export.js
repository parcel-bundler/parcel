// @flow
import type {Symbol} from '@parcel/types';
import nullthrows from 'nullthrows';
import rename from './renamer';
import * as t from '@babel/types';

// Adds export statements for the declarations of each of the exported identifiers.
export default function addExports(
  path: any,
  exportedIdentifiers: Map<Symbol, Symbol>
) {
  let exported = new Set<Symbol>();

  path.traverse({
    Declaration(path) {
      if (path.isExportDeclaration() || path.parentPath.isExportDeclaration()) {
        return;
      }

      let bindingIdentifiers = path.getBindingIdentifierPaths(false, true);
      let ids = Object.keys(bindingIdentifiers);
      let exportedIds = ids.filter(
        id =>
          exportedIdentifiers.has(id) &&
          exportedIdentifiers.get(id) !== 'default'
      );
      let defaultExport = ids.find(
        id => exportedIdentifiers.get(id) === 'default'
      );

      // If all exports in the binding are named exports, export the entire declaration.
      // Also rename all of the identifiers to their exported name.
      if (exportedIds.length === ids.length) {
        path.replaceWith(t.exportNamedDeclaration(path.node, []));
        for (let id of exportedIds) {
          let exportName = nullthrows(exportedIdentifiers.get(id));
          rename(path.scope, id, exportName);
          exported.add(exportName);
        }

        // If there is only a default export, export the entire declaration.
      } else if (
        ids.length === 1 &&
        defaultExport &&
        !path.isVariableDeclaration()
      ) {
        path.replaceWith(t.exportDefaultDeclaration(path.node));

        // Otherwise, add export statements after for each identifier.
      } else {
        if (defaultExport) {
          path.insertAfter(
            t.exportDefaultDeclaration(t.identifier(defaultExport))
          );
        }

        if (exportedIds.length > 0) {
          let specifiers = [];
          for (let id of exportedIds) {
            let exportName = nullthrows(exportedIdentifiers.get(id));
            rename(path.scope, id, exportName);
            exported.add(exportName);
            specifiers.push(
              t.exportSpecifier(
                t.identifier(exportName),
                t.identifier(exportName)
              )
            );
          }

          path.insertAfter(t.exportNamedDeclaration(null, specifiers));
        }
      }
    }
  });

  return exported;
}
