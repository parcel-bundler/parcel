const traverse = require('babel-traverse').default;

class TreeShaking {
  constructor() {
    this.usedImports = new Map();
  }

  addImport(key, {property, file}) {
    const importSet = this.usedImports.get(key);
    if (
      importSet &&
      importSet.properties &&
      !importSet.properties.has(property)
    ) {
      return importSet.properties.add(property);
    }
    const options = {
      file,
      properties: new Set()
    };
    if (property) {
      options.properties.add(property);
    }
    return this.usedImports.set(key, options);
  }

  importVisitor() {
    const visitor = {};
    visitor.VariableDeclaration = path => {
      path.node.declarations.forEach(declaration => {
        if (
          declaration.init &&
          declaration.init.callee &&
          declaration.init.callee.name === 'require'
        ) {
          this.addImport(declaration.id.name, {
            file: declaration.init.arguments[0].value
          });
        }
      });
    };
    visitor.MemberExpression = path => {
      if (
        path.node.object &&
        path.node.object.name &&
        path.node.property.name
      ) {
        if (this.usedImports.has(path.node.object.name)) {
          this.addImport(path.node.object.name, {
            property: path.node.property.name
          });
        }
      }
    };
    return visitor;
  }

  getUsedImports(ast) {
    if (!ast) {
      return;
    }
    traverse(ast, this.importVisitor(ast));
  }
}

module.exports = TreeShaking;
