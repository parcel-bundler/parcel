// @flow
import type {TSModuleGraph} from './TSModuleGraph';

import nullthrows from 'nullthrows';
import ts from 'typescript';
import {TSModule} from './TSModule';
import {getExportedName, isDeclaration} from './utils';

export function collect(
  moduleGraph: TSModuleGraph,
  context: any,
  sourceFile: any,
): any {
  // Factory only exists on TS >= 4.0
  const {factory = ts} = context;

  // When module definitions are nested inside each other (e.g with module augmentation),
  // we want to keep track of the hierarchy so we can associated nodes with the right module.
  const moduleStack: Array<?TSModule> = [];
  let _currentModule: ?TSModule;
  let visit = (node: any): any => {
    if (ts.isBundle(node)) {
      return factory.updateBundle(node, ts.visitNodes(node.sourceFiles, visit));
    }

    if (ts.isModuleDeclaration(node)) {
      moduleStack.push(_currentModule);
      _currentModule = new TSModule();
      moduleGraph.addModule(node.name.text, _currentModule);
    }

    if (!_currentModule) {
      return ts.visitEachChild(node, visit, context);
    }

    let currentModule = nullthrows(_currentModule);
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
      }

      if (node.importClause.name) {
        currentModule.addImport(
          node.importClause.name.text,
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

    // Handle `export default name;`
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
      currentModule.addExport('default', node.expression.text);
    }

    if (isDeclaration(node)) {
      if (node.name) {
        currentModule.addLocal(node.name.text, node);
      }

      let name = getExportedName(node);
      if (name) {
        currentModule.addLocal(name, node);
        currentModule.addExport(name, name);
      }
    }

    if (ts.isVariableStatement(node) && node.modifiers) {
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

    const results = ts.visitEachChild(node, visit, context);
    // After we finish traversing the children of a module definition,
    // we need to make sure that subsequent nodes get associated with the next-highest level module.
    if (ts.isModuleDeclaration(node)) {
      _currentModule = moduleStack.pop();
    }
    return results;
  };

  return ts.visitNode(sourceFile, visit);
}
