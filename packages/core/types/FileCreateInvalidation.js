// @flow

import type {Glob} from './Glob';
import type {FilePath} from './FilePath';

export type GlobInvalidation = {|
  glob: Glob,
|};

export type FileInvalidation = {|
  filePath: FilePath,
|};

export type FileAboveInvalidation = {|
  fileName: string,
  aboveFilePath: FilePath,
|};

export type FileCreateInvalidation =
  | FileInvalidation
  | GlobInvalidation
  | FileAboveInvalidation;
