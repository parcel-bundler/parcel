import assert from 'assert';
import {matchSourceMappingURL, loadSourceMapUrl} from '../src/sourcemap';
import {NodeFS} from '@parcel/fs';
import path from 'path';

const fs = new NodeFS();

describe('loadSourceMap', () => {
  it('should not match sourceMappingURL when not at the end of the bundle', () => {
    // Code example taken from livescript.js (issue #2408 in parcel-bundler)
    // This snippet lead to JSAsset.js being mislead and incorrectly trying to
    // load (due to false-positive match) sourcemap before fix was introduced
    let code = fs.readFileSync(
      path.join(__dirname, './input/sourcemap/no-sourcemap.js'),
      'utf-8',
    );

    assert(!matchSourceMappingURL(code));
  });

  it('should match referenced-min sourceMappingURL when correctly inserted at end of the bundle', () => {
    let code = fs.readFileSync(
      path.join(__dirname, './input/sourcemap/referenced-min.js'),
      'utf-8',
    );

    assert(!!matchSourceMappingURL(code));
  });

  it('should match inline sourceMappingURL when correctly inserted at end of the bundle', () => {
    // inline source map taken from https://github.com/thlorenz/inline-source-map
    let code = fs.readFileSync(
      path.join(__dirname, './input/sourcemap/inline.js'),
      'utf-8',
    );

    assert(!!matchSourceMappingURL(code));
  });

  it('Should be able to load a sourcemap from a url reference', async () => {
    let filename = path.join(__dirname, './input/sourcemap/referenced-min.js');
    let contents = fs.readFileSync(filename, 'utf-8');

    let foundMap = await loadSourceMapUrl(fs, filename, contents);
    assert.equal(foundMap.url, 'referenced-min.js.map');
    assert.equal(
      foundMap.filename,
      path.join(path.dirname(filename), foundMap.url),
    );
    assert.deepEqual(foundMap.map, {
      version: 3,
      sources: ['./referenced.js'],
      names: ['hello', 'l', 'o', 'console', 'log'],
      mappings:
        'AAAA,SAASA,QACP,IAAIC,EAAI,QACNC,EAAI,QACNC,QAAQC,IAAIH,EAAI,IAAMC,EAAI,KAE5BF',
    });
  });

  it('Should be able to load a sourcemap from an inline url reference', async () => {
    let filename = path.join(__dirname, './input/sourcemap/inline.js');
    let contents = fs.readFileSync(filename, 'utf-8');

    let foundMap = await loadSourceMapUrl(fs, filename, contents);
    assert.equal(
      foundMap.url,
      'data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiIiwic291cmNlcyI6WyJmb28uanMiLCJiYXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O1VBQ0c7Ozs7Ozs7Ozs7Ozs7O3NCQ0RIO3NCQUNBIn0=',
    );
    assert.equal(foundMap.filename, filename);
    assert.deepEqual(foundMap.map, {
      version: 3,
      file: '',
      sources: ['foo.js', 'bar.js'],
      names: [],
      mappings: ';;;;;;;;;UACG;;;;;;;;;;;;;;sBCDH;sBACA',
    });
  });
});
