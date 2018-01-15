const assert = require('assert');
const Asset = require('../src/Asset');

describe('Asset', () => {
  it('should include default implementations', () => {
    const a = new Asset(__filename);
    Object.assign(a, {
      type: 'type',
      contents: 'contents'
    });

    const err = new Error();

    assert(a.shouldInvalidate() === false);
    assert(a.mightHaveDependencies());
    assert.deepEqual(a.generate(), {
      type: 'contents'
    });
    assert.equal(a.generateErrorMessage(err), err);
  });
});
