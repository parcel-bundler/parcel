require('@parcel/babel-register');
const {parentPort} = require('worker_threads');
const {default: AdjacencyList} = require('../../src/AdjacencyList');

parentPort.once('message', (serialized) => {
  let graph = AdjacencyList.deserialize(serialized);
  serialized.nodes.forEach((v, i) => {
    serialized.nodes[i] = v * 2;
  });
  serialized.edges.forEach((v, i) => {
    serialized.edges[i] = v * 2;
  });
  parentPort.postMessage(graph.serialize());
});
