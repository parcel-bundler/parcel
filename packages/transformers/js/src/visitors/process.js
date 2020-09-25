//@flow
import type {AST, Glob, EnvMap, MutableAsset} from '@parcel/types';
import type {Node, MemberExpression} from '@babel/types';

import * as types from '@babel/types';
import {isAssignmentExpression, isStringLiteral} from '@babel/types';
import {isMatch} from 'micromatch';
import {morph} from './utils';

type State = {|
  asset: MutableAsset,
  ast: AST,
  env: EnvMap,
  isBrowser: boolean,
  isNode: boolean,
  replaceEnv: boolean | Array<Glob>,
|};

export default {
  MemberExpression(
    node: MemberExpression,
    {asset, ast, env, isBrowser, isNode, replaceEnv}: State,
    ancestors: Array<Node>,
  ) {
    // Inline environment variables accessed on process.env
    if (!isNode && types.matchesPattern(node.object, 'process.env')) {
      // $FlowFixMe
      let key = types.toComputedKey(node);
      if (isStringLiteral(key)) {
        let {value} = key;

        let shouldInline =
          // If true or matched by glob,
          replaceEnv === true ||
          (Array.isArray(replaceEnv) && isMatch(value, replaceEnv)) ||
          // but always inline NODE_ENV or PARCEL_BUILD_ENV in our tests
          value === 'NODE_ENV' ||
          (process.env.PARCEL_BUILD_ENV === 'test' &&
            value === 'PARCEL_BUILD_ENV');

        let prop = shouldInline ? env[value] : undefined;
        if (typeof prop !== 'function') {
          let value = types.valueToNode(prop);
          morph(node, value);

          // Mark AST dirty
          asset.setAST(ast);
          asset.invalidateOnEnvChange(key.value);
        }
      }
      // Inline process.browser
    } else if (isBrowser && types.matchesPattern(node, 'process.browser')) {
      // the last ancestor is the node itself, the one before may be it's parent
      const parent = ancestors[ancestors.length - 2];

      if (parent && isAssignmentExpression(parent) && parent.left === node) {
        parent.right = types.booleanLiteral(true);
      } else {
        morph(node, types.booleanLiteral(true));
      }

      // Mark AST dirty
      asset.setAST(ast);
    }
  },
};
