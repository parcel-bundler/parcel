// @flow
import type {AST, MutableAsset, PluginOptions} from '@parcel/types';
import type {PluginLogger} from '@parcel/logger';
import type {Visitor, NodePath} from '@babel/traverse';
import type {CallExpression, Node, StringLiteral} from '@babel/types';

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
import invariant from 'assert';
import Path from 'path';
import template from '@babel/template';
import {errorToDiagnostic} from '@parcel/diagnostic';
import {convertBabelLoc} from '@parcel/babel-ast-utils';

const bufferTemplate = template.expression<
  {|CONTENT: StringLiteral|},
  CallExpression,
>('Buffer.from(CONTENT, "base64")');

const throwErrorTemplate = template.expression<null, CallExpression>(
  `(function(){
  let e = new Error("ENOENT: no such file or directory, open '...'")
  e.code = 'ENOENT';
  throw e;
})()`,
  {syntacticPlaceholders: true},
);

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

  CallExpression(path, {asset, logger, ast, options, inlineFS}) {
    if (referencesImport(path, 'fs', 'readFileSync')) {
      let vars = {
        __dirname: Path.dirname(asset.filePath),
        __filename: Path.basename(asset.filePath),
      };

      let filename, args, res;
      if (inlineFS) {
        try {
          [filename, ...args] = (path
            .get('arguments')
            .map(arg => evaluate(arg, vars)): Array<string>);

          filename = Path.resolve(filename);
          if (!Path.relative(options.projectRoot, filename).startsWith('..')) {
            res = options.inputFS.readFileSync(filename, ...args);
          }
        } catch (_err) {
          let err: Error = _err;

          if (err instanceof NodeNotEvaluatedError) {
            // Warn using a code frame
            err.fileName = asset.filePath;

            // $FlowFixMe the actual stack is useless
            delete err.stack;

            logger.warn(errorToDiagnostic(err));
            return;
          }

          // Add location info so we log a code frame with the error
          // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381
          err.loc =
            path.node.arguments.length > 0
              ? path.node.arguments[0].loc?.start
              : path.node.loc?.start;
          throw err;
        }
      }

      let replacementNode;
      if (filename && res) {
        if (Buffer.isBuffer(res)) {
          invariant(res != null);
          replacementNode = bufferTemplate({
            CONTENT: t.stringLiteral(res.toString('base64')),
          });
        } else {
          invariant(typeof res === 'string');
          replacementNode = t.stringLiteral(res);
        }

        invariant(filename != null);
        asset.addIncludedFile(filename);
      } else {
        let loc = convertBabelLoc(path.node.loc);
        if (filename) {
          let e = {
            message:
              'Disallowing fs.readFileSync of file outside project root, replacing with an error',
            filePath: loc?.filePath ?? asset.filePath,
            codeFrame: loc
              ? {
                  codeHighlights: [{start: loc.start, end: loc.end}],
                }
              : undefined,
          };
          if (asset.isSource) {
            logger.warn(e);
          } else {
            logger.verbose(e);
          }
        } else {
          logger.verbose({
            message: 'Replacing fs.readFileSync with an error',
            filePath: loc?.filePath ?? asset.filePath,
            codeFrame: loc
              ? {
                  codeHighlights: [{start: loc.start, end: loc.end}],
                }
              : undefined,
            hints: ['You might want to enable `inlineFS`?'],
          });
        }

        replacementNode = throwErrorTemplate();
      }

      path.replaceWith(replacementNode);
      asset.setAST(ast); // mark dirty
    }
  },
}: Visitor<{|
  asset: MutableAsset,
  ast: AST,
  logger: PluginLogger,
  options: PluginOptions,
  inlineFS: boolean,
|}>);

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

  if (isImportDeclaration(parent)) {
    // e.g. import fs from 'fs';
    let {node: bindingPathNode} = bindingPath;
    if (
      isImportSpecifier(bindingPathNode) &&
      bindingPathNode.imported.name !== method
    ) {
      return false;
    }

    return parent.source.value === name;
  } else if (
    isVariableDeclarator(bindingNode) ||
    isAssignmentExpression(bindingNode)
  ) {
    // e.g. var ... = require('fs');
    let left = isVariableDeclarator(bindingNode)
      ? bindingNode.id
      : bindingNode.left;
    let right = isVariableDeclarator(bindingNode)
      ? bindingNode.init
      : bindingNode.right;

    if (isObjectPattern(left)) {
      // e.g. var {readFileSync} = require('fs');
      invariant(isIdentifier(callee));
      let prop = left.properties.find(
        p =>
          isObjectProperty(p) &&
          isIdentifier(p.value) &&
          p.value.name === callee.name,
      );
      invariant(!prop || isObjectProperty(prop));

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
