// @flow
'use strict';

/*::
type Bundle = {
  destPath: string,
  modules:
};

type PackagerOpts<FileContents: string | Buffer | null> = {
  readFile(opts: { filePath: string }): Promise<FileContents>,
  writeFile(opts: { filePath: string, fileContents: FileContents }): Promise<mixed>,
  module(): Promise<string>,
  package(opts: { bundle: { destPath: string, assets: [] }, files: { FileContents } }): Promise<string>,
};
*/

exports.transformer = (opts /*: TransformerOpts */) => {
  return opts;
};

exports.packager = (opts /*: PackagerOpts */) => {
  return opts;
};

exports.optimizer = (opts /*: OptimizerOpts */) => {
  return opts;
};
