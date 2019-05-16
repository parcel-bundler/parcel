// @flow strict-local
import type {Position, MappingItem, RawSourceMap} from 'source-map';
import type {Mapping} from './types';

import {SourceMapConsumer, SourceMapGenerator} from 'source-map';
import countLines from '../../utils/src/countLines';

type RawMapInput = SourceMapConsumer | string | RawSourceMap;

export default class SourceMap {
  mappings: Array<Mapping>;
  sources: {[key: string]: string | null};

  constructor(
    mappings?: Array<Mapping> = [],
    sources?: {[key: string]: string | null} = {}
  ) {
    this.mappings = mappings;
    this.sources = sources;
  }

  async getConsumer(map: RawMapInput): Promise<SourceMapConsumer> {
    if (map instanceof SourceMapConsumer) {
      return map;
    }

    let sourcemap: RawSourceMap =
      typeof map === 'string' ? JSON.parse(map) : map;
    if (sourcemap.sourceRoot != null) delete sourcemap.sourceRoot;
    return new SourceMapConsumer(sourcemap);
  }

  async _addSourceMap(
    map: SourceMap,
    lineOffset: number = 0,
    columnOffset: number = 0
  ) {
    if (lineOffset === 0 && columnOffset === 0) {
      this.mappings.push(...map.mappings);
    } else {
      map.eachMapping(mapping => {
        this.addMapping(mapping, lineOffset, columnOffset);
      });
    }

    for (let key of Object.keys(map.sources)) {
      if (!this.sourceContentFor(key)) {
        this.setSourceContentFor(key, map.sourceContentFor(key));
      }
    }

    return this;
  }

  async _addConsumerMap(
    consumer: SourceMapConsumer,
    lineOffset: number = 0,
    columnOffset: number = 0
  ) {
    consumer.eachMapping(mapping => {
      this.addConsumerMapping(mapping, lineOffset, columnOffset);

      if (!this.sourceContentFor(mapping.source)) {
        this.setSourceContentFor(
          mapping.source,
          consumer.sourceContentFor(mapping.source, true)
        );
      }
    });

    consumer.destroy();

    return this;
  }

  async addMap(
    map: RawMapInput | SourceMap,
    lineOffset: number = 0,
    columnOffset: number = 0
  ) {
    if (map instanceof SourceMap) {
      return this._addSourceMap(map, lineOffset, columnOffset);
    } else if (typeof map === 'string' || typeof map.mappings === 'string') {
      let consumer = await this.getConsumer(map);

      return this._addConsumerMap(consumer, lineOffset, columnOffset);
    } else {
      throw new Error('Could not merge sourcemaps, input is of unknown kind');
    }
  }

  addMapping(
    mapping: Mapping,
    lineOffset: number = 0,
    columnOffset: number = 0
  ) {
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

  addConsumerMapping(
    mapping: MappingItem,
    lineOffset: number = 0,
    columnOffset: number = 0
  ) {
    if (!mapping.originalLine || !mapping.source) return;

    this.mappings.push({
      source: mapping.source,
      name: mapping.name,
      original: {
        line: mapping.originalLine,
        column: mapping.originalColumn
      },
      generated: {
        line: mapping.generatedLine + lineOffset,
        column: mapping.generatedColumn + columnOffset
      }
    });
  }

  eachMapping(callback: (mapping: Mapping) => mixed) {
    this.mappings.forEach(callback);
  }

  generateEmptyMap(sourceName: string, sourceContent: string) {
    this.setSourceContentFor(sourceName, sourceContent);

    let lineCount = countLines(sourceContent);
    for (let line = 1; line < lineCount + 1; line++) {
      this.addMapping({
        source: sourceName,
        name: '',
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

  async extend(extension: SourceMap | RawMapInput) {
    let sourceMap =
      extension instanceof SourceMap
        ? extension
        : await new SourceMap().addMap(extension);

    return this._extend(sourceMap);
  }

  async _extend(extension: SourceMap) {
    extension.eachMapping(mapping => {
      let originalMappingIndex = null;
      if (mapping.original != null) {
        originalMappingIndex = this.findClosest(
          mapping.original.line,
          mapping.original.column
        );
      }

      if (originalMappingIndex === null) {
        this.addMapping(mapping);
      } else {
        let originalMapping = this.mappings[originalMappingIndex];
        this.mappings[originalMappingIndex] = {
          generated: mapping.generated,
          original: originalMapping.original,
          source: originalMapping.source,
          name: originalMapping.name ?? mapping.name ?? null
        };
      }

      if (mapping.source != null && !this.sourceContentFor(mapping.source)) {
        this.setSourceContentFor(
          mapping.source,
          extension.sourceContentFor(mapping.source)
        );
      }
    });

    return this;
  }

  findClosest(line: number, column: number): number | null {
    if (line < 1) {
      throw new Error('Line numbers must be >= 1');
    }

    if (column < 0) {
      throw new Error('Column numbers must be >= 0');
    }

    if (this.mappings.length < 1) {
      return null;
    }

    var startIndex = 0;
    var stopIndex = this.mappings.length - 1;
    var middleIndex = Math.floor((stopIndex + startIndex) / 2);

    while (
      startIndex < stopIndex &&
      this.mappings[middleIndex].generated.line !== line
    ) {
      if (line < this.mappings[middleIndex].generated.line) {
        stopIndex = middleIndex - 1;
      } else if (line > this.mappings[middleIndex].generated.line) {
        startIndex = middleIndex + 1;
      }
      middleIndex = Math.floor((stopIndex + startIndex) / 2);
    }

    var mapping = this.mappings[middleIndex];
    if (!mapping || mapping.generated.line !== line) {
      return middleIndex;
    }

    while (middleIndex > 0) {
      if (this.mappings[middleIndex - 1].generated.line !== line) {
        break;
      }

      middleIndex--;
    }

    while (middleIndex < this.mappings.length - 1) {
      if (
        this.mappings[middleIndex + 1].generated.line !== line ||
        column <= this.mappings[middleIndex].generated.column
      ) {
        break;
      }

      middleIndex++;
    }

    return middleIndex;
  }

  originalPositionFor(generatedPosition: Position) {
    let index = this.findClosest(
      generatedPosition.line,
      generatedPosition.column
    );

    if (index === null) return null;

    let mapping = this.mappings[index];
    return {
      source: mapping.source,
      name: mapping.name,
      line: mapping.original ? mapping.original.line : null,
      column: mapping.original ? mapping.original.column : null
    };
  }

  sourceContentFor(fileName: string): string | null {
    return this.sources[fileName];
  }

  setSourceContentFor(fileName: string, sourceContent: string | null): void {
    this.sources[fileName] = sourceContent;
  }

  offset(lineOffset: number = 0, columnOffset: number = 0) {
    this.mappings.map(mapping => ({
      ...mapping,
      generated: {
        line: mapping.generated.line + lineOffset,
        column: mapping.generated.column + columnOffset
      }
    }));
  }

  stringify(file: string, sourceRoot: string) {
    let generator = new SourceMapGenerator({file, sourceRoot});

    this.eachMapping(mapping => generator.addMapping(mapping));

    for (let sourceName of Object.keys(this.sources)) {
      let sourceContent = this.sourceContentFor(sourceName);
      if (typeof sourceContent === 'string') {
        generator.setSourceContent(sourceName, sourceContent);
      }
    }

    return generator.toString();
  }
}
