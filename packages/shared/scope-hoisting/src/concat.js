// @flow
import type {Bundle, Asset, ParcelOptions} from '@parcel/types';
import * as babylon from '@babel/parser';
import path from 'path';
import * as t from '@babel/types';
import * as walk from 'babylon-walk';
import {getName, getIdentifier} from './utils';
import fs from 'fs';

const HELPERS_PATH = path.join(__dirname, 'helpers.js');
const HELPERS = fs.readFileSync(HELPERS_PATH, 'utf8');

const PRELUDE_PATH = path.join(__dirname, 'prelude.js');
const PRELUDE = fs.readFileSync(PRELUDE_PATH, 'utf8');

export async function concat(bundle: Bundle, options: ParcelOptions) {
  let promises = [];
  bundle.assetGraph.traverseAssets(asset => {
    promises.push(processAsset(bundle, asset));
  });
  let outputs = new Map(await Promise.all(promises));
  let result = [...parse(HELPERS, HELPERS_PATH)];

  // If this is an entry bundle and it has child bundles, we need to add the prelude code, which allows
  // registering modules dynamically at runtime.
  let hasChildBundles = !!Array.from(bundle.assetGraph.nodes.values()).find(
    node => node.type === 'bundle'
  );
  let needsPrelude = bundle.isEntry && hasChildBundles;
  let registerEntry = !bundle.isEntry || hasChildBundles;
  if (needsPrelude) {
    result.unshift(...parse(PRELUDE, PRELUDE_PATH));
  }

  bundle.assetGraph.traverseAssets({
    enter(asset, context) {
      return {
        parent: context && context.children,
        children: new Map()
      };
    },
    exit(asset, context) {
      let statements = outputs.get(asset);
      let statementIndices = new Map();
      for (let i = 0; i < statements.length; i++) {
        let statement = statements[i];
        if (t.isExpressionStatement(statement)) {
          for (let depAsset of findRequires(bundle, asset, statement)) {
            if (!statementIndices.has(depAsset)) {
              statementIndices.set(depAsset, i);
            }
          }
        }
      }

      for (let [asset, ast] of [...context.children].reverse()) {
        let index = statementIndices.has(asset)
          ? statementIndices.get(asset)
          : 0;
        statements.splice(index, 0, ...ast);
      }

      // If this module is referenced by another bundle, or is an entry module in a child bundle,
      // add code to register the module with the module system.
      if (asset.meta.isReferenced || (!context.parent && registerEntry)) {
        let exportsId = getName(asset, 'exports');
        statements.push(
          ...parse(`
          ${asset.meta.isES6Module ? `${exportsId}.__esModule = true;` : ''}
          parcelRequire.register("${asset.id}", ${exportsId});
        `)
        );
      }

      if (context.parent) {
        context.parent.set(asset, statements);
      } else {
        result.push(...statements);
      }
    }
  });

  let entry = bundle.assetGraph.getEntryAssets()[0];
  if (entry && bundle.isEntry) {
    let exportsIdentifier = getName(entry, 'exports');
    if (entry.output.code.includes(exportsIdentifier)) {
      result.push(
        ...parse(`
        if (typeof exports === "object" && typeof module !== "undefined") {
          // CommonJS
          module.exports = ${exportsIdentifier};
        } else if (typeof define === "function" && define.amd) {
          // RequireJS
          define(function () {
            return ${exportsIdentifier};
          });
        }
      `)
      );
    }
  }

  return t.file(t.program(result));
}

async function processAsset(bundle: Bundle, asset: Asset) {
  let output = await asset.getOutput();
  let statements = parse(output.code, asset.filePath);

  if (statements[0]) {
    addComment(statements[0], ` ASSET: ${asset.filePath}`);
  }

  if (shouldWrap(bundle, asset)) {
    statements = wrapModule(asset, statements);
  }

  return [asset, statements];
}

function parse(code, filename) {
  let ast = babylon.parse(code, {
    sourceFilename: filename,
    allowReturnOutsideFunction: true
  });

  return ast.program.body;
}

function addComment(statement, comment) {
  if (!statement.leadingComments) {
    statement.leadingComments = [];
  }
  statement.leadingComments.push({
    type: 'CommentLine',
    value: comment
  });
}

function findRequires(bundle: Bundle, asset: Asset, ast) {
  let result = [];
  walk.simple(ast, {
    CallExpression(node) {
      let {arguments: args, callee} = node;
      if (!t.isIdentifier(callee)) {
        return;
      }

      if (callee.name === '$parcel$require') {
        let dep = bundle.assetGraph
          .getDependencies(asset)
          .find(dep => dep.moduleSpecifier === args[1].value);
        if (!dep) {
          throw new Error(`Could not find dep for "${args[1].value}`);
        }
        result.push(bundle.assetGraph.getDependencyResolution(dep));
      }
    }
  });

  return result;
}

function shouldWrap(bundle: Bundle, asset: Asset) {
  if (asset.meta.shouldWrap != null) {
    return asset.meta.shouldWrap;
  }

  // We need to wrap if any of the deps are marked by the hoister, e.g.
  // when the dep is required inside a function or conditional.
  // We also need to wrap if any of the parents are wrapped - transitive requires
  // shouldn't be evaluated until their parents are.
  let shouldWrap = false;
  bundle.assetGraph.traverseAncestors(asset, (node, context, traversal) => {
    switch (node.type) {
      case 'dependency':
      case 'asset':
        if (node.value.meta.shouldWrap) {
          shouldWrap = true;
          traversal.stop();
        }
        break;
    }
  });

  asset.meta.shouldWrap = shouldWrap;
  return shouldWrap;
}

function wrapModule(asset: Asset, statements) {
  let body = [];
  let decls = [];
  let fns = [];
  for (let node of statements) {
    // Hoist all declarations out of the function wrapper
    // so that they can be referenced by other modules directly.
    if (t.isVariableDeclaration(node)) {
      for (let decl of node.declarations) {
        decls.push(t.variableDeclarator(decl.id));
        if (decl.init) {
          body.push(
            t.expressionStatement(
              t.assignmentExpression('=', t.identifier(decl.id.name), decl.init)
            )
          );
        }
      }
    } else if (t.isFunctionDeclaration(node)) {
      // Function declarations can be hoisted out of the module initialization function
      fns.push(node);
    } else if (t.isClassDeclaration(node)) {
      // Class declarations are not hoisted. We declare a variable outside the
      // function and convert to a class expression assignment.
      decls.push(t.variableDeclarator(t.identifier(node.id.name)));
      body.push(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.identifier(node.id.name),
            t.toExpression(node)
          )
        )
      );
    } else {
      body.push(node);
    }
  }

  let executed = getName(asset, 'executed');
  decls.push(
    t.variableDeclarator(t.identifier(executed), t.booleanLiteral(false))
  );

  let init = t.functionDeclaration(
    getIdentifier(asset, 'init'),
    [],
    t.blockStatement([
      t.ifStatement(t.identifier(executed), t.returnStatement()),
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.identifier(executed),
          t.booleanLiteral(true)
        )
      ),
      ...body
    ])
  );

  return [t.variableDeclaration('var', decls), ...fns, init];
}
