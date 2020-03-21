import * as t from '@babel/types';
import explode from './explode.js';

export function simple(node, visitors, state) {
  if (!node) return;

  visitors = explode(visitors);

  (function c(node) {
    if (!node) return;

    const {enter, exit} = visitors[node.type] || {};

    if (enter) {
      for (let visitor of enter) {
        visitor(node, state);
      }
    }

    for (let key of t.VISITOR_KEYS[node.type] || []) {
      let subNode = node[key];
      if (Array.isArray(subNode)) {
        for (let subSubNode of subNode) {
          c(subSubNode);
        }
      } else {
        c(subNode);
      }
    }

    if (exit) {
      for (let visitor of exit) {
        visitor(node, state);
      }
    }
  })(node);
}

export function ancestor(node, visitors, state) {
  if (!node) return;

  visitors = explode(visitors);
  let ancestors = [];

  (function c(node) {
    if (!node) return;

    const {enter, exit} = visitors[node.type] || {};

    let isNew = node != ancestors[ancestors.length - 1];
    if (isNew) ancestors.push(node);

    if (enter) {
      for (let visitor of enter) {
        visitor(node, state || ancestors, ancestors);
      }
    }

    for (let key of t.VISITOR_KEYS[node.type] || []) {
      let subNode = node[key];
      if (Array.isArray(subNode)) {
        for (let subSubNode of subNode) {
          c(subSubNode);
        }
      } else {
        c(subNode);
      }
    }

    if (exit) {
      for (let visitor of exit) {
        visitor(node, state || ancestors, ancestors);
      }
    }

    if (isNew) ancestors.pop();
  })(node);
}

export function recursive(node, visitors, state) {
  if (!node) return;

  visitors = explode(visitors);

  (function c(node) {
    if (!node) return;

    const {enter} = visitors[node.type] || {};

    if (enter && enter.length) {
      for (let visitor of enter) {
        visitor(node, state, c);
      }
    } else {
      for (let key of t.VISITOR_KEYS[node.type] || []) {
        let subNode = node[key];
        if (Array.isArray(subNode)) {
          for (let subSubNode of subNode) {
            c(subSubNode);
          }
        } else {
          c(subNode);
        }
      }
    }
  })(node);
}
