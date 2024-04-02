// @flow strict-local

import assert from 'assert';
import {createEnvironment} from '../src/Environment';
import {createDependency} from '../src/Dependency';
import {getPublicDependency} from '../src/public/Dependency';
import {DB, DEFAULT_OPTIONS} from './test-utils';

describe('Public Dependency', () => {
  it('returns the same public Dependency given an internal dependency', () => {
    let internalDependency = createDependency(DB, '/', {
      specifier: 'foo',
      specifierType: 'esm',
      env: createEnvironment(DB, {}),
    });
    let scope = {};

    assert.equal(
      getPublicDependency(internalDependency, DEFAULT_OPTIONS, scope),
      getPublicDependency(internalDependency, DEFAULT_OPTIONS, scope),
    );
  });
});
