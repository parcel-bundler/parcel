// @flow strict-local

import type {FSWatcherOptions} from 'chokidar';

import invariant from 'assert';

export type EncodedFSWatcherOptions = FSWatcherOptions & {
  _regIndexs?: Array<number>
};

export function encodeOptions(
  options?: FSWatcherOptions
): EncodedFSWatcherOptions {
  let outputOptions: EncodedFSWatcherOptions = {...options};
  if (outputOptions && outputOptions.ignored != null) {
    if (!Array.isArray(outputOptions.ignored)) {
      outputOptions.ignored = [outputOptions.ignored];
    }

    outputOptions.ignored.forEach((value, index) => {
      invariant(outputOptions != null);
      if (value instanceof RegExp) {
        invariant(Array.isArray(outputOptions.ignored));
        outputOptions.ignored[index] = value.source;
        if (!outputOptions._regIndexs) {
          outputOptions._regIndexs = [];
        }
        outputOptions._regIndexs.push(index);
      }
    });
  }

  return outputOptions;
}

export function decodeOptions(
  options: EncodedFSWatcherOptions
): FSWatcherOptions {
  if (options && options.ignored != null && options._regIndexs) {
    for (let index of options._regIndexs) {
      invariant(Array.isArray(options.ignored));
      options.ignored[index] = new RegExp(options.ignored[index]);
    }
    delete options._regIndexs;
  }

  return options;
}
