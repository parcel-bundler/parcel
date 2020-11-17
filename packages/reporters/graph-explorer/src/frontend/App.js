import React, {useEffect, useState} from 'react';
import {decode} from './utils';
import {GraphView} from 'react-digraph';
import path from 'path';

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

      const parcelGraph = await decode(buffer);
      setGraph(convertGraph(parcelGraph));
    })();

    return () => {
      abortController.abort();
    };
  }, []);

  if (graph == null) {
    return <div>Loading...</div>;
  }

  console.log(graph);

  return (
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
      // onSelectNode={() => {}}
      selected={{}}
      nodes={graph.nodes}
      edges={graph.edges}
    />
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
        dy={18}
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
            dy={18 * (i + 2)}
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
