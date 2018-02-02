const traverse = require('babel-traverse').default;
const Path = require('path');

function getRequiredExports(asset, parents) {
  const requiredExports = new Set();
  for (let parent of parents) {
    let parentImports;
    for (let value of parent.usedImports.values()) {
      if (value.file === asset.name) {
        parentImports = value.properties;
      }
    }
    if (parentImports) {
      for (let parentImport of parentImports) {
        if (!requiredExports.has(parentImport)) {
          requiredExports.add(parentImport);
        }
      }
    }
  }
  return requiredExports;
}

function exportVisitor(asset, requiredExports) {
  const visitor = {};

  visitor.AssignmentExpression = path => {
    if (
      path.node.left &&
      path.node.left.object &&
      path.node.left.object.name === 'exports'
    ) {
      if (path.node.left.property) {
        if (!requiredExports.has(path.node.left.property.name)) {
          console.log('Dropping node: ', path.node.left.property.name);
          path.remove();
        }
      } else {
        if (!requiredExports.has('default')) {
          console.log('Dropping default export');
        }
      }
    }
  };

  return visitor;
}

function treeShakeExports(asset, parents) {
  if (!asset.ast) {
    return false;
  }

  const requiredExports = getRequiredExports(asset, parents);

  if (requiredExports.size > 0) {
    // This asset has used exports, remove unused ones
    traverse(asset.ast, exportVisitor(asset, requiredExports));
    asset.isAstDirty = true;
  } else if (parents.length > 0) {
    // This asset is never used, remove it
    asset.ast = null;
    asset.isAstDirty = true;
  } else {
    // This is probably the mainAsset
    asset.isAstDirty = false;
  }
  return asset.isAstDirty;
}

function addImport(asset, key, {property, file}) {
  const assetPath = Path.dirname(asset.name);
  file = Path.join(assetPath, `${file}.${asset.type}`);
  const importSet = asset.usedImports.get(key);
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
  return asset.usedImports.set(key, options);
}

function importVisitor(asset) {
  const visitor = {};
  visitor.VariableDeclaration = path => {
    path.node.declarations.forEach(declaration => {
      if (
        declaration.init &&
        declaration.init.callee &&
        declaration.init.callee.name === 'require'
      ) {
        addImport(asset, declaration.id.name, {
          file: declaration.init.arguments[0].value
        });
      }
    });
  };
  visitor.MemberExpression = path => {
    if (path.node.object && path.node.object.name) {
      if (asset.usedImports.has(path.node.object.name)) {
        addImport(asset, path.node.object.name, {
          property: path.node.property.name || 'default'
        });
      }
    }
  };
  return visitor;
}

function getUsedImports(asset) {
  if (!asset.ast) {
    return;
  }
  traverse(asset.ast, importVisitor(asset));
}

exports.treeShakeExports = treeShakeExports;
exports.getUsedImports = getUsedImports;
