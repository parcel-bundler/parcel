// @flow strict-local

import assert from 'assert';
import {createEnvironment} from '../src/Environment';
import {createDependency} from '../src/Dependency';
import Dependency from '../src/public/Dependency';

describe('Public Dependency', () => {
  it('returns the same public Dependency given an internal dependency', () => {
    let internalDependency = createDependency({
      moduleSpecifier: 'foo',
      env: createEnvironment({}),
    });

    assert.equal(
      new Dependency(internalDependency),
      new Dependency(internalDependency),
    );
  });
});
