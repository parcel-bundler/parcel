// @flow
import type {MutableAsset} from '@parcel/types';
import type {PluginLogger} from '@parcel/logger';
import type {Visitor, NodePath} from '@babel/traverse';
import type {
  CallExpression,
  Node,
  ObjectProperty,
  StringLiteral,
} from '@babel/types';

import * as t from '@babel/types';
import {
  isAssignmentExpression,
  isCallExpression,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isMemberExpression,
  isObjectPattern,
  isObjectProperty,
  isStringLiteral,
  isVariableDeclarator,
} from '@babel/types';
import Path from 'path';
import fs from 'fs';
import template from '@babel/template';
import invariant from 'assert';
import {errorToDiagnostic} from '@parcel/diagnostic';

const bufferTemplate = template.expression<
  {|CONTENT: StringLiteral, ENC: StringLiteral|},
  CallExpression,
>('Buffer(CONTENT, ENC)');

export default ({
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

  CallExpression(path, {asset, logger}) {
    if (referencesImport(path, 'fs', 'readFileSync')) {
      let vars = {
        __dirname: Path.dirname(asset.filePath),
        __filename: Path.basename(asset.filePath),
      };

      try {
        let [filename, ...args] = (path
          .get('arguments')
          .map(arg => evaluate(arg, vars)): Array<string>);

        filename = Path.resolve(filename);
        let res = fs.readFileSync(filename, ...args);

        let replacementNode;
        if (Buffer.isBuffer(res)) {
          replacementNode = bufferTemplate({
            CONTENT: t.stringLiteral(res.toString('base64')),
            ENC: t.stringLiteral('base64'),
          });
        } else {
          // $FlowFixMe it is a string
          replacementNode = t.stringLiteral(res);
        }

        asset.addIncludedFile({
          filePath: filename,
        });

        path.replaceWith(replacementNode);
        invariant(asset.ast);
        asset.ast.isDirty = true;
      } catch (_err) {
        // $FlowFixMe yes it is an error
        let err: Error = _err;

        if (err instanceof NodeNotEvaluatedError) {
          // Warn using a code frame
          err.fileName = asset.filePath;

          // $FlowFixMe the actual stack is useless
          delete err.stack;

          logger.warn(errorToDiagnostic(err));
        } else {
          // Add location info so we log a code frame with the error
          err.loc =
            path.node.arguments.length > 0
              ? path.node.arguments[0].loc?.start
              : path.node.loc?.start;
          throw err;
        }
      }
    }
  },
}: Visitor<{|asset: MutableAsset, logger: PluginLogger|}>);

function isRequire(node, name, method) {
  // e.g. require('fs').readFileSync
  if (isMemberExpression(node) && node.property.name === method) {
    node = node.object;
  }

  if (!isCallExpression(node)) {
    return false;
  }

  let {callee, arguments: args} = node;
  let isRequire =
    isIdentifier(callee) &&
    callee.name === 'require' &&
    args.length === 1 &&
    isStringLiteral(args[0]);

  if (!isRequire) {
    return false;
  }

  if (name && args[0].value !== name) {
    return false;
  }

  return true;
}

function referencesImport(path: NodePath<CallExpression>, name, method) {
  let callee = path.node.callee;
  let bindingPath;

  // e.g. readFileSync()
  if (isIdentifier(callee)) {
    bindingPath = getBindingPath(path, callee.name);
  } else if (isMemberExpression(callee)) {
    if (callee.property.name !== method) {
      return false;
    }

    // e.g. fs.readFileSync()
    if (isIdentifier(callee.object)) {
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

  let bindingNode: Node = bindingPath.getData('__require') || bindingPath.node;
  let parent: Node = bindingPath.parent;

  // e.g. import fs from 'fs';
  if (isImportDeclaration(parent)) {
    let {node: bindingPathNode} = bindingPath;
    if (
      isImportSpecifier(bindingPathNode) &&
      bindingPathNode.imported.name !== method
    ) {
      return false;
    }

    return parent.source.value === name;

    // e.g. var fs = require('fs');
  } else if (
    isVariableDeclarator(bindingNode) ||
    isAssignmentExpression(bindingNode)
  ) {
    let left = isVariableDeclarator(bindingNode)
      ? bindingNode.id
      : bindingNode.left;
    let right = isVariableDeclarator(bindingNode)
      ? bindingNode.init
      : bindingNode.right;

    // e.g. var {readFileSync} = require('fs');
    if (isObjectPattern(left)) {
      invariant(isIdentifier(callee));
      let prop: ?ObjectProperty = (left.properties.map(p => {
        invariant(isObjectProperty(p));
        return p;
      }): Array<ObjectProperty>).find(
        p => isIdentifier(p.value) && p.value.name === callee.name,
      );
      if (!prop || prop.key.name !== method) {
        return false;
      }
    } else if (!isIdentifier(left)) {
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

class NodeNotEvaluatedError extends Error {
  node: Node;
  loc: ?{
    line: number,
    column: number,
    ...
  };
  constructor(node) {
    super();
    this.message = 'Cannot statically evaluate fs argument';
    this.node = node;
    this.loc = node.loc?.start;
  }
}
function evaluate(path: NodePath<Node>, vars) {
  // Inline variables
  path.traverse({
    Identifier(ident) {
      let key = ident.node.name;
      if (key in vars) {
        ident.replaceWith(t.valueToNode(vars[key]));
      }
    },
  });

  let {node} = path;
  if (
    isCallExpression(node) &&
    referencesImport(
      // $FlowFixMe yes it is
      (path: NodePath<CallExpression>),
      'path',
      'join',
    ) &&
    node.arguments.every(n => isStringLiteral(n))
  ) {
    // e.g. path.join("literal", "another_literal")
    return Path.join(
      ...node.arguments.map(n => {
        invariant(isStringLiteral(n));
        return n.value;
      }),
    );
  } else {
    // try to evaluate other cases
    let res = path.evaluate();
    if (!res.confident) {
      throw new NodeNotEvaluatedError(path.node);
    }
    return res.value;
  }
}
