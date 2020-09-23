module.exports = function transformImportAttributesWebpack({types: t}) {
  return {
    visitor: {
      CallExpression(path) {
        const {callee, arguments: args} = path.node;
        if (callee.type !== 'Import' || args.length !== 2) {
          return;
        }

        const [specifierNode, attributesNode] = args;
        if (attributesNode.type !== 'ObjectExpression') {
          return;
        }

        const newProperties = [];
        for (const property of attributesNode.properties) {
          if (property.key.name === 'prefetch' && property.value.value) {
            t.addComment(specifierNode, 'leading', ' webpackPrefetch: true ');
          } else if (property.key.name === 'preload' && property.value.value) {
            t.addComment(specifierNode, 'leading', ' webpackPreload: true ');
          } else {
            newProperties.push(property);
          }
        }

        if (newProperties.length === 0) {
          args.pop();
        } else {
          attributesNode.properties = newProperties;
        }
      },
    },
  };
};
