// @flow

import * as React from 'react';
import path from 'path';

type Node = {|
  id: string,
  type: string,
  title: string,
|};

type NodeTextProps = {|
  node: Node,
  id: string,
  isSelected: boolean,
|};

const NODE_TEXT_LINE_HEIGHT = 18;

const Priority = ['sync', 'parallel', 'lazy'];
const BundleBehavior = ['inline', 'isolated'];

export default function NodeText({
  node,
}: // id,
// isSelected,
NodeTextProps): React.Node {
  return (
    <g>
      <text fontFamily="monospace" textAnchor="middle" className="node-text">
        {node.type}
      </text>
      <text
        fontFamily="monospace"
        fontWeight="bold"
        textAnchor="middle"
        className="node-text"
        dy={NODE_TEXT_LINE_HEIGHT}
      >
        {node.title.slice(0, 8)}
      </text>
      {(extraFields[node.type] ? extraFields[node.type](node) : []).map(
        (field, i) => (
          <text
            textAnchor="middle"
            fontFamily="monospace"
            className="node-text"
            key={field}
            dy={NODE_TEXT_LINE_HEIGHT * (i + 2)}
          >
            {field}
          </text>
        ),
      )}
    </g>
  );
}

const extraFields = {
  asset: node => [path.basename(node.value.filePath)],
  bundle: node =>
    node.value.bundleBehavior === null
      ? ['']
      : [BundleBehavior[node.value.bundleBehavior] || 'unknown'],
  dependency: node => [Priority[node.value.priority] || 'unknown'],
};
