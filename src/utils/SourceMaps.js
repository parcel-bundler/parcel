const sourceMap = require('source-map');

function isConsumer(map) {
  return map && map.computeColumnSpans;
}

function getConsumer(map) {
  if (isConsumer(map)) {
    return map;
  }
  map = isGenerator(map) ? map.toString() : map;
  return new sourceMap.SourceMapConsumer(map);
}

function isGenerator(map) {
  return map && map.addMapping;
}

function getGenerator(map) {
  if (isGenerator(map)) {
    return map;
  }
  let consumer = isConsumer(map) ? map : getConsumer(map);
  return sourceMap.SourceMapGenerator.fromSourceMap(consumer);
}

function offsetSourceMap(map, lineOffset, columnOffset = 0) {
  let consumer = getConsumer(map);
  let generator = new sourceMap.SourceMapGenerator();
  generator = combineSourceMaps(consumer, generator, lineOffset, columnOffset);

  return generator;
}

function combineSourceMaps(source, target, lineOffset = 0, columnOffset = 0) {
  let consumer = getConsumer(source);
  let generator = getGenerator(target);
  let addedSources = {};

  consumer.eachMapping(mapping => {
    if (!mapping.source || !mapping.originalLine || !mapping.originalColumn) {
      return false;
    }

    generator.addMapping({
      source: mapping.source,
      original: {
        line: mapping.originalLine,
        column: mapping.originalColumn
      },
      generated: {
        line: mapping.generatedLine + lineOffset,
        column: mapping.generatedColumn + columnOffset
      },
      name: mapping.name
    });

    if (!addedSources[mapping.source]) {
      let content = consumer.sourceContentFor(mapping.source, true);
      if (content) {
        generator.setSourceContent(mapping.source, content);
        addedSources[mapping.source] = true;
      }
    }
  });

  return generator;
}

exports.emptyMap = {version: 3, sources: [], names: [], mappings: ''};
exports.getConsumer = getConsumer;
exports.isGenerator = isGenerator;
exports.getGenerator = getGenerator;
exports.offsetSourceMap = offsetSourceMap;
exports.combineSourceMaps = combineSourceMaps;
