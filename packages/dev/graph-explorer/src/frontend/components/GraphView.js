// @flow

import * as React from 'react';
import {GraphView as DigraphGraphView} from 'react-digraph';
import NodeText from './NodeText';

import type {Node, NodeId} from './NodeText';

type GraphViewProps = {|
  selectedNodeId: string,
  selectedNode: any,
  graph: Graph,
  dispatch: any,
|};

type Graph = {|
  nodes: Array<Node>,
  edges: Array<Edge>,
|};

type Edge = {|
  source: NodeId,
  target: NodeId,
  type: string,
|};

const COLORS = {
  root: 'gray',
  asset: 'green',
  dependency: 'orange',
  transformer_request: 'cyan',
  file: 'gray',
  default: 'gray',
};

const TYPE_COLORS = {
  null: 'black',
  bundle: 'blue',
  contains: 'grey',
  internal_async: 'orange',
  references: 'red',
  sibling: 'green',
  invalidated_by_create: 'green',
  invalidated_by_create_above: 'orange',
  invalidate_by_update: 'cyan',
  invalidated_by_delete: 'red',
};

const ROOT_NODE_OFFSET = 200;

export default function GraphView({
  selectedNodeId,
  selectedNode,
  graph,
  dispatch,
}: GraphViewProps): React.Node {
  const config = useGraphConfig(graph);
  const edges = useEdges(graph);
  const nodes = useNodes(graph);
  return (
    <DigraphGraphView
      nodeKey="id"
      layoutEngineType="VerticalTree"
      allowMultiselect={false}
      readOnly={true}
      renderNodeText={(node, id, isSelected) => (
        <NodeText node={node} id={id} isSelected={isSelected} />
      )}
      nodeTypes={config.NodeTypes}
      edgeTypes={config.EdgeTypes}
      nodeSubtypes={config.NodeSubtypes}
      onSelect={select => {
        if (select.nodes?.size) {
          dispatch({
            type: 'select',
            nodeId: select.nodes.keys().next().value,
          });
        }
      }}
      selected={[selectedNodeId, selectedNode]}
      nodes={nodes}
      edges={edges}
    />
  );
}

function useGraphConfig(graph) {
  return React.useMemo(() => {
    const allNodeTypes = new Set(graph.nodes.map(node => node.type));
    const allEdgeTypes = new Set(graph.edges.map(edge => edge.type));
    const extendedGraphConfig = {
      NodeTypes: {...GraphConfig.NodeTypes},
      NodeSubtypes: {...GraphConfig.NodeSubtypes},
      EdgeTypes: {...GraphConfig.EdgeTypes},
    };
    allNodeTypes.forEach(nodeType => {
      if (!(nodeType in GraphConfig.NodeTypes)) {
        extendedGraphConfig.NodeTypes[nodeType] = makeNode({
          type: nodeType,
          size: 125,
          color: COLORS.default,
        });
      }
    });
    allEdgeTypes.forEach(edgeType => {
      if (!(edgeType in GraphConfig.EdgeTypes)) {
        extendedGraphConfig.NodeTypes[edgeType] = makeEdge({
          type: edgeType,
          size: 125,
          color: TYPE_COLORS.null,
        });
      }
    });
    return extendedGraphConfig;
  }, [graph, GraphConfig]);
}

const GraphConfig = {
  NodeTypes: {
    any: makeNode({type: 'any', size: 125, color: COLORS.default}),
    root: makeNode({type: 'root', size: 125, color: COLORS.root}),
    entry_specifier: makeNode({
      type: 'entry_specifier',
      size: 125,
      color: COLORS.default,
    }),
    entry_file: makeNode({
      type: 'entry_file',
      size: 125,
      color: COLORS.file,
    }),
    dependency: makeNode({
      type: 'dependency',
      size: 100,
      color: COLORS.dependency,
    }),
    asset: makeNode({type: 'asset', size: 175, color: COLORS.asset}),
    bundle_group: makeNode({
      type: 'bundle_group',
      size: 125,
      color: COLORS.default,
    }),
    bundle: makeNode({type: 'bundle', size: 125, color: COLORS.default}),
  },
  NodeSubtypes: {},
  EdgeTypes: {
    null: makeEdge({type: 'null', size: 125, color: TYPE_COLORS.null}),
    references: makeEdge({
      type: 'references',
      size: 125,
      color: TYPE_COLORS.references,
    }),
    contains: makeEdge({
      type: 'contains',
      size: 125,
      color: TYPE_COLORS.contains,
    }),
    bundle: makeEdge({
      type: 'bundle',
      size: 125,
      color: TYPE_COLORS.bundle,
    }),
    internal_async: makeEdge({
      type: 'internal_async',
      size: 125,
      color: TYPE_COLORS.internal_async,
    }),
  },
};

function makeNode({type, size, color}) {
  return {
    typeText: type,
    shapeId: '#node_' + type,
    shape: (
      // Adapted from https://github.com/uber/react-digraph#usage
      <symbol
        viewBox={`0 0 ${size} ${size}`}
        id={'node_' + type}
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

function makeEdge({type, size}) {
  return {
    typeText: type,
    shapeId: '#edge_' + type,
    shape: (
      // Adapted from https://github.com/uber/react-digraph#usage
      <symbol
        viewBox={`0 0 ${size} ${size}`}
        id={'edge_' + type}
        key="0"
        width={size}
        height={size}
      ></symbol>
    ),
  };
}

function useEdges(graph) {
  return React.useMemo(() => {
    return graph.edges.map(edge => ({
      ...edge,
      type: edge.type ?? 'null',
    }));
  }, [graph]);
}

function useNodes(graph) {
  return React.useMemo(() => {
    let roots = 0;
    let nodes = [];
    for (let node of graph.nodes) {
      if (isRootNode(node.id, graph.edges)) {
        nodes.push({...node, x: roots * ROOT_NODE_OFFSET, y: 0});
        roots++;
      } else {
        nodes.push({...node});
      }
    }
    return nodes;
  }, [graph]);
}

function isRootNode(nodeId, edges) {
  for (let edge of edges) {
    if (edge.target === nodeId) {
      return false;
    }
  }
  return true;
}
