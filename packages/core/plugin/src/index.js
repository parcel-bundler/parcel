'use strict';

/*::
type PackagerOpts<FileContents: string | Buffer | null> = {
  readFile(opts: { filePath: string }): Promise<FileContents>,
  writeFile(opts: { filePath: string, fileContents: FileContents }): Promise<mixed>,
  module(): Promise<string>,
  package(opts: { bundle: { destPath: string, assets: [] }, files: { FileContents } }): Promise<string>,
};
*/

export const transformer = (opts /*: TransformerOpts */) => {
  return opts;
};

export const packager = (opts /*: PackagerOpts */) => {
  return opts;
};

export const optimizer = (opts /*: OptimizerOpts */) => {
  return opts;
};
