import React, {useEffect, useState} from 'react';
import {decode} from './utils';
import {GraphView} from 'react-digraph';

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
  });

  if (graph == null) {
    return <div>Loading...</div>;
  }

  console.log(graph);

  return (
    <GraphView
      nodeKey="id"
      nodeTypes={{
        root: anyNode,
        entry_specifier: anyNode,
        dependency: anyNode,
        asset: anyNode,
        bundle_group: anyNode,
        bundle: anyNode,
      }}
      edgeTypes={{
        empty: anyNode,
        bundle: anyNode,
        references: anyNode,
        contains: anyNode,
      }}
      nodeSubtypes={{}}
      // onSelectNode={() => {}}
      selected={{}}
      nodes={graph.nodes}
      edges={graph.edges}
    />
  );
}

const anyNode = {
  typeText: 'any',
  shapeId: '#any',
  shape: (
    // Adapted from https://github.com/uber/react-digraph#usage
    <symbol viewBox="0 0 100 100" id="any" key="0">
      <circle cx="50" cy="50" r="45" />
    </symbol>
  ),
};

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
  for (let [source, edgeMap] of graph.edges.inboundEdges) {
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
    nodes: [...graph.nodes.values()].map(({id, type}) => ({title: id, type})),
    edges,
  };
}
