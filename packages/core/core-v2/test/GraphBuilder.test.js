const GraphBuilder = require('../src/GraphBuilder');

const config = require('@parcel/config-default');
const builder = new GraphBuilder(config, {});

describe('GraphBuilder', function () {
  it('works', async function () {
    let graph = await builder.build(__dirname, ['./fixtures/bundle.js']);
    graph.dumpGraphViz();
  });
});
