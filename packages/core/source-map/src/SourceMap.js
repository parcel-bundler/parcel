// @flow strict-local
import type {Mapping, Position, MappingItem, RawSourceMap} from 'source-map';
import type {FileSystem} from '@parcel/fs';
import {SourceMapConsumer, SourceMapGenerator} from 'source-map';
import {countLines, registerSerializableClass} from '@parcel/utils';
import path from 'path';
import nullthrows from 'nullthrows';
// $FlowFixMe
import pkg from '../package.json';

type RawMapInput = SourceMapConsumer | string | RawSourceMap;

type OriginalPosition = {
  source: string,
  line: number,
  column: number,
  name: string | null
};

type NullOriginalPosition = {
  source: null,
  line: null,
  column: null,
  name: null
};

type Sources = {[key: string]: string | null};

export default class SourceMap {
  mappings: Array<Mapping>;
  sources: Sources;
  linecount: ?number;

  constructor(mappings?: Array<Mapping> = [], sources?: Sources = {}) {
    this.mappings = mappings;
    this.sources = sources;
  }

  // Static Helper functions
  static generateEmptyMap(sourceName: string, sourceContent: string) {
    let map = new SourceMap();
    map.setSourceContentFor(sourceName, sourceContent);

    let lineCount = countLines(sourceContent);
    for (let line = 1; line < lineCount + 1; line++) {
      map.addMapping({
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
    map.linecount = lineCount;

    return map;
  }

  static async fromRawSourceMap(input: RawMapInput) {
    let map = new SourceMap();
    await map.addRawMap(input);
    return map;
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

  async addRawMap(
    map: RawMapInput,
    lineOffset: number = 0,
    columnOffset: number = 0
  ) {
    let consumer = await this.getConsumer(map);

    consumer.eachMapping(mapping => {
      // $FlowFixMe line value < 1 is invalid so this should be fine...
      if (mapping.originalLine) {
        this.addConsumerMapping(mapping, lineOffset, columnOffset);

        if (!this.sourceContentFor(mapping.source)) {
          this.setSourceContentFor(
            mapping.source,
            consumer.sourceContentFor(mapping.source, true)
          );
        }
      }
    });

    consumer.destroy();

    return this;
  }

  async addMap(
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

  addMapping(
    mapping: Mapping,
    lineOffset: number = 0,
    columnOffset: number = 0
  ) {
    if (mapping.original) {
      this.mappings.push({
        source: mapping.source,
        name: mapping.name,
        original: mapping.original,
        generated: {
          line: mapping.generated.line + lineOffset,
          column: mapping.generated.column + columnOffset
        }
      });
    } else {
      this.mappings.push({
        generated: {
          line: mapping.generated.line + lineOffset,
          column: mapping.generated.column + columnOffset
        }
      });
    }
  }

  addConsumerMapping(
    mapping: MappingItem,
    lineOffset: number = 0,
    columnOffset: number = 0
  ) {
    // $FlowFixMe a line value of 0 is invalid so this should be fine...
    if (mapping.originalLine) {
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
    } else {
      this.mappings.push({
        generated: {
          line: mapping.generatedLine + lineOffset,
          column: mapping.generatedColumn + columnOffset
        }
      });
    }
  }

  eachMapping(callback: (mapping: Mapping) => mixed) {
    this.mappings.forEach(callback);
  }

  async extend(extension: SourceMap | RawMapInput) {
    let sourceMap =
      extension instanceof SourceMap
        ? extension
        : await new SourceMap().addRawMap(extension);

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

        if (originalMapping.original) {
          this.mappings[originalMappingIndex] = {
            generated: mapping.generated,
            original: originalMapping.original,
            source: originalMapping.source,
            name: originalMapping.name
          };
        } else {
          this.mappings[originalMappingIndex] = {
            generated: mapping.generated
          };
        }
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

    while (
      middleIndex > 0 &&
      this.mappings[middleIndex - 1].generated.line !== line
    ) {
      middleIndex--;
    }

    while (
      middleIndex < this.mappings.length - 1 &&
      this.mappings[middleIndex + 1].generated.line === line &&
      this.mappings[middleIndex + 1].generated.column <= column
    ) {
      middleIndex++;
    }

    return middleIndex;
  }

  originalPositionFor(
    generatedPosition: Position
  ): OriginalPosition | NullOriginalPosition {
    let index = this.findClosest(
      generatedPosition.line,
      generatedPosition.column
    );

    if (index === null) {
      return {
        source: null,
        name: null,
        line: null,
        column: null
      };
    }

    let mapping = this.mappings[index];
    if (mapping.original) {
      let result: {
        source: string,
        name: string | null,
        line: number,
        column: number
      } = {
        source: mapping.source,
        name: typeof mapping.name === 'string' ? mapping.name : null,
        line: mapping.original.line,
        column: mapping.original.column
      };

      return result;
    } else {
      return {
        source: null,
        name: null,
        line: null,
        column: null
      };
    }
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

  async stringify({
    file,
    sourceRoot,
    rootDir,
    inlineSources,
    fs
  }: {|
    file?: string, // Filename of the bundle/file sourcemap applies to
    sourceRoot?: string, // The root dir of sourcemap sourceContent, all sourceContent of mappings should exist in here...
    rootDir?: string, // Parcel's rootDir where all mappings are relative to
    inlineSources?: boolean, // true = inline everything, false = inline nothing
    fs?: FileSystem
  |}) {
    let generator = new SourceMapGenerator({file, sourceRoot});

    this.eachMapping(mapping => {
      generator.addMapping(mapping);
    });

    if (inlineSources) {
      for (let sourceName of Object.keys(this.sources)) {
        let sourceContent = this.sourceContentFor(sourceName);
        if (sourceContent !== null) {
          generator.setSourceContent(sourceName, sourceContent);
        } else {
          try {
            let content = await nullthrows(fs).readFile(
              path.join(rootDir || '', sourceName),
              'utf8'
            );
            if (content) {
              generator.setSourceContent(sourceName, content);
            }
          } catch (e) {
            // do nothing
          }
        }
      }
    }

    return generator.toString();
  }
}

registerSerializableClass(`${pkg.version}:SourceMap`, SourceMap);
