const AssetGraphBuilder = require('../src/AssetGraphBuilder');

const config = require('@parcel/config-default');
const builder = new AssetGraphBuilder(config, {});

describe.only('AssetGraphBuilder', function () {
  it('works', async function () {
    let graph = await builder.build(__dirname, ['./fixtures/bundle.js']);
    console.log();
    console.log();
    console.log();
    console.log(graph.toGraphViz());
    console.log();
    console.log();
    console.log();
  });
});
