import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
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

// const Priority = {
//   sync: 0,
//   parallel: 1,
//   lazy: 2,
// };
const Priority = ['sync', 'parallel', 'lazy'];
//type BundleBehavior = 'inline' | 'isolated';
const BundleBehavior = ['inline', 'isolated'];

function LoadedApp({graph}) {
  const [selectedNode, setSelectedNode] = useState({title: '@@root'});

  const [{currentPinNodeId, pinnedNodeIds}, dispatch] = useReducer(
    (state, action) => {
      //reducer function
      switch (action.type) {
        case 'pin':
          if (!state.pinnedNodeIds.has(action.nodeId)) {
            let updatedPinMap = new Map(state.pinnedNodeIds);
            updatedPinMap.set(action.nodeId, [action.nodeId]);
            return {
              ...state,
              pinnedNodeIds: updatedPinMap,
            };
          }
          return state;
        case 'unpin':
          if (state.pinnedNodeIds.has(action.nodeId)) {
            let updatedPinMap = new Map(state.pinnedNodeIds);
            updatedPinMap.delete(action.nodeId);
            return {
              ...state,
              pinnedNodeIds: updatedPinMap,
            };
          }
          return state;
        case 'selectPin':
          if (state.currentPinNodeId != action.nodeId) {
            return {
              ...state,
              currentPinNodeId: action.nodeId,
            };
          }
          return state;
        default:
          throw new Error();
      }
    },
    null,
    () => {
      let pinnedNodeIds = new Map();
      let currentPinNodeId;
      for (let [id, node] of graph.nodes) {
        // get better way to get this
        if (node.type === 'dependency' && node.value.isEntry) {
          pinnedNodeIds.set(id, [id]);
          currentPinNodeId = id;
          break;
        }
      }
      return {currentPinNodeId, pinnedNodeIds};
    },
  );

  const edgeTypes = useMemo(() => {
    const types = new Set();
    if (graph == null) {
      return [...types];
    }

    for (let [sourceId, edgeMap] of graph.edges) {
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
        ? convertGraph({graph, pinnedNodeIds, focusedEdgeTypes})
        : null,
    [graph, pinnedNodeIds, focusedEdgeTypes],
  );
  const config = useMemo(() => {
    const allNodeTypes = new Set(convertedGraph.nodes.map(node => node.type));
    const allEdgeTypes = new Set(convertedGraph.edges.map(edge => edge.type));
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
  }, [convertedGraph, GraphConfig]);

  const selectedGraphView = useMemo(
    () => ({
      nodes: new Map(selectedNode ? [[selectedNode.id, selectedNode]] : []),
    }),
    [selectedNode],
  );

  const handlePinChange = (node, shouldPin) => {
    dispatch({type: shouldPin ? 'pin' : 'unpin', nodeId: node.id});
  };

  const handleExpandNode = (node, shouldPin) => {
    // This should push node.id to the path youre on currently on
  };
  return (
    <div style={{height: '100%', width: '100%'}}>
      <div className="tools tools--left">
        <SearchView
          onSubmit={id => {
            let node;
            for (let [k, v] of graph.nodes) {
              if (v.value?.publicId === id || v.value?.id === id) {
                node = [k, v];
              }
            }

            if (node != null) {
              setSelectedNode(convertNode(node[0], node[1]));
            } else {
              setSelectedNode(undefined);
            }
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
          pinnedNodeIds={pinnedNodeIds}
          onNodeIdClick={nodeId => {
            setSelectedNode(
              convertedGraph.nodes.find(
                nodeObj => nodeObj.id === Number(nodeId),
              ),
            );
          }}
        />
      </div>
      {selectedNode != null ? (
        <div className="tools tools-right">
          <DetailView
            selectedNode={selectedNode} //selected Path
            onPinChange={handlePinChange}
            expandNode={handleExpandNode}
            isPinned={pinnedNodeIds.has(selectedNode.id)}
          />
        </div>
      ) : null}
      <GraphView
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
          if (select.nodes !== null) {
            setSelectedNode([...select.nodes.values()][0]);
          }
        }}
        selected={selectedGraphView}
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
        placeholder="Search by publicId"
        type="search"
      />
    </form>
  );
}

function FocusView({
  edgeTypes,
  focusedEdgeTypes,
  pinnedNodeIds,
  onPinnedNodes,
  onEdgeFocusChange,
  onNodeIdClick,
}) {
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

function DetailView({selectedNode, onPinChange, isPinned, expandNode}) {
  return (
    <div className="detail-view">
      <div style={{display: 'flex'}}>
        <h2 style={{flex: '1', marginBottom: 0}}>Node Detail</h2>
        <button onClick={() => onPinChange(selectedNode, !isPinned)}>
          {isPinned ? 'Unpin' : 'Pin'}
        </button>
        <button onClick={() => expandNode(selectedNode, !isPinned)}>
          {isPinned ? 'Collapse' : 'Expand'}
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
  bundle: node =>
    node.value.bundleBehavior === null
      ? ['']
      : [BundleBehavior[node.value.bundleBehavior] || 'unknown'],
  dependency: node => [Priority[node.value.priority] || 'unknown'],
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

function convertGraph({focusedEdgeTypes, pinnedNodeIds, graph}) {
  const shownNodeIds = new Set(pinnedNodeIds.keys());

  const edges = [];

  for (let [sourceId, edgeMap] of graph.edges) {
    for (let [type, targetIds] of edgeMap) {
      for (let targetId of targetIds) {
        if (!focusedEdgeTypes.has(type)) {
          continue;
        }

        if (!(pinnedNodeIds.has(sourceId) || pinnedNodeIds.has(targetId))) {
          continue;
        }

        shownNodeIds.add(sourceId);
        shownNodeIds.add(targetId);
        edges.push({
          source: sourceId,
          target: targetId,
          type: type ?? undefined,
          handleTooltipText: type ?? undefined,
        });
      }
    }
  }

  return {
    nodes: [...shownNodeIds].map(id => convertNode(id, graph.nodes.get(id))),
    edges,
  };
}

function convertNode(id, node) {
  let {id: title, type, value} = node;
  return {
    id,
    title,
    type,
    value,
  };
}
