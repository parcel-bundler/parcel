import * as types from '@babel/types';

export function hasBinding(node, name) {
  if (Array.isArray(node)) {
    return node.some(ancestor => hasBinding(ancestor, name));
  } else if (
    types.isProgram(node) ||
    types.isBlockStatement(node) ||
    types.isBlock(node)
  ) {
    return node.body.some(statement => hasBinding(statement, name));
  } else if (
    types.isFunctionDeclaration(node) ||
    types.isFunctionExpression(node) ||
    types.isArrowFunctionExpression(node)
  ) {
    return (
      (node.id && node.id.name === name) ||
      node.params.some(
        param => types.isIdentifier(param) && param.name === name
      )
    );
  } else if (types.isVariableDeclaration(node)) {
    return node.declarations.some(declaration => declaration.id.name === name);
  }

  return false;
}
