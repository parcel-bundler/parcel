const t = require('@babel/types');

module.exports = {
  MemberExpression(path) {
    // Inline process.browser
    const isProcess = path.node.object.name === 'process';
    const isBrowser = path.node.property.name === 'browser';
    if (isProcess && isBrowser) {
      if (t.isAssignmentExpression(path.parentPath)) {
        path.parentPath.remove();
      } else {
        if (t.isIfStatement(path.parentPath)) {
          path.parentPath.replaceWith(path.parent.consequent);
        } else if (
          t.isUnaryExpression(path.parentPath) &&
          path.parent.operator === '!' &&
          t.isIfStatement(path.parentPath.parentPath)
        ) {
          if (path.parentPath.parent.alternate) {
            path.parentPath.parentPath.replaceWith(
              path.parentPath.parent.alternate
            );
          } else {
            path.parentPath.parentPath.remove();
          }
        } else {
          path.replaceWith(t.booleanLiteral(true));
        }
      }
    }
  }
};
