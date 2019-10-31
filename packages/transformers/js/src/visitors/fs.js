import * as t from '@babel/types';
import Path from 'path';
import fs from 'fs';
import template from '@babel/template';
import logger from '@parcel/logger';

const bufferTemplate = template('Buffer(CONTENT, ENC)');

export default {
  AssignmentExpression(path) {
    if (!isRequire(path.node.right, 'fs', 'readFileSync')) {
      return;
    }

    for (let name in path.getBindingIdentifiers()) {
      const binding = path.scope.getBinding(name);
      if (!binding) continue;

      binding.path.setData('__require', path.node);
    }
  },

  CallExpression(path, asset) {
    if (referencesImport(path, 'fs', 'readFileSync')) {
      let vars = {
        __dirname: Path.dirname(asset.filePath),
        __filename: Path.basename(asset.filePath)
      };
      let filename, args, res;

      try {
        [filename, ...args] = path
          .get('arguments')
          .map(arg => evaluate(arg, vars));

        filename = Path.resolve(filename);
        res = fs.readFileSync(filename, ...args);
      } catch (err) {
        if (err instanceof NodeNotEvaluatedError) {
          // Warn using a code frame
          err.fileName = asset.filePath;
          // asset.generateErrorMessage(err);
          logger.warn(err);
          return;
        }

        // Add location info so we log a code frame with the error
        err.loc =
          path.node.arguments.length > 0
            ? path.node.arguments[0].loc.start
            : path.node.loc.start;
        throw err;
      }

      let replacementNode;
      if (Buffer.isBuffer(res)) {
        replacementNode = bufferTemplate({
          CONTENT: t.stringLiteral(res.toString('base64')),
          ENC: t.stringLiteral('base64')
        });
      } else {
        replacementNode = t.stringLiteral(res);
      }

      asset.addIncludedFile({
        filePath: filename
      });

      path.replaceWith(replacementNode);
      asset.ast.isDirty = true;
    }
  }
};

function isRequire(node, name, method) {
  // e.g. require('fs').readFileSync
  if (t.isMemberExpression(node) && node.property.name === method) {
    node = node.object;
  }

  if (!t.isCallExpression(node)) {
    return false;
  }

  let {callee, arguments: args} = node;
  let isRequire =
    t.isIdentifier(callee) &&
    callee.name === 'require' &&
    args.length === 1 &&
    t.isStringLiteral(args[0]);

  if (!isRequire) {
    return false;
  }

  if (name && args[0].value !== name) {
    return false;
  }

  return true;
}

function referencesImport(path, name, method) {
  let callee = path.node.callee;
  let bindingPath;

  // e.g. readFileSync()
  if (t.isIdentifier(callee)) {
    bindingPath = getBindingPath(path, callee.name);
  } else if (t.isMemberExpression(callee)) {
    if (callee.property.name !== method) {
      return false;
    }

    // e.g. fs.readFileSync()
    if (t.isIdentifier(callee.object)) {
      bindingPath = getBindingPath(path, callee.object.name);

      // require('fs').readFileSync()
    } else if (isRequire(callee.object, name)) {
      return true;
    }
  } else {
    return false;
  }

  if (!bindingPath) {
    return;
  }

  let bindingNode = bindingPath.getData('__require') || bindingPath.node;
  let parent = bindingPath.parentPath;

  // e.g. import fs from 'fs';
  if (parent.isImportDeclaration()) {
    if (
      bindingPath.isImportSpecifier() &&
      bindingPath.node.imported.name !== method
    ) {
      return false;
    }

    return parent.node.source.value === name;

    // e.g. var fs = require('fs');
  } else if (
    t.isVariableDeclarator(bindingNode) ||
    t.isAssignmentExpression(bindingNode)
  ) {
    let left = bindingNode.id || bindingNode.left;
    let right = bindingNode.init || bindingNode.right;

    // e.g. var {readFileSync} = require('fs');
    if (t.isObjectPattern(left)) {
      let prop = left.properties.find(p => p.value.name === callee.name);
      if (!prop || prop.key.name !== method) {
        return false;
      }
    } else if (!t.isIdentifier(left)) {
      return false;
    }

    return isRequire(right, name, method);
  }

  return false;
}

function getBindingPath(path, name) {
  let binding = path.scope.getBinding(name);
  return binding && binding.path;
}

function NodeNotEvaluatedError(node) {
  this.message = 'Cannot statically evaluate fs argument';
  this.node = node;
  this.loc = node.loc.start;
}

function evaluate(path, vars) {
  // Inline variables
  path.traverse({
    Identifier: function(ident) {
      let key = ident.node.name;
      if (key in vars) {
        ident.replaceWith(t.valueToNode(vars[key]));
      }
    }
  });

  if (
    path.isCallExpression() &&
    referencesImport(path, 'path', 'join') &&
    path.node.arguments.every(n => t.isStringLiteral(n))
  ) {
    // e.g. path.join("literal", "another_literal")
    return Path.join(...path.node.arguments.map(n => n.value));
  } else {
    // try to evaluate other cases
    let res = path.evaluate();
    if (!res.confident) {
      throw new NodeNotEvaluatedError(path.node);
    }
    return res.value;
  }
}
