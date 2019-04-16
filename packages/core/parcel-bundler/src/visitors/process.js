const t = require('@babel/types');

module.exports = {
  MemberExpression(path) {
    // Inline process.browser
    const isProcess = path.node.object.name === 'process';
    const isBrowser = path.node.property.name === 'browser';
    const isAssignment = path.parentPath.type === 'AssignmentExpression';
    if (isProcess && isBrowser) {
      if (isAssignment) {
        path.parentPath.remove();
      } else {
        path.replaceWith(t.booleanLiteral(true));
      }
    }
  }
};
