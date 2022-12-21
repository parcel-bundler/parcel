// @flow strict-local

import type {File as BabelNodeFile} from '@babel/types';
import type SourceMap from '@parcel/source-map';
import type {Node} from '@babel/types';
import typeof * as BabelTypes from '@babel/types';

export function remapAstLocations(
  t: BabelTypes,
  ast: BabelNodeFile,
  map: SourceMap,
) {
  // remap ast to original mappings
  // This improves sourcemap accuracy and fixes sourcemaps when scope-hoisting
  traverseAll(t, ast.program, node => {
    if (node.loc) {
      if (node.loc?.start) {
        let mapping = map.findClosestMapping(
          node.loc.start.line,
          node.loc.start.column,
        );

        if (mapping?.original) {
          // $FlowFixMe
          node.loc.start.line = mapping.original.line;
          // $FlowFixMe
          node.loc.start.column = mapping.original.column;

          // $FlowFixMe
          let length = node.loc.end.column - node.loc.start.column;

          // $FlowFixMe
          node.loc.end.line = mapping.original.line;
          // $FlowFixMe
          node.loc.end.column = mapping.original.column + length;

          // $FlowFixMe
          node.loc.filename = mapping.source;
        } else {
          // Maintain null mappings?
          node.loc = null;
        }
      }
    }
  });
}

function traverseAll(
  t: BabelTypes,
  node: Node,
  visitor: (node: Node) => void,
): void {
  if (!node) {
    return;
  }

  visitor(node);

  for (let key of t.VISITOR_KEYS[node.type] || []) {
    // $FlowFixMe
    let subNode: Node | Array<Node> = node[key];
    if (Array.isArray(subNode)) {
      for (let i = 0; i < subNode.length; i++) {
        traverseAll(t, subNode[i], visitor);
      }
    } else {
      traverseAll(t, subNode, visitor);
    }
  }
}
