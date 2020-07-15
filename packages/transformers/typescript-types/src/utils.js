// @flow
import typeof TypeScriptModule from 'typescript'; // eslint-disable-line import/no-extraneous-dependencies

export function getExportedName(ts: TypeScriptModule, node: any): ?string {
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

export function isDeclaration(ts: TypeScriptModule, node: any): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  );
}
