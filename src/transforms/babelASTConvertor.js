const traverse = require('@babel/traverse').default;

// Convert between babel 7 and babel 6 AST
module.exports = function(ast, version) {
  if (version !== 7) {
    throw new Error(
      'Only Babel 7 ASTs can currently be converted to a Babel 6 compat mode'
    );
  }

  const visitor = {
    ArrowFunctionExpression: node => {
      node.expression = node.body.type !== 'BlockStatement';
    },
    ExistsTypeAnnotation: node => {
      node.type = 'ExistentialTypeParam';
    },
    NumberLiteralTypeAnnotation: node => {
      node.type = 'NumericLiteralTypeAnnotation';
    },
    ObjectTypeIndexer: node => {
      node.end++;
      node.loc.end.column++;
    },
    ForOfStatement: node => {
      node.type = 'ForAwaitStatement';
      delete node.await;
    },
    SpreadElement: (node, path) => {
      if (
        path.parentPath.isObjectExpression() ||
        path.parentPath.isArrayExpression()
      ) {
        node.type = 'SpreadProperty';
      }
    },
    RestElement: (node, path) => {
      if (
        path.parentPath.isObjectPattern() ||
        path.parentPath.isArrayPattern()
      ) {
        node.type = 'RestProperty';
      }
    }
  };

  traverse(ast, {
    enter(path) {
      if (path.node.variance && path.node.variance.type === 'Variance') {
        path.node.variance = path.node.variance.kind;
      }

      let visitorFunc = visitor[path.node.type];
      if (visitorFunc) {
        visitorFunc(path.node, path);
      }
    }
  });

  return ast;
};
