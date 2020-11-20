import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {decode} from './utils';
import {GraphView} from 'react-digraph';
import path from 'path';
import JSONTree from 'react-json-tree';

const NODE_TEXT_LINE_HEIGHT = 18;

export default function App() {
  const [graph, setGraph] = useState(null);

  useEffect(() => {
    let abortController = new AbortController();
    (async () => {
      let response;
      try {
        response = await fetch('/api/graph', {signal: abortController.signal});
      } catch (e) {
        if (e.name === 'AbortError') {
          return;
        }
      }

      const buffer = await response.arrayBuffer();
      if (abortController.signal.aborted) {
        return;
      }

      setGraph(await decode(buffer));
    })();

    return () => {
      abortController.abort();
    };
  }, []);

  if (graph == null) {
    return <div>Loading...</div>;
  }

  return <LoadedApp graph={graph} />;
}

function LoadedApp({graph}) {
  const [selectedNode, setSelectedNode] = useState(null);
  const [focusedNodeIds, setFocusedNodeIds] = useState(new Set());
  const [isFocusingNodes, setIsFocusingNodes] = useState(true);

  const edgeTypes = useMemo(() => {
    const types = new Set();
    if (graph == null) {
      return [...types];
    }

    for (let [sourceId, edgeMap] of graph.edges.outboundEdges) {
      for (let [type] of edgeMap) {
        types.add(type);
      }
    }
    return types;
  }, [graph]);

  const [focusedEdgeTypes, setFocusedEdgeTypes] = useState(new Set(edgeTypes));
  const convertedGraph = useMemo(
    () =>
      graph != null
        ? convertGraph({
            graph,
            isFocusingNodes,
            focusedNodeIds,
            focusedEdgeTypes,
          })
        : null,
    [graph, isFocusingNodes, focusedNodeIds, focusedEdgeTypes],
  );

  const selectedGraphViewNode =
    selectedNode != null ? {title: selectedNode.id} : null;

  const handleFocusChange = (node, shouldFocus) => {
    setFocusedNodeIds(
      () =>
        new Set(
          shouldFocus
            ? [...focusedNodeIds, node.id]
            : [...focusedNodeIds].filter(n => n !== node.id),
        ),
    );
  };

  return (
    <div style={{height: '100%', width: '100%'}}>
      <div className="tools tools--left">
        <SearchView
          onSubmit={nodeId => {
            setSelectedNode(graph.nodes.get(nodeId));
          }}
        />
        <FocusView
          edgeTypes={edgeTypes}
          focusedEdgeTypes={focusedEdgeTypes}
          onEdgeFocusChange={(type, shouldFocus) => {
            setFocusedEdgeTypes(
              () =>
                new Set(
                  shouldFocus
                    ? [...focusedEdgeTypes, type]
                    : [...focusedEdgeTypes].filter(t => t !== type),
                ),
            );
          }}
          focusedNodeIds={focusedNodeIds}
          isFocusingNodes={isFocusingNodes}
          onNodeIdClick={id => {
            setSelectedNode(graph.nodes.get(id));
          }}
          onFocusNodes={isFocusing => {
            setIsFocusingNodes(isFocusing);
          }}
        />
      </div>
      {selectedNode != null ? (
        <div className="tools tools-right">
          <DetailView
            selectedNode={selectedNode}
            onFocusChange={handleFocusChange}
            isFocused={focusedNodeIds.has(selectedNode.id)}
          />
        </div>
      ) : null}
      <GraphView
        nodeKey="title"
        layoutEngineType="VerticalTree"
        readOnly={true}
        renderNodeText={(node, id, isSelected) => (
          <NodeText node={node} id={id} isSelected={isSelected} />
        )}
        nodeTypes={{
          root: anyNode,
          entry_specifier: entrySpecifierNode,
          entry_file: entrySpecifierNode,
          dependency: dependencyNode,
          asset: assetNode,
          bundle_group: bundleGroupNode,
          bundle: bundleNode,
        }}
        edgeTypes={{}}
        nodeSubtypes={{}}
        onSelectNode={node => {
          setSelectedNode(node != null ? graph.nodes.get(node.title) : null);
        }}
        selected={selectedGraphViewNode}
        nodes={convertedGraph.nodes}
        edges={convertedGraph.edges}
      />
    </div>
  );
}

