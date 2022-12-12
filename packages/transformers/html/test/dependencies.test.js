import {collectSrcSetDependencies} from '../src/dependencies';
import assert from 'assert';
import sinon from 'sinon';

describe('collectSrcSetDependencies', () => {
  it('should parse srcset with comma in query params correctly', () => {
    const asset = {
      addURLDependency(url) {
        return `${url}hashed`;
      },
    };
    const spy = sinon.spy(asset, 'addURLDependency');
    assert.strictEqual(
      collectSrcSetDependencies(asset, '/abc.png?x=1,2&b=3 100w, /foo.png 10x'),
      '/abc.png?x=1,2&b=3hashed 100w, /foo.pnghashed 10x',
    );
    assert(spy.callCount, 2);
    const [first, second] = spy.getCalls();

    assert.strictEqual(first.args[0], '/abc.png?x=1,2&b=3');
    assert.strictEqual(second.args[0], '/foo.png');
  });
});
