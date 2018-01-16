const sourceMap = require('source-map');
const textUtils = require('./textUtils');
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
  return combineSourceMaps(consumer, new sourceMap.SourceMapGenerator());
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
    for (
      let line = 1;
      line < textUtils.lineCounter(sourceContent) + 1;
      line++
    ) {
      let column = textUtils.whiteSpaceLength(sourceContent, line - 1);
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
  let generator = new sourceMap.SourceMapGenerator();
  let mappings = {};
  let source = {
    name: '',
    content: ''
  };

  original.eachMapping(mapping => {
    if (!mappings[mapping.generatedLine]) {
      mappings[mapping.generatedLine] = {};
    }
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

  let addedLines = {};
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
    if (mappings[mapping.originalLine] && !addedLines[mapping.originalLine]) {
      let originalMapping =
        mappings[mapping.originalLine][mapping.originalColumn];

      if (!originalMapping) {
        // No original column mapping found, fallback to line mapping
        originalMapping =
          mappings[mapping.originalLine][
            Object.keys(mappings[mapping.originalLine])[0]
          ];
        originalMapping.column = source.content
          ? textUtils.whiteSpaceLength(source.content, originalMapping.line - 1)
          : 0;
        addedLines[mapping.originalLine] = true;
      }

      newMapping.name = originalMapping.name;
      newMapping.original.line = originalMapping.line;
      newMapping.original.column = originalMapping.column;

      generator.addMapping(newMapping);
    }
  });

  generator.setSourceContent(source.name, source.content);
  return generator;
}

function addNodes(source, rawNodeData, lineOffset = 0, columnOffset = 0) {
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
  consumer.eachMapping(mapping => {
    if (
      !mapping.source ||
      !mapping.originalLine ||
      (!mapping.originalColumn && mapping.originalColumn !== 0)
    ) {
      return false;
    }

    rawNodeData.mappings.push({
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

    if (!rawNodeData.sources[mapping.source]) {
      rawNodeData.sources[mapping.source] = consumer.sourceContentFor(
        mapping.source,
        true
      );
    }
  });

  return rawNodeData;
}

exports.getEmptyMap = getEmptyMap;
exports.getConsumer = getConsumer;
exports.isGenerator = isGenerator;
exports.getGenerator = getGenerator;
exports.offsetSourceMap = offsetSourceMap;
exports.combineSourceMaps = combineSourceMaps;
exports.extendSourceMap = extendSourceMap;
exports.addNodes = addNodes;
