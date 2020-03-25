import * as types from '@babel/types';
import {morph} from './utils';

export default {
  MemberExpression(node, {asset, ast, env, isBrowser, isNode}, ancestors) {
    // Inline environment variables accessed on process.env
    if (!isNode && types.matchesPattern(node.object, 'process.env')) {
      let key = types.toComputedKey(node);
      if (types.isStringLiteral(key)) {
        // Try using the value from the passed env (either from new Parcel
        // options or from dotenv), and fall back to process.env
        let prop = env[key.value] ?? process.env[key.value];
        if (typeof prop !== 'function') {
          let value = types.valueToNode(prop);
          morph(node, value);
          asset.setAST(ast);
          // asset.meta.env[key.value] = process.env[key.value];
        }
      }
      // Inline process.browser
    } else if (isBrowser && types.matchesPattern(node, 'process.browser')) {
      // the last ancestor is the node itself, the one before may be it's parent
      const parent = ancestors[ancestors.length - 2];
      const isAssignmentExpression = Boolean(
        parent && types.isAssignmentExpression(parent) && parent.left === node,
      );

      if (isAssignmentExpression) {
        parent.right = types.booleanLiteral(true);
      } else {
        morph(node, types.booleanLiteral(true));
      }
    }
  },
};
