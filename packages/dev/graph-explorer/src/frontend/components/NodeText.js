// @flow

import * as React from 'react';
import path from 'path';

export type NodeId = string;

export type AssetNode = {|
  id: NodeId,
  type: 'asset',
  title: string,
  filePath: ?string,
|};

export type BundleNode = {|
  id: NodeId,
  type: 'bundle',
  title: string,
  bundleBehavior: ?string,
|};

export type DependencyNode = {|
  id: NodeId,
  type: 'dependency',
  title: string,
  priority: ?string,
|};

export type Node = AssetNode | BundleNode | DependencyNode;

export type NodeTextProps = {|
  node: Node,
  id: string,
  isSelected: boolean,
|};

const NODE_TEXT_LINE_HEIGHT = 18;

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
  asset: node => [
    node.filePath != null ? path.basename(node.filePath) : 'unknown',
  ],
  bundle: node => [node.bundleBehavior ?? 'unknown'],
  dependency: node => [node.priority ?? 'unknown'],
};
