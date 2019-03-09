const {SourceMapConsumer, SourceMapGenerator} = require('source-map');
const lineCounter = require('./utils/lineCounter');

class SourceMap {
  constructor(mappings, sources) {
    this.mappings = this.purifyMappings(mappings);
    this.sources = sources || {};
    this.lineCount = null;
  }

  purifyMappings(mappings) {
    if (Array.isArray(mappings)) {
      return mappings.filter(
        mapping =>
          mapping &&
          (typeof mapping.original === 'object' &&
            (mapping.original === null ||
              (typeof mapping.original.line === 'number' &&
                mapping.original.line > 0 &&
                typeof mapping.original.column === 'number' &&
                mapping.source))) &&
          mapping.generated &&
          typeof mapping.generated.line === 'number' &&
          mapping.generated.line > 0 &&
          typeof mapping.generated.column === 'number'
      );
    }

    return [];
  }

  async getConsumer(map) {
    if (map instanceof SourceMapConsumer) {
      return map;
    }
    map = typeof map === 'string' ? JSON.parse(map) : map;
    if (map.sourceRoot) delete map.sourceRoot;
    return new SourceMapConsumer(map);
  }

  async addMap(map, lineOffset = 0, columnOffset = 0) {
    if (typeof map === 'string' || (typeof map === 'object' && map.version)) {
      let consumer = await this.getConsumer(map);
      if (!consumer) return this;

      consumer.eachMapping(mapping => {
        this.addConsumerMapping(mapping, lineOffset, columnOffset);
        if (!this.sources[mapping.source]) {
          this.sources[mapping.source] = consumer.sourceContentFor(
            mapping.source,
            true
          );
        }
      });

      if (consumer.destroy) {
        // Only needs to happen in source-map 0.7
        consumer.destroy();
      }
    } else if (map.mappings && map.sources) {
      if (!map.eachMapping) {
        map = new SourceMap(map.mappings, map.sources);
      }

      if (lineOffset === 0 && columnOffset === 0) {
        this.mappings = this.mappings.concat(map.mappings);
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

    return this;
  }

  addMapping(mapping, lineOffset = 0, columnOffset = 0) {
    this.mappings.push({
      source: mapping.source,
      name: mapping.name,
      original: mapping.original,
      generated: {
        line: mapping.generated.line + lineOffset,
        column: mapping.generated.column + columnOffset
      }
    });
  }

  addConsumerMapping(mapping, lineOffset = 0, columnOffset = 0) {
    let original = null;
    if (
      typeof mapping.originalLine === 'number' &&
      mapping.originalLine > 0 &&
      typeof mapping.originalColumn === 'number'
    ) {
      original = {
        line: mapping.originalLine,
        column: mapping.originalColumn
      };
    }

    this.mappings.push({
      source: original ? mapping.source : null,
      name: mapping.name,
      original,
      generated: {
        line: mapping.generatedLine + lineOffset,
        column: mapping.generatedColumn + columnOffset
      }
    });
  }

  eachMapping(callback) {
    this.mappings.forEach(callback);
  }

  generateEmptyMap(sourceName, sourceContent) {
    this.sources[sourceName] = sourceContent;

    this.lineCount = lineCounter(sourceContent);
    for (let line = 1; line < this.lineCount + 1; line++) {
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

  async extendSourceMap(original, extension) {
    if (!(extension instanceof SourceMap)) {
      extension = await new SourceMap().addMap(extension);
    }
    if (!(original instanceof SourceMap)) {
      original = await this.getConsumer(original);
    }

    extension.eachMapping(mapping => {
      let originalMapping = original.originalPositionFor({
        line: mapping.original.line,
        column: mapping.original.column
      });

      if (!originalMapping || !originalMapping.line) {
        return;
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

    if (original.destroy) {
      // Only needs to happen in source-map 0.7
      original.destroy();
    }

    return this;
  }

  findClosestGenerated(line, column) {
    if (line < 1) {
      throw new Error('Line numbers must be >= 1');
    }

    if (column < 0) {
      throw new Error('Column numbers must be >= 0');
    }

    if (this.mappings.length < 1) {
      return undefined;
    }

    let startIndex = 0;
    let stopIndex = this.mappings.length - 1;
    let middleIndex = (stopIndex + startIndex) >>> 1;

    while (
      startIndex < stopIndex &&
      this.mappings[middleIndex].generated.line !== line
    ) {
      let mid = this.mappings[middleIndex].generated.line;
      if (line < mid) {
        stopIndex = middleIndex - 1;
      } else if (line > mid) {
        startIndex = middleIndex + 1;
      }
      middleIndex = (stopIndex + startIndex) >>> 1;
    }

    let mapping = this.mappings[middleIndex];
    if (!mapping || mapping.generated.line !== line) {
      return this.mappings.length - 1;
    }

    while (
      middleIndex >= 1 &&
      this.mappings[middleIndex - 1].generated.line === line
    ) {
      middleIndex--;
    }

    while (
      middleIndex < this.mappings.length - 1 &&
      this.mappings[middleIndex + 1].generated.line === line &&
      column > this.mappings[middleIndex].generated.column
    ) {
      middleIndex++;
    }

    return middleIndex;
  }

  findClosest(line, column, key) {
    if (line < 1) {
      throw new Error('Line numbers must be >= 1');
    }

    if (column < 0) {
      throw new Error('Column numbers must be >= 0');
    }

    if (this.mappings.length < 1) {
      return undefined;
    }

    let startIndex = 0;
    let stopIndex = this.mappings.length - 1;
    let middleIndex = Math.floor((stopIndex + startIndex) / 2);

    while (
      startIndex < stopIndex &&
      this.mappings[middleIndex][key].line !== line
    ) {
      if (line < this.mappings[middleIndex][key].line) {
        stopIndex = middleIndex - 1;
      } else if (line > this.mappings[middleIndex][key].line) {
        startIndex = middleIndex + 1;
      }
      middleIndex = Math.floor((stopIndex + startIndex) / 2);
    }

    var mapping = this.mappings[middleIndex];
    if (!mapping || mapping[key].line !== line) {
      return this.mappings.length - 1;
    }

    while (
      middleIndex >= 1 &&
      this.mappings[middleIndex - 1][key].line === line
    ) {
      middleIndex--;
    }

    while (
      middleIndex < this.mappings.length - 1 &&
      this.mappings[middleIndex + 1][key].line === line &&
      column > this.mappings[middleIndex][key].column
    ) {
      middleIndex++;
    }

    return middleIndex;
  }

  originalPositionFor(generatedPosition) {
    let index = this.findClosestGenerated(
      generatedPosition.line,
      generatedPosition.column
    );

    let mapping = this.mappings[index];
    if (!mapping || !mapping.original) {
      return null;
    }

    return {
      source: mapping.source,
      name: mapping.name,
      line: mapping.original.line,
      column: mapping.original.column
    };
  }

  generatedPositionFor(originalPosition) {
    let index = this.findClosest(
      originalPosition.line,
      originalPosition.column,
      'original'
    );

    let mapping = this.mappings[index];
    return {
      source: mapping.source,
      name: mapping.name,
      line: mapping.generated.line,
      column: mapping.generated.column
    };
  }

  sourceContentFor(fileName) {
    return this.sources[fileName];
  }

  offset(lineOffset = 0, columnOffset = 0) {
    this.mappings.map(mapping => {
      mapping.generated.line = mapping.generated.line + lineOffset;
      mapping.generated.column = mapping.generated.column + columnOffset;
      return mapping;
    });

    if (this.lineCount != null) {
      this.lineCount += lineOffset;
    }
  }

  stringify(file, sourceRoot) {
    let generator = new SourceMapGenerator({file, sourceRoot});
    this.eachMapping(mapping => generator.addMapping(mapping));
    Object.keys(this.sources).forEach(sourceName =>
      generator.setSourceContent(sourceName, this.sources[sourceName])
    );

    return generator.toString();
  }
}

module.exports = SourceMap;
