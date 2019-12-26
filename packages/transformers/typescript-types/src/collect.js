// @flow
import {TSModule} from './TSModule';
import type {TSModuleGraph} from './TSModuleGraph';
import typeof TypeScriptModule from 'typescript'; // eslint-disable-line import/no-extraneous-dependencies
import {getExportedName, isDeclaration} from './utils';

export function collect(
  ts: TypeScriptModule,
  moduleGraph: TSModuleGraph,
  context: any,
  sourceFile: any,
) {
  let currentModule: ?TSModule;
  let visit = (node: any): any => {
    if (ts.isBundle(node)) {
      return ts.updateBundle(node, ts.visitNodes(node.sourceFiles, visit));
    }

    if (ts.isModuleDeclaration(node)) {
      currentModule = new TSModule();
      moduleGraph.addModule(node.name.text, currentModule);
    }

    if (!currentModule) {
      return ts.visitEachChild(node, visit, context);
    }

    if (ts.isImportDeclaration(node) && node.importClause) {
      if (node.importClause.namedBindings) {
        if (node.importClause.namedBindings.elements) {
          for (let element of node.importClause.namedBindings.elements) {
            currentModule.addImport(
              element.name.text,
              node.moduleSpecifier.text,
              (element.propertyName ?? element.name).text,
            );
          }
        } else if (node.importClause.namedBindings.name) {
          currentModule.addImport(
            node.importClause.namedBindings.name.text,
            node.moduleSpecifier.text,
            '*',
          );
        }
      } else if (node.importClause.name) {
        currentModule.addImport(
          node.importClause.name,
          node.moduleSpecifier.text,
          'default',
        );
      }
    }

    if (ts.isExportDeclaration(node)) {
      if (node.exportClause) {
        for (let element of node.exportClause.elements) {
          if (node.moduleSpecifier) {
            currentModule.addExport(
              element.name.text,
              (element.propertyName ?? element.name).text,
              node.moduleSpecifier.text,
            );
          } else {
            currentModule.addExport(
              element.name.text,
              (element.propertyName ?? element.name).text,
            );
          }
        }
      } else {
        currentModule.addWildcardExport(node.moduleSpecifier.text);
      }
    }

    if (isDeclaration(ts, node)) {
      if (node.name) {
        currentModule.addLocal(node.name.text, node);
      }

      let name = getExportedName(ts, node);
      if (name) {
        currentModule.addLocal(name, node);
        currentModule.addExport(name, name);
      }
    }

    if (ts.isVariableStatement(node)) {
      let isExported = node.modifiers.some(
        m => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      for (let v of node.declarationList.declarations) {
        currentModule.addLocal(v.name.text, v);
        if (isExported) {
          currentModule.addExport(v.name.text, v.name.text);
        }
      }
    }

    return ts.visitEachChild(node, visit, context);
  };

  return ts.visitNode(sourceFile, visit);
}
