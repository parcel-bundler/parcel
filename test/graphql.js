const assert = require('assert');
const gql = require('graphql-tag');
const {bundle, run, assertBundleTree} = require('./utils');

describe('graphql', function() {
  it('should support requiring graphql files', async function() {
    let b = await bundle(__dirname + '/integration/graphql/index.js');

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

  it('should support requiring graphql files that use fragments #import', async function() {
    let b = await bundle(
      __dirname + '/integration/graphql/withFragmentImport.js'
    );

    await assertBundleTree(b, {
      name: 'withFragmentImport.js',
      assets: [
        'withFragmentImport.js',
        'withFragmentImport.graphql',
        'projectFragment.graphql'
      ],
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
            projects {
              ...ProjectFragment
            }
          }
        }

        fragment UserFragment on User {
          firstName
          lastName
        }

        fragment ProjectFragment on Project {
          internalReference
          name
        }

      `.definitions
    );
  });
});
