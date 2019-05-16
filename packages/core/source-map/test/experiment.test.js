import sourceMap from 'source-map';

describe.skip('experiment', () => {
  it('tests', async function() {
    let map = new sourceMap.SourceMapGenerator({
      file: 'min.js',
      sourceRoot: '/the/root'
    });

    map.addMapping({
      generated: {line: 1, column: 0}
    });

    map.addMapping({
      source: 'hello.js',
      generated: {line: 2, column: 0},
      original: {line: 1, column: 0}
    });

    let mapJSON = JSON.parse(map.toString());

    // console.log(mapJSON);

    let consumer = await new sourceMap.SourceMapConsumer(mapJSON);

    consumer.eachMapping(mapping => console.log(mapping));

    // console.log(consumer.originalPositionFor({line: 1, column: 0}))
    // console.log(consumer.originalPositionFor({line: 2, column: 0}));
  });
});