function SearchView({onSubmit}) {
  const [searchValue, setSearchValue] = useState(null);

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSubmit(searchValue);
      }}
    >
      <input
        className="search-view"
        name="search"
        onChange={e => setSearchValue(e.target.value)}
        placeholder="Search by node id"
        type="search"
      />
    </form>
  );
}

function FocusView({
  edgeTypes,
  focusedEdgeTypes,
  focusedNodeIds,
  isFocusingNodes,
  onFocusNodes,
  onEdgeFocusChange,
  onNodeIdClick,
}) {
  return (
    <div className="focus-view">
      <div style={{marginBottom: 16}}>
        <label style={{fontWeight: 'bold', position: 'relative'}}>
          <input
            type="checkbox"
            checked={isFocusingNodes}
            onChange={e => {
              onFocusNodes(e.target.checked);
            }}
            style={{
              position: 'absolute',
              left: -20,
              top: -3,
            }}
          />
          <span className="label-text">Focus Nodes</span>
        </label>

        {focusedNodeIds.size > 0 ? (
          <ul className="focused-nodes">
            {[...focusedNodeIds].map(id => (
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
      </div>
      <div className="focused-edges">
        <label style={{fontWeight: 'bold'}}>
          <span className="label-text">Edge types</span>
          <ul>
            {[...edgeTypes].map(type => {
              const isFocused = focusedEdgeTypes.has(type);
              return (
                <li key={type}>
                  <label>
                    <input
                      type="checkbox"
                      checked={isFocused}
                      onChange={() => {
                        onEdgeFocusChange(type, !isFocused);
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

function DetailView({selectedNode, onFocusChange, isFocused}) {
  return (
    <div className="detail-view">
      <div style={{display: 'flex'}}>
        <h2 style={{flex: '1', marginBottom: 0}}>Node Detail</h2>
        <button onClick={() => onFocusChange(selectedNode, !isFocused)}>
          {isFocused ? 'Remove from focus' : 'Add to focus'}
        </button>
      </div>
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
    </div>
  );
}

function NodeText({node, id, isSelected}) {
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
};

function makeNode({type, size, color}) {
  return {
    typeText: type,
    shapeId: '#' + type,
    shape: (
      // Adapted from https://github.com/uber/react-digraph#usage
      <symbol
        viewBox={`0 0 ${size} ${size}`}
        id={type}
        key="0"
        width={size}
        height={size}
      >
        <circle
          fill={color}
          cx={`${size / 2}`}
          cy={`${size / 2}`}
          r={`${0.45 * size}`}
        />
      </symbol>
    ),
  };
}

const anyNode = makeNode({type: 'any', size: 125, color: '#d2d3d2'});
const rootNode = makeNode({type: 'root', size: 125, color: '#d2d3d2'});
const entrySpecifierNode = makeNode({
  type: 'entry_specifier',
  size: 125,
  color: '#d2d3d2',
});
const dependencyNode = makeNode({
  type: 'dependency',
  size: 100,
  color: '#fea500',
});
const assetNode = makeNode({type: 'asset', size: 175, color: '#00ff00'});
const bundleGroupNode = makeNode({
  type: 'bundle_group',
  size: 125,
  color: '#d2d3d2',
});
const bundleNode = makeNode({type: 'bundle', size: 125, color: '#d2d3d2'});

function convertGraph({
  focusedEdgeTypes,
  focusedNodeIds,
  graph,
  isFocusingNodes,
}) {
  const shownNodes = new Set(
    [...focusedNodeIds].map(id => graph.nodes.get(id)),
  );

  const edges = [];
  for (let [sourceId, edgeMap] of graph.edges.outboundEdges) {
    for (let [type, targetIds] of edgeMap) {
      for (let targetId of targetIds) {
        if (!focusedEdgeTypes.has(type)) {
          continue;
        }

        if (
          isFocusingNodes &&
          !(focusedNodeIds.has(sourceId) || focusedNodeIds.has(targetId))
        ) {
          continue;
        }

        shownNodes.add(graph.nodes.get(sourceId));
        shownNodes.add(graph.nodes.get(targetId));

        edges.push({
          source: sourceId,
          target: targetId,
          type: type ?? undefined,
        });
      }
    }
  }

  return {
    nodes: [...shownNodes].map(({id, type, value}) => ({
      title: id,
      type,
      value,
    })),
    edges,
  };
}
