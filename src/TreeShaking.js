const traverse = require('babel-traverse').default;
const Path = require('path');

class TreeShaking {
  constructor(asset) {
    this.asset = asset;
    this.assetPath = Path.dirname(asset.name);

    this.usedImports = new Map();
  }

  getRequiredExports(parents) {
    const requiredExports = new Set();
    for (let parent of parents) {
      if (parent.treeShaker) {
        const parentImports = parent.treeShaker.usedImports.get(
          this.asset.name
        );
        if (parentImports) {
          for (let parentImport of parentImports) {
            if (!requiredExports.has(parentImport)) {
              requiredExports.add(parentImport);
            }
          }
        }
      }
    }
    return requiredExports;
  }

  treeShakeExports(parents) {
    const requiredExports = this.getRequiredExports(parents);
    // TODO: Remove all unused code
    console.log(requiredExports);
  }

  addImport(key, {property, file}) {
    key = Path.join(this.assetPath, `${key}.${this.asset.type}`);
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
