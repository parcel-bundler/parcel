const assert = require('assert');
const gql = require('graphql-tag');
const {bundle, run, assertBundleTree} = require('./utils');

describe('graphql', function() {
  it('should support requiring graphql files', async function() {
    let b = await bundle(__dirname + '/integration/graphql/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.graphql'],
      childBundles: []
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.deepEqual(
      output().definitions,
      gql`
        {
          user(id: 5) {
            ...UserFragment
          }
        }

        fragment UserFragment on User {
          firstName
          lastName
        }
      `.definitions
    );
  });
});
