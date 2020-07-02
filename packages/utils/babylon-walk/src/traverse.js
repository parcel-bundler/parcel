// @flow
import type {Node} from '@babel/types';
import type {VisitorFunc, Visitors, VisitorsExploded} from './types';

import * as t from '@babel/types';
import explode from './explode.js';

export const SKIP = Symbol('traverse.SKIP');
export const REMOVE = Symbol('traverse.REMOVE');

export function traverse<T>(node: Node, visitors: Visitors<T>, state: T) {
  let ancestors = [];
  let revisit = [];
  traverseWalk(explode((visitors: any)), ancestors, revisit, state, node);

  for (let fn of revisit) {
    fn();
  }
}

function traverseWalk<T>(
  visitors: VisitorsExploded<VisitorFunc<Node, T>>,
  ancestors: Node[],
  revisit: any[],
  state: T,
  node: Node,
) {
  if (!node || (visitors.shouldSkip && visitors.shouldSkip(node) === true)) {
    return;
  }

  let isNew = node != ancestors[ancestors.length - 1];
  if (isNew) ancestors.push(node);

  const {enter, exit} = visitors[node.type] || {};

  if (enter) {
    for (let visitor of enter) {
      let res = visitor(node, state, ancestors);
      if (res != null) {
        if (isNew) ancestors.pop();
        return res;
      }
    }
  }

  for (let key of t.VISITOR_KEYS[node.type] || []) {
    // $FlowFixMe
    let subNode: Node | Array<Node> = node[key];
    if (Array.isArray(subNode)) {
      for (let i = 0; i < subNode.length; i++) {
        let res = traverseWalk(visitors, ancestors, revisit, state, subNode[i]);
        if (res === REMOVE) {
          subNode.splice(i, 1);
          i--;
        } else if (res !== SKIP && res != null) {
          if (typeof res === 'function') {
            revisit.push(() => {
              replaceArray(subNode, i, res());
            });
          } else {
            i = replaceArray(subNode, i, res);
          }
        }
      }
    } else {
      let res = traverseWalk(visitors, ancestors, revisit, state, subNode);
      if (res === REMOVE) {
        // return REMOVE;
        // $FlowFixMe
        node[key] = null;
      } else if (res !== SKIP && res != null) {
        if (typeof res === 'function') {
          revisit.push(() => {
            let n = res();
            if (n != null) {
              // $FlowFixMe
              node[key] = n;
            }
          });
        } else {
          // $FlowFixMe
          node[key] = res;
        }
      }
    }
  }

  if (exit) {
    for (let visitor of exit) {
      let res = visitor(node, state, ancestors);
      if (res != null) {
        if (isNew) ancestors.pop();
        return res;
      }
    }
  }

  if (isNew) ancestors.pop();
}

function replaceArray(subNode, i, res) {
  if (Array.isArray(res)) {
    subNode.splice(i, 1, ...res);
    if (res.length === 0) {
      i--;
    } else if (res.length > 1) {
      i += res.length - 1;
    }
  } else if (res != null) {
    // $FlowFixMe
    subNode[i] = res;
  }

  return i;
}
