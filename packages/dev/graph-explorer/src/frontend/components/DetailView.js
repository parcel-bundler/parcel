// @flow

import * as React from 'react';
import JSONTree from 'react-json-tree';

type Node = {|
  id: string,
  type: string,
  value: any,
|};

type DetailViewProps = {|
  selectedNode: ?Node,
  onPinChange: (node: ?Node, isPinned: boolean) => void,
  isPinned: boolean,
  isExpanded: boolean,
  onExpandChange: (node: ?Node, isExpanded: boolean) => void,
|};

export default function DetailView({
  selectedNode,
  onPinChange,
  isPinned,
  isExpanded,
  onExpandChange,
}: DetailViewProps): React.Node {
  return (
    <div className="detail-view">
      <div style={{display: 'flex'}}>
        <h2 style={{flex: '1', marginBottom: 0}}>Node Detail</h2>
        <button onClick={() => onPinChange(selectedNode, !isPinned)}>
          {isPinned ? 'Unpin' : 'Pin'}
        </button>
        <button onClick={() => onExpandChange(selectedNode, !isExpanded)}>
          {isExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {selectedNode && (
        <>
          <dl>
            <div>
              <dt>id</dt>
              <dd>{selectedNode.id}</dd>
            </div>
            <div>
              <dt>type</dt>
              <dd>{selectedNode.type}</dd>
            </div>
          </dl>
          <div className="json-tree">
            <JSONTree
              theme="google"
              data={selectedNode.value}
              labelRenderer={([key]) => (key === 'root' ? 'value' : key)}
            />
          </div>
        </>
      )}
    </div>
  );
}
