const assert = require('assert');
const path = require('path');
const gql = require('graphql-tag');
const {bundle, run, assertBundleTree} = require('./utils');

describe('graphql', function() {
  it('should support requiring graphql files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/graphql/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.graphql'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
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

  it('should support importing other graphql files from a graphql file', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/graphql-import/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.graphql'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.deepEqual(
      output().definitions,
      gql`
        {
          user(id: 6) {
            ...UserFragment
            ...AnotherUserFragment
          }
        }

        fragment UserFragment on User {
          firstName
          lastName
        }

        fragment AnotherUserFragment on User {
          address
          email
        }
      `.definitions
    );
  });
});
