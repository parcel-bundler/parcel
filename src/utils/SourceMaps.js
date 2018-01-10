const sourceMap = require('source-map');
const lineCounter = require('./lineCounter');
const emptyMap = {
  version: 3,
  sources: [],
  names: [],
  mappings: '',
  sourcesContent: []
};

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

function getEmptyMap(sourceName, sourceContent) {
  let map = JSON.parse(JSON.stringify(emptyMap));
  map.sources.push(sourceName);
  map.sourcesContent.push(sourceContent);

  return map;
}

function offsetEmptyMap(map, lineOffset = 0, columnOffset = 0) {
  let generator = getGenerator(map);

  for (let i = 0; i < map.sources.length; i++) {
    let source = map.sources[i];
    let sourceContent = map.sourcesContent[i];

    generator.setSourceContent(source, sourceContent);
    for (let line = 1; line < lineCounter(sourceContent) + 1; line++) {
      // We might wanna count spaces here, instead of setting 0
      let column = 0;
      generator.addMapping({
        source: source,
        original: {
          line: line,
          column: column
        },
        generated: {
          line: line + lineOffset,
          column: column + columnOffset
        }
      });
    }
  }
  return generator;
}

function combineSourceMaps(source, target, lineOffset = 0, columnOffset = 0) {
  if (
    !source.mappings &&
    source.sourcesContent &&
    source.sourcesContent.length !== 0 &&
    (lineOffset || columnOffset)
  ) {
    source = offsetEmptyMap(source, lineOffset, columnOffset);
    lineOffset = 0;
    columnOffset = 0;
  }
  let consumer = getConsumer(source);
  let generator = getGenerator(target);
  let addedSources = {};

  consumer.eachMapping(mapping => {
    if (
      !mapping.source ||
      !mapping.originalLine ||
      (!mapping.originalColumn && mapping.originalColumn !== 0)
    ) {
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

function extendSourceMap(original, extension) {
  original = getConsumer(original);
  extension = getConsumer(extension);
  let generator = getGenerator(original);
  let mappings = {};
  let source = {
    name: '',
    content: ''
  };

  original.eachMapping(mapping => {
    mappings[mapping.generatedLine][mapping.generatedColumn] = {
      line: mapping.originalLine,
      column: mapping.originalColumn,
      name: mapping.name
    };

    // Set source content
    if (!source.name || !source.content) {
      source.name = mapping.source;
      source.content = original.sourceContentFor(mapping.source, true);
    }
  });

  extension.eachMapping(mapping => {
    let newMapping = {
      source: source.name,
      original: {
        line: mapping.originalLine,
        column: mapping.originalColumn
      },
      generated: {
        line: mapping.generatedLine,
        column: mapping.generatedColumn
      },
      name: mapping.name
    };
    let foundMapping = mappings[mapping.originalLine][mapping.originalColumn];
    if (foundMapping) {
      newMapping.name = foundMapping.name;
      newMapping.original.line = foundMapping.line;
      newMapping.original.column = foundMapping.column;
    }
    generator.addMapping(newMapping);
  });

  generator.setSourceContent(source.name, source.content);
  return generator;
}

exports.getEmptyMap = getEmptyMap;
exports.getConsumer = getConsumer;
exports.isGenerator = isGenerator;
exports.getGenerator = getGenerator;
exports.offsetSourceMap = offsetSourceMap;
exports.combineSourceMaps = combineSourceMaps;
exports.extendSourceMap = extendSourceMap;
