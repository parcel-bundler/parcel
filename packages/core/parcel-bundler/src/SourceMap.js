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
      return mappings.filter(mapping => {
        return (
          mapping &&
          mapping.source &&
          mapping.original &&
          typeof mapping.original.line === 'number' &&
          mapping.original.line > 0 &&
          typeof mapping.original.column === 'number' &&
          mapping.generated &&
          typeof mapping.generated.line === 'number' &&
          mapping.generated.line > 0 &&
          typeof mapping.generated.column === 'number'
        );
      });
    }

    return [];
  }

  async getConsumer(map) {
    if (map instanceof SourceMapConsumer) {
      return map;
    }
    map = typeof map === 'string' ? JSON.parse(map) : map;
    return await new SourceMapConsumer(map);
  }

  async addMap(map, lineOffset = 0, columnOffset = 0) {
    if (!(map instanceof SourceMap) && map.version) {
      let consumer = await this.getConsumer(map);

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
    } else {
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
      throw new Error(
        '[SOURCEMAP] Type of extension should be a SourceMap instance!'
      );
    }

    original = await this.getConsumer(original);
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

    if (original.destroy) {
      // Only needs to happen in source-map 0.7
      original.destroy();
    }

    return this;
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

  stringify(file) {
    let generator = new SourceMapGenerator({
      file: file
    });

    this.eachMapping(mapping => generator.addMapping(mapping));
    Object.keys(this.sources).forEach(sourceName =>
      generator.setSourceContent(sourceName, this.sources[sourceName])
    );

    return generator.toString();
  }
}

module.exports = SourceMap;
