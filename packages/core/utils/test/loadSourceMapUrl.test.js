import assert from 'assert';
import {matchSourceMappingURL} from '../src/loadSourceMapUrl';
import fs from 'fs';
import path from 'path';

describe('loadSourceMap', () => {
  it('should not match sourceMappingURL when not at the end of the bundle', () => {
    // Code example taken from livescript.js (issue #2408 in parcel-bundler)
    // This snippet lead to JSAsset.js being mislead and incorrectly trying to
    // load (due to false-positive match) sourcemap before fix was introduced
    let code = fs.readFileSync(
      path.join(__dirname, './input/sourcemap/no-sourcemap.js'),
      'utf-8'
    );

    assert(!matchSourceMappingURL(code));
  });

  it('should match referenced sourceMappingURL when correctly inserted at end of the bundle', () => {
    let code = fs.readFileSync(
      path.join(__dirname, './input/sourcemap/referenced.js'),
      'utf-8'
    );

    assert(!!matchSourceMappingURL(code));
  });

  it('should match inline sourceMappingURL when correctly inserted at end of the bundle', () => {
    // inline source map taken from https://github.com/thlorenz/inline-source-map
    let code = fs.readFileSync(
      path.join(__dirname, './input/sourcemap/inline.js'),
      'utf-8'
    );

    assert(!!matchSourceMappingURL(code));
  });
});
