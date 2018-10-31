// @flow
'use strict';
import type {
  TransformerOutput,
  Transformer,
  AST,
  Config,
  ConfigOutput,
  Resolver
} from '@parcel/types';

/*
type PackagerOpts<FileContents: string | Buffer | null> = {
  readFile(opts: { filePath: string }): Promise<FileContents>,
  writeFile(opts: { filePath: string, fileContents: FileContents }): Promise<mixed>,
  module(): Promise<string>,
  package(opts: { bundle: { destPath: string, assets: [] }, files: { FileContents } }): Promise<string>,
};
*/

export const transformer = (opts: any) => {
  return opts;
};

export const packager = (opts: any) => {
  return opts;
};

export const optimizer = (opts: any) => {
  return opts;
};

export const resolver = (opts: Resolver) => {
  return opts;
};
