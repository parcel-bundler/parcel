// @flow

import * as React from 'react';

type FocusViewProps = {|
  edgeTypes: Set<string>,
  focusedEdgeTypes: Set<string>,
  pinnedNodeIds: Set<string>,
  onPinnedNodes: (pinnedNodeIds: Set<string>) => void,
  onEdgeFocusChange: (edgeType: string, isFocused: boolean) => void,
  onNodeIdClick: (nodeId: string) => void,
|};

export default function FocusView({
  edgeTypes,
  focusedEdgeTypes,
  pinnedNodeIds,
  // onPinnedNodes,
  onEdgeFocusChange,
  onNodeIdClick,
}: FocusViewProps): React.Node {
  return (
    <div className="focus-view">
      <div style={{marginBottom: 16}}>
        <label style={{fontWeight: 'bold', position: 'relative'}}>
          <span className="label-text">Pinned Nodes</span>
          {pinnedNodeIds.size > 0 ? (
            <ul className="pinned-nodes">
              {[...pinnedNodeIds].map(id => (
                <li key={id}>
                  <a
                    href="#"
                    onClick={() => {
                      onNodeIdClick(id);
                    }}
                  >
                    {id}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </label>
      </div>
      <div className="focused-edges">
        <label style={{fontWeight: 'bold'}}>
          <span className="label-text">Edge types</span>
          <ul>
            {[...edgeTypes].map(type => {
              const isPinned = focusedEdgeTypes.has(type);
              return (
                <li key={type}>
                  <label>
                    <input
                      type="checkbox"
                      checked={isPinned}
                      onChange={() => {
                        onEdgeFocusChange(type, !isPinned);
                      }}
                    />
                    <span className="label-text" title={type}>
                      {type === null ? 'null (untyped)' : type}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </label>
      </div>
    </div>
  );
}
