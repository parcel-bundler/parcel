// @flow
import ts from 'typescript';

export function getExportedName(node: any): ?string {
  if (!node.modifiers) {
    return null;
  }

  if (!node.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
    return null;
  }

  if (node.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) {
    return 'default';
  }

  return node.name.text;
}

export function isDeclaration(node: any): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  );
}
