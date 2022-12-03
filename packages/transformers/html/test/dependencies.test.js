import {collectSrcSetDependencies} from '../src/dependencies';
import assert from 'assert';

describe('collectSrcSetDependencies', () => {
  it('should parse srcset with comma in query params correctly', () => {
    assert.strictEqual(
      collectSrcSetDependencies(
        {
          addURLDependency(url) {
            return url;
          },
        },
        '/abc.png?x=1,2&b=3 100w, /foo.png 10x',
      ),
      '/abc.png?x=1,2&b=3 100w, /foo.png 10x',
    );
  });
});
