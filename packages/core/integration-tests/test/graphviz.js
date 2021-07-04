import {assertBundles, bundle} from '@parcel/test-utils';
import path from 'path';

describe('graphviz', function() {
  it('should transform gv files to svg', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/graphviz-gv/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'svg',
        assets: ['graph.gv'],
      },
    ]);
  });

  it('should transform dot files to svg', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/graphviz-dot/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'svg',
        assets: ['graph.dot'],
      },
    ]);
  });
});
