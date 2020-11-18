import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {decode} from './utils';
import {GraphView} from 'react-digraph';
import path from 'path';
import JSONTree from 'react-json-tree';

const NODE_TEXT_LINE_HEIGHT = 18;

export default function App() {
  const [graph, setGraph] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
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

      const parcelGraph = await decode(buffer);
      setGraph(parcelGraph);
    })();

    return () => {
      abortController.abort();
    };
  }, []);

  const convertedGraph = useMemo(
    () => (graph != null ? convertGraph(graph) : null),
    [graph],
  );
  const selectedGraphViewNode = useMemo(
    () => (selectedNode != null ? {title: selectedNode.id} : null),
    [selectedNode],
  );

  const onRenderNodeText = useCallback(
    (node, id, isSelected) => (
      <NodeText node={node} id={id} isSelected={isSelected} />
    ),
    [],
  );

  if (convertedGraph == null) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{height: '100%', width: '100%'}}>
      <div className="tools">
        <SearchView
          onSubmit={nodeId => {
            setSelectedNode(graph.nodes.get(nodeId));
          }}
        />
        {selectedNode != null ? (
          <DetailView selectedNode={selectedNode} />
        ) : null}
      </div>
      <GraphView
        nodeKey="title"
        layoutEngineType="VerticalTree"
        readOnly={true}
        renderNodeText={onRenderNodeText}
        nodeTypes={{
          root: anyNode,
          entry_specifier: entrySpecifierNode,
          dependency: dependencyNode,
          asset: assetNode,
          bundle_group: bundleGroupNode,
          bundle: bundleNode,
        }}
        edgeTypes={{
          empty: anyEdge,
          bundle: anyEdge,
          references: anyEdge,
          contains: anyEdge,
        }}
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

function DetailView({selectedNode}) {
  return (
    <div className="detail-view">
      <h2>Node Detail</h2>
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

const anyEdge = {
  shapeId: '#anyEdge',
  shape: (
    // Adapted from https://github.com/uber/react-digraph#usage
    <symbol viewBox="0 0 50 50" id="anyEdge" key="0">
      <circle cx="25" cy="25" r="8" fill="currentColor" />
    </symbol>
  ),
};

function convertGraph(graph) {
  let edges = [];
  for (let [source, edgeMap] of graph.edges.outboundEdges) {
    for (let [type, targets] of edgeMap) {
      for (let target of targets) {
        edges.push({
          source,
          target,
          type: type ?? undefined,
        });
      }
    }
  }

  return {
    nodes: [...graph.nodes.values()].map(({id, type, value}) => ({
      title: id,
      type,
      value,
    })),
    edges,
  };
}
