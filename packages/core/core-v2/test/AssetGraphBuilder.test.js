const AssetGraphBuilder = require('../src/AssetGraphBuilder');

const config = require('@parcel/config-default');
const builder = new AssetGraphBuilder(config, {});

describe('AssetGraphBuilder', function () {
  it('works', async function () {
    let graph = await builder.build(__dirname, ['./fixtures/bundle.js']);
    graph.dumpGraphViz();
  });
});
