const sourceMap = require('source-map');
const textUtils = require('./utils/textUtils');

class SourceMap {
  constructor(file) {
    this.sources = {};
    this.mappings = [];
    this.file = file;
  }

  copyConstructor(map) {
    let sourcemap = new SourceMap();
    sourcemap.mappings = map.mappings;
    sourcemap.sources = map.sources;
    sourcemap.file = map.file;
    return sourcemap;
  }

  isConsumer(map) {
    return map && map.computeColumnSpans;
  }

  getConsumer(map) {
    if (this.isConsumer(map)) {
      return map;
    }
    return new sourceMap.SourceMapConsumer(map);
  }

  addMap(map, lineOffset = 0, columnOffset = 0) {
    if (!isSourceMapInstance(map) && map.version) {
      let consumer = this.getConsumer(map);

      consumer.eachMapping(mapping => {
        this.addConsumerMapping(mapping, lineOffset, columnOffset);
        if (!this.sources[mapping.source]) {
          this.sources[mapping.source] = consumer.sourceContentFor(
            mapping.source,
            true
          );
        }
      });
    } else {
      if (!map.eachMapping) {
        map = this.copyConstructor(map);
      }
      if (lineOffset === 0 && columnOffset === 0) {
        this.concatMappings(map.mappings);
      } else {
        map.eachMapping(mapping => {
          this.addMapping(mapping, lineOffset, columnOffset);
        });
      }
      Object.keys(map.sources).forEach(sourceName => {
        if (!this.sources[sourceName]) {
          this.sources[sourceName] = map.sources[sourceName];
        }
      });
    }
  }

  concatMappings(mappings) {
    this.mappings = this.mappings.concat(mappings);
  }

  addMapping(mapping, lineOffset = 0, columnOffset = 0) {
    mapping.generated = {
      line: mapping.generated.line + lineOffset,
      column: mapping.generated.column + columnOffset
    };
    this.mappings.push(mapping);
  }

  addConsumerMapping(mapping, lineOffset = 0, columnOffset = 0) {
    if (
      !mapping.source ||
      !mapping.originalLine ||
      (!mapping.originalColumn && mapping.originalColumn !== 0)
    ) {
      return;
    }

    this.mappings.push({
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
  }

  eachMapping(callback) {
    this.mappings.forEach(callback);
  }

  generateEmptyMap(sourceName, sourceContent) {
    this.sources[sourceName] = sourceContent;
    let lines = textUtils.lineCounter(sourceContent);
    for (let line = 1; line < lines + 1; line++) {
      this.addMapping({
        source: sourceName,
        original: {
          line: line,
          column: 0
        },
        generated: {
          line: line,
          column: 0
        }
      });
    }
    return this;
  }

  extendSourceMap(original, extension) {
    original = this.getConsumer(original);
    if (!isSourceMapInstance(extension)) {
      throw new Error(
        '[SOURCEMAP] Type of extension should be a SourceMap instance!'
      );
    }

    extension.eachMapping(mapping => {
      let originalMapping = original.originalPositionFor({
        line: mapping.original.line,
        column: mapping.original.column
      });

      if (!originalMapping.line) {
        return false;
      }

      this.addMapping({
        source: originalMapping.source,
        name: originalMapping.name,
        original: {
          line: originalMapping.line,
          column: originalMapping.column
        },
        generated: {
          line: mapping.generated.line,
          column: mapping.generated.column
        }
      });
      if (!this.sources[originalMapping.source]) {
        this.sources[originalMapping.source] = original.sourceContentFor(
          originalMapping.source,
          true
        );
      }
    });
  }

  offset(lineOffset = 0, columnOffset = 0) {
    this.mappings.map(mapping => {
      mapping.generated.line = mapping.generated.line + lineOffset;
      mapping.generated.column = mapping.generated.column + columnOffset;
      return mapping;
    });
  }

  stringify() {
    let generator = new sourceMap.SourceMapGenerator({
      file: this.file
    });
    this.eachMapping(mapping => generator.addMapping(mapping));
    Object.keys(this.sources).forEach(sourceName =>
      generator.setSourceContent(sourceName, this.sources[sourceName])
    );
    return generator.toString();
  }
}

function isSourceMapInstance(map) {
  return !map.sources.length;
}

module.exports = SourceMap;
module.exports.isSourceMapInstance = isSourceMapInstance;
