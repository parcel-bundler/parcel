// @flow

import {Resolver} from '@parcel/plugin';
import NodeResolver from '@parcel/node-resolver-core';

// Throw user friendly errors on special webpack loader syntax
// ex. `imports-loader?$=jquery!./example.js`
const WEBPACK_IMPORT_REGEX = /\S+-loader\S*!\S+/g;

export default (new Resolver({
  resolve({dependency, options, filePath}) {
    if (WEBPACK_IMPORT_REGEX.test(dependency.moduleSpecifier)) {
      throw new Error(
        `The import path: ${dependency.moduleSpecifier} is using webpack specific loader import syntax, which isn't supported by Parcel.`,
      );
    }

    let mainFields = ['source', 'browser'];

    // If scope hoisting is enabled, we can get smaller builds using esmodule input, so choose `module` over `main`.
    // Otherwise, we'd be wasting time transforming esmodules to commonjs, so choose `main` over `module`.
    if (dependency.env.shouldScopeHoist) {
      mainFields.push('module', 'main');
    } else {
      mainFields.push('main', 'module');
    }

    const resolver = new NodeResolver({
      fs: options.inputFS,
      projectRoot: options.projectRoot,
      extensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'styl', 'vue'],
      mainFields,
    });

    return resolver.resolve({
      filename: filePath,
      isURL: dependency.isURL,
      parent: dependency.resolveFrom,
      env: dependency.env,
    });
  },
}): Resolver);
