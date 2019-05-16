import * as types from '@babel/types';
import traverse from '@babel/traverse';
import {isURL} from '@parcel/utils';
import nodeBuiltins from 'node-libs-browser';
import {hasBinding} from './utils';

const serviceWorkerPattern = ['navigator', 'serviceWorker', 'register'];

export default {
  ImportDeclaration(node, asset) {
    asset.meta.isES6Module = true;
    addDependency(asset, node.source);
  },

  ExportNamedDeclaration(node, asset) {
    asset.meta.isES6Module = true;
    if (node.source) {
      addDependency(asset, node.source);
    }
  },

  ExportAllDeclaration(node, asset) {
    asset.meta.isES6Module = true;
    addDependency(asset, node.source);
  },

  ExportDefaultDeclaration(node, asset) {
    asset.meta.isES6Module = true;
  },

  CallExpression(node, asset, ancestors) {
    let {callee, arguments: args} = node;

    let isRequire =
      types.isIdentifier(callee) &&
      callee.name === 'require' &&
      args.length === 1 &&
      types.isStringLiteral(args[0]) &&
      !hasBinding(ancestors, 'require') &&
      !isInFalsyBranch(ancestors);

    if (isRequire) {
      let isOptional =
        ancestors.some(a => types.isTryStatement(a)) || undefined;
      addDependency(asset, args[0], {isOptional});
      return;
    }

    let isDynamicImport =
      callee.type === 'Import' &&
      args.length === 1 &&
      types.isStringLiteral(args[0]);

    if (isDynamicImport) {
      // Ignore dynamic imports of fully specified urls
      if (isURL(args[0].value)) {
        return;
      }

      addDependency(asset, args[0], {isAsync: true});

      node.callee = types.identifier('require');
      asset.ast.isDirty = true;
      return;
    }

    const isRegisterServiceWorker =
      types.isStringLiteral(args[0]) &&
      types.matchesPattern(callee, serviceWorkerPattern);

    if (isRegisterServiceWorker) {
      // Treat service workers as an entry point so filenames remain consistent across builds.
      // https://developers.google.com/web/fundamentals/primers/service-workers/lifecycle#avoid_changing_the_url_of_your_service_worker_script
      addURLDependency(asset, args[0], {
        isEntry: true,
        env: {context: 'service-worker'}
      });
      return;
    }
  },

  NewExpression(node, asset) {
    const {callee, arguments: args} = node;

    const isWebWorker =
      callee.type === 'Identifier' &&
      (callee.name === 'Worker' || callee.name === 'SharedWorker') &&
      args.length === 1 &&
      types.isStringLiteral(args[0]);

    if (isWebWorker) {
      addURLDependency(asset, args[0], {env: {context: 'web-worker'}});
      return;
    }
  }
};

function isInFalsyBranch(ancestors) {
  // Check if any ancestors are if statements
  return ancestors.some((node, index) => {
    if (types.isIfStatement(node)) {
      let res = evaluateExpression(node.test);
      if (res && res.confident) {
        // If the test is truthy, exclude the dep if it is in the alternate branch.
        // If the test if falsy, exclude the dep if it is in the consequent branch.
        let child = ancestors[index + 1];
        return res.value ? child === node.alternate : child === node.consequent;
      }
    }
  });
}

function evaluateExpression(node) {
  // Wrap the node in a standalone program so we can traverse it
  node = types.file(types.program([types.expressionStatement(node)]));

  // Find the first expression and evaluate it.
  let res = null;
  traverse(node, {
    Expression(path) {
      res = path.evaluate();
      path.stop();
    }
  });

  return res;
}

function addDependency(asset, node, opts = {}) {
  // Don't bundle node builtins
  if (asset.env.context === 'node' && node.value in nodeBuiltins) {
    return;
  }

  // If this came from an inline <script> tag, throw an error.
  // TODO: run JSPackager on inline script tags.
  // let inlineHTML =
  //   asset.options.rendition && asset.options.rendition.inlineHTML;
  // if (inlineHTML) {
  //   let err = new Error(
  //     'Imports and requires are not supported inside inline <script> tags yet.'
  //   );
  //   err.loc = node.loc && node.loc.start;
  //   throw err;
  // }

  if (asset.env.includeNodeModules === false) {
    const isRelativeImport = /^[/~.]/.test(node.value);
    if (!isRelativeImport) {
      return;
    }
  }

  asset.addDependency(
    Object.assign(
      {
        moduleSpecifier: node.value,
        loc: node.loc && node.loc.start
      },
      opts
    )
  );
}

function addURLDependency(asset, node, opts = {}) {
  node.value = asset.addURLDependency(node.value, {
    loc: node.loc && node.loc.start,
    ...opts
  });
  asset.ast.isDirty = true;
}
