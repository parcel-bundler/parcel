const assert = require('assert');
const loadSourceMap = require('../../src/utils/loadSourceMap.js');
const JSAsset = require('../../src/assets/JSAsset.js');

describe('loadSourceMap', () => {
  it('should not match sourceMappingURL when not at the end of the bundle', async () => {
    // Code example taken from livescript.js (issue #2408 in parcel-bundler)
    // This snippet lead to JSAsset.js being mislead and incorrectly trying to
    // load (due to false-positive match) sourcemap before fix was introduced
    const codeExample = `
      if ((ref$ = options.map) === 'linked' || ref$ === 'debug') {
        mapPath = path.basename(outputFilename) + ".map";
        result.code += "\n//# sourceMappingURL=" + mapPath + "\n";
      } else {
        result.code += "\n//# sourceMappingURL=data:application/json;base64," + bufferFrom(result.map.toString()).toString('base64') + "\n";
      }
    `;
    const a = new JSAsset(__filename, {rootDir: '/root/dir'});
    Object.assign(a, {
      type: 'type',
      contents: codeExample
    });

    assert(!loadSourceMap.matchSourceMappingURL(a));
  });

  it('should match >>referenced<< sourceMappingURL when correctly inserted at end of the bundle', async () => {
    const codeExample = `
      function hello(){var l="Hello",o="world";console.log(l+" "+o+"!")}hello();
      //# sourceMappingURL=main.min.js.map
    `;
    const a = new JSAsset(__filename, {rootDir: '/root/dir'});
    Object.assign(a, {
      type: 'type',
      contents: codeExample
    });

    assert(!!loadSourceMap.matchSourceMappingURL(a));
  });

  it('should match >>inline<< sourceMappingURL when correctly inserted at end of the bundle', async () => {
    // inline source map taken from https://github.com/thlorenz/inline-source-map
    const codeExample = `
      //@ sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiIiwic291cmNlcyI6WyJmb28uanMiLCJiYXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O1VBQ0c7Ozs7Ozs7Ozs7Ozs7O3NCQ0RIO3NCQUNBIn0=
    `;

    const a = new JSAsset(__filename, {rootDir: '/root/dir'});
    Object.assign(a, {
      type: 'type',
      contents: codeExample
    });

    assert(!!loadSourceMap.matchSourceMappingURL(a));
  });
});
